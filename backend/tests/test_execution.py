"""Runner failure tests use injected in-process provider doubles, not live HTTP."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from conftest import ROOT, SAMPLES, validate, wait_run


def submit(client, tasks=None):
    response = client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': tasks or SAMPLES['tasks']})
    assert response.status_code == 202
    return response.headers['location']


@pytest.mark.parametrize('code', ['PROVIDER_TIMEOUT', 'PROVIDER_AUTH_ERROR', 'PROVIDER_RATE_LIMITED',
                                  'PROVIDER_UNAVAILABLE', 'PROVIDER_BAD_RESPONSE'])
def test_provider_failure_is_sanitized_and_other_attempts_continue(client, code):
    from backend.app.providers.base import ProviderError
    original = client.app.state.runner.provider.execute

    async def execute(task, policy, role):
        if task.id == 'classify-1' and policy == 'optimized':
            raise ProviderError(code) from RuntimeError('secret-key-and-provider-body')
        return await original(task, policy, role)

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client))
    assert run['status'] == 'partial'
    assert run['completed_attempts'] == 6
    assert run['run_error'] is None
    failed = run['results'][1]
    assert failed['status'] == 'failed'
    assert failed['error']['code'] == code
    for field in ('output_text', 'latency_ms', 'input_tokens', 'output_tokens', 'estimated_energy_wh', 'estimated_carbon_g'):
        assert failed[field] is None
    assert run['comparison']['successful_pairs'] == run['comparison']['energy_pairs'] == 2
    assert run['comparison']['energy_wh']['baseline'] == pytest.approx(0.0382)
    assert run['comparison']['energy_wh']['optimized'] == pytest.approx(0.0254)
    assert 'secret-key' not in json.dumps(run)


def test_all_failed_attempts_produce_partial_with_null_comparison(client):
    from backend.app.providers.base import ProviderError

    async def execute(task, policy, role):
        raise ProviderError('PROVIDER_AUTH_ERROR')

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    assert run['status'] == 'partial'
    assert run['completed_attempts'] == 2
    assert run['comparison']['successful_pairs'] == 0
    for metric in ('energy_wh', 'carbon_g', 'latency_ms'):
        assert set(run['comparison'][metric].values()) == {None}


def test_hard_total_deadline_continues_next_attempt(client, monkeypatch):
    import backend.app.runner as module
    original = client.app.state.runner.provider.execute
    monkeypatch.setattr(module, 'ATTEMPT_TIMEOUT_SECONDS', 0.2)

    async def execute(task, policy, role):
        if policy == 'baseline':
            await asyncio.sleep(10)
        return await original(task, policy, role)

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    assert run['status'] == 'partial'
    assert run['results'][0]['error']['code'] == 'PROVIDER_TIMEOUT'
    assert run['results'][1]['status'] == 'succeeded'


@pytest.mark.parametrize('missing_field', ['input_tokens', 'output_tokens'])
def test_missing_usage_preserves_latency_but_excludes_energy_pair(client, missing_field):
    from dataclasses import replace
    original = client.app.state.runner.provider.execute

    async def execute(task, policy, role):
        result = await original(task, policy, role)
        if task.id == 'classify-1' and policy == 'optimized':
            return replace(result, **{missing_field: None})
        return result

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client))
    assert run['status'] == 'completed'
    assert run['results'][1]['estimated_energy_wh'] is None
    assert run['results'][1]['estimated_carbon_g'] is None
    assert run['comparison']['successful_pairs'] == run['comparison']['latency_pairs'] == 3
    assert run['comparison']['energy_pairs'] == 2
    assert run['comparison']['latency_ms']['baseline'] == 4700
    assert run['comparison']['energy_wh']['baseline'] == pytest.approx(0.0382)
    assert run['comparison']['energy_wh']['optimized'] == pytest.approx(0.0254)


def test_negative_savings_are_not_clamped(client):
    from backend.app.providers.base import InferenceResult

    async def execute(task, policy, role):
        return InferenceResult('synthetic test', 10 if policy == 'baseline' else 20,
                               0, 1 if policy == 'baseline' else 10)

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    assert run['comparison']['energy_wh']['saved'] == pytest.approx(-0.0004)
    assert run['comparison']['energy_wh']['savings_pct'] == pytest.approx(-100)
    assert run['comparison']['carbon_g']['saved'] < 0
    assert run['comparison']['latency_ms']['saved'] == -10
    assert run['comparison']['latency_ms']['savings_pct'] == -100


def test_zero_usage_is_available_and_baseline_zero_has_no_percentage(client):
    from backend.app.providers.base import InferenceResult

    async def execute(task, policy, role):
        return InferenceResult('synthetic test', 0, 0, 0)

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    assert run['comparison']['energy_pairs'] == 1
    for metric in ('energy_wh', 'carbon_g', 'latency_ms'):
        assert run['comparison'][metric] == {'baseline': 0, 'optimized': 0, 'saved': 0, 'savings_pct': None}


def test_job_failure_keeps_prior_results_and_releases_gate(client):
    original = client.app.state.runner.provider.execute

    async def execute(task, policy, role):
        if policy == 'optimized':
            raise RuntimeError('secret-provider-internals')
        return await original(task, policy, role)

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    assert run['status'] == 'failed'
    assert run['completed_attempts'] == 1
    assert run['run_error']['code'] == 'INTERNAL_ERROR'
    assert run['finished_at'] is not None
    assert 'secret-provider-internals' not in json.dumps(run)
    client.app.state.runner.provider.execute = original
    assert wait_run(client, submit(client, SAMPLES['tasks'][:1]))['status'] == 'completed'


@pytest.mark.parametrize('state', ['queued', 'running'])
def test_restart_recovers_unfinished_run_and_preserves_results(tmp_path, state):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    from backend.app.store import Store
    from backend.app.schemas import Run
    settings = Settings(database_path=tmp_path / 'runs.sqlite3')
    store = Store(settings.database_path)
    fixture = json.loads((ROOT / 'contracts/examples/run-completed.json').read_text())
    fixture.update(status=state, finished_at=None, completed_attempts=1,
                   results=fixture['results'][:1], comparison=json.loads(
                       (ROOT / 'contracts/examples/run-queued.json').read_text())['comparison'])
    if state == 'queued':
        fixture.update(started_at=None, completed_attempts=0, results=[])
    recovered_snapshot = Run.model_validate_json(json.dumps(fixture))
    expected_results = [result.model_dump(mode='json') for result in recovered_snapshot.results]
    store.create(recovered_snapshot)
    with TestClient(create_app(settings)) as client:
        recovered = client.get('/api/v1/runs/' + fixture['id']).json()
        validate(recovered, 'Run')
        assert recovered['status'] == 'failed'
        assert recovered['run_error']['code'] == 'RUN_INTERRUPTED'
        assert recovered['finished_at'].endswith('Z')
        assert recovered['results'] == expected_results
        assert recovered['completed_attempts'] == len(fixture['results'])
        assert wait_run(client, submit(client, SAMPLES['tasks'][:1]))['status'] == 'completed'
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/runs/' + fixture['id']).json() == recovered


def test_shutdown_interrupts_active_run(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'runs.sqlite3')
    with TestClient(create_app(settings)) as client:
        location = submit(client)
    with TestClient(create_app(settings)) as client:
        run = client.get(location).json()
        validate(run, 'Run')
        assert run['status'] == 'failed'
        assert run['run_error']['code'] == 'RUN_INTERRUPTED'
        assert wait_run(client, submit(client, SAMPLES['tasks'][:1]))['status'] == 'completed'


def test_terminal_snapshot_cannot_be_overwritten(client):
    from backend.app.schemas import Run
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    altered = Run.model_validate_json(json.dumps(run))
    altered.status = 'running'
    client.app.state.store.save(altered)
    assert client.get('/api/v1/runs/' + run['id']).json() == run


def test_api_internal_failure_does_not_escape_or_echo_secret(tmp_path, monkeypatch):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    with TestClient(create_app(Settings(database_path=tmp_path / 'runs.sqlite3'))) as client:
        def fail(_):
            raise RuntimeError('test-secret-do-not-leak')
        monkeypatch.setattr(client.app.state.store, 'get', fail)
        response = client.get('/api/v1/runs/00000000-0000-0000-0000-000000000000')
        assert response.status_code == 500
        validate(response.json(), 'ErrorEnvelope')
        assert response.json()['error']['code'] == 'INTERNAL_ERROR'
        assert 'test-secret-do-not-leak' not in response.text


def test_only_missing_usage_pairs_have_null_energy_but_available_latency(client):
    from backend.app.providers.base import InferenceResult

    async def execute(task, policy, role):
        return InferenceResult('synthetic test', 10, None, None)

    client.app.state.runner.provider.execute = execute
    run = wait_run(client, submit(client, SAMPLES['tasks'][:1]))
    assert run['comparison']['successful_pairs'] == run['comparison']['latency_pairs'] == 1
    assert run['comparison']['energy_pairs'] == 0
    for metric in ('energy_wh', 'carbon_g'):
        assert set(run['comparison'][metric].values()) == {None}
    assert run['comparison']['latency_ms']['baseline'] == 10


def test_running_snapshot_has_only_completed_attempts_and_no_unpaired_totals(client):
    from time import monotonic, sleep
    location = submit(client)
    deadline = monotonic() + 3
    while monotonic() < deadline:
        run = client.get(location).json()
        validate(run, 'Run')
        if run['completed_attempts'] == 1:
            assert run['status'] == 'running'
            assert run['finished_at'] is None
            assert run['run_error'] is None
            assert len(run['results']) == 1
            assert run['comparison']['successful_pairs'] == 0
            assert set(run['comparison']['energy_wh'].values()) == {None}
            break
        sleep(0.005)
    else:
        pytest.fail('Never observed the persisted first attempt')
    assert wait_run(client, location)['status'] == 'completed'
