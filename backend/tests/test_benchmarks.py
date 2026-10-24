from time import monotonic, sleep
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from conftest import SAMPLES, validate

BASE = '/api/v1/benchmarks'
REQUEST = {'dataset_id': 'starter-v1', 'baseline': {'model_id': 'openai/gpt-oss-120b', 'optimization_enabled': False},
           'candidate': {'model_id': 'eco-auto', 'optimization_enabled': True}, 'max_cases': 5}


def start(client, **overrides):
    response = client.post(BASE + '/runs', json={**REQUEST, **overrides})
    assert response.status_code == 202, response.text
    validate(response.json(), 'StartBenchmarkResponse')
    assert response.json()['status'] == 'queued'
    assert response.headers['location'] == BASE + '/runs/' + response.json()['run_id']
    return response.headers['location']


def wait(client, path):
    deadline = monotonic() + 5
    while monotonic() < deadline:
        run = client.get(path).json()
        validate(run, 'BenchmarkRun')
        if run['status'] not in ('queued', 'running'):
            return run
        sleep(0.01)
    pytest.fail('Benchmark did not finish')


def test_benchmark_catalog_creation_progress_results(client):
    response = client.get(BASE + '/datasets')
    assert response.status_code == 200
    validate(response.json(), 'BenchmarkDatasetsResponse')
    catalog = response.json()['datasets']
    assert [d['dataset_id'] for d in catalog] == ['starter-v1', 'starter-v2']
    assert catalog[0]['case_count'] == 5
    assert catalog[0]['supported_models'] == ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']
    assert catalog[0]['provenance'] == 'synthetic'
    expanded = catalog[1]
    assert expanded['case_count'] == 26
    assert expanded['max_cases_per_run'] == 10
    assert expanded['preview_models'] == ['qwen/qwen3.8-27b']
    path = start(client)
    initial = client.get(path).json()
    assert initial['progress']['completed'] < 5
    assert initial['measurement_source'] == 'simulated'
    run = wait(client, path)
    assert run['status'] == 'completed'
    assert run['progress'] == {'completed': 5, 'total': 5}
    for side in ('baseline_metrics', 'candidate_metrics'):
        assert run[side]['total_cases'] == 5
        assert run[side]['passed_cases'] == 5
        assert run[side]['pass_rate'] == 1
        assert run[side]['error_count'] == 0
        assert run[side]['total_requests'] == 5
    response = client.get(path + '/cases')
    validate(response.json(), 'BenchmarkCasesResponse')
    cases = response.json()['items']
    assert len(cases) == 5
    assert [c['candidate']['model_id'] for c in cases] == [
        'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b',
        'openai/gpt-oss-20b', 'openai/gpt-oss-120b']
    assert all(c['status'] == 'passed' for c in cases)
    assert cases[0]['baseline']['output'] == 'billing'
    assert run['baseline_metrics']['total_cost_usd'] > 0
    assert client.get(BASE + '/runs').json()['items'][0] == run


def test_expanded_dataset_and_export_are_self_contained(client):
    definition = client.get(BASE + '/datasets/starter-v2')
    validate(definition.json(), 'BenchmarkDatasetDefinition')
    assert len(definition.json()['cases']) == 26
    path = start(client, dataset_id='starter-v2', baseline={'model_id': 'qwen/qwen3.8-27b', 'optimization_enabled': False}, max_cases=10)
    run = wait(client, path)
    assert run['status'] == 'completed'
    export_response = client.get(path + '/export')
    validate(export_response.json(), 'BenchmarkExport')
    export = export_response.json()
    assert export['data_completeness'] == 'partial'
    assert len(export['dataset']['cases']) == 26
    assert len(export['cases']) == 10
    assert export['cases'][0]['definition']['input']
    assert export['cases'][0]['result']['baseline']['provider_id'] == 'synthetic_fixture'
    assert export['pricing_snapshot']['models']['qwen/qwen3.8-27b']['input_usd_per_million'] == 0.8


def test_benchmark_cursor_pages_are_stable_and_scoped(client):
    paths = [start(client, max_cases=1)]
    wait(client, paths[-1])
    paths.append(start(client, max_cases=1)); wait(client, paths[-1])
    page = client.get(BASE + '/runs?limit=1').json()
    validate(page, 'BenchmarkRunsResponse')
    assert page['items'][0]['run_id'] == paths[1].rsplit('/', 1)[1]
    cursor = page['next_cursor']; assert cursor
    newer = start(client); wait(client, newer)
    next_page = client.get(BASE + '/runs', params={'limit': 1, 'cursor': cursor}).json()
    assert next_page['items'][0]['run_id'] == paths[0].rsplit('/', 1)[1]
    assert next_page['next_cursor'] is None
    first = client.get(newer + '/cases?limit=2').json()
    second = client.get(newer + '/cases', params={'limit': 2, 'cursor': first['next_cursor']}).json()
    last = client.get(newer + '/cases', params={'limit': 2, 'cursor': second['next_cursor']}).json()
    assert len(first['items'] + second['items'] + last['items']) == 5
    assert last['next_cursor'] is None
    assert client.get(paths[0] + '/cases', params={'cursor': first['next_cursor']}).status_code == 422
    assert client.get(BASE + '/runs', params={'cursor': first['next_cursor']}).status_code == 422


@pytest.mark.parametrize(('change', 'status', 'code'), [
    ({'dataset_id': 'missing'}, 404, 'DATASET_NOT_FOUND'),
    ({'max_cases': 0}, 422, 'VALIDATION_ERROR'), ({'max_cases': 6}, 422, 'VALIDATION_ERROR'),
    ({'max_cases': True}, 422, 'VALIDATION_ERROR'),
    ({'baseline': {'model_id': 'eco-auto', 'optimization_enabled': False}}, 422, 'UNSUPPORTED_MODEL'),
    ({'baseline': {'model_id': 'openai/gpt-oss-120b', 'optimization_enabled': True}}, 422, 'VALIDATION_ERROR'),
    ({'candidate': {'model_id': 'eco-auto', 'optimization_enabled': False}}, 422, 'VALIDATION_ERROR'),
    ({'candidate': {'model_id': 'unknown', 'optimization_enabled': False}}, 422, 'UNSUPPORTED_MODEL'),
    ({'secret': 'do-not-echo'}, 422, 'VALIDATION_ERROR'),
])
def test_benchmark_validation(client, change, status, code):
    response = client.post(BASE + '/runs', json={**REQUEST, **change})
    assert response.status_code == status
    assert response.json()['error']['code'] == code
    assert 'do-not-echo' not in response.text


@pytest.mark.parametrize('query', ['limit=0', 'limit=101', 'limit=bad', 'cursor=bad'])
def test_invalid_pagination(client, query):
    assert client.get(BASE + '/runs?' + query).status_code == 422


def test_benchmark_and_comparison_share_atomic_gate(client):
    barrier = Barrier(2)
    def submit(kind):
        barrier.wait()
        return client.post(BASE + '/runs', json=REQUEST) if kind else client.post(
            '/api/v1/runs', json={'mode': 'demo', 'tasks': SAMPLES['tasks']})
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(submit, [0, 1]))
    assert sorted(r.status_code for r in replies) == [202, 409]
    accepted = next(r for r in replies if r.status_code == 202)
    conflict = next(r for r in replies if r.status_code == 409)
    assert conflict.json()['error']['details']['active_run_id'] == accepted.headers['location'].rsplit('/', 1)[1]


def test_benchmark_restart_recovery_and_completed_history(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'runs.sqlite3')
    with TestClient(create_app(settings)) as client:
        complete = start(client, max_cases=1); saved = wait(client, complete)
        active = start(client)
    with TestClient(create_app(settings)) as client:
        assert client.get(complete).json() == saved
        recovered = client.get(active).json()
        assert recovered['status'] == 'failed'
        assert recovered['error']['code'] == 'RUN_INTERRUPTED'
        assert wait(client, start(client, max_cases=1))['status'] == 'completed'


def test_benchmark_failures_and_null_metrics(client):
    from backend.app.providers.base import ProviderError
    service = client.app.state.benchmarks
    original = service.infer
    async def broken(case, model, run_id):
        if model == 'openai/gpt-oss-20b':
            raise ProviderError('PROVIDER_RATE_LIMITED')
        return await original(case, model, run_id)
    service.infer = broken
    path = start(client, max_cases=1)
    run = wait(client, path)
    assert run['status'] == 'partial'
    assert run['candidate_metrics']['error_count'] == 1
    assert run['candidate_metrics']['total_cost_usd'] is None
    assert run['candidate_metrics']['mean_latency_ms'] is None
    case = client.get(path + '/cases').json()['items'][0]
    assert case['status'] == 'error'
    assert case['candidate']['error']['code'] == 'PROVIDER_RATE_LIMITED'
    assert case['baseline']['output'] == 'billing'


def test_old_comparison_database_is_migrated_without_losing_runs(tmp_path):
    import json
    import sqlite3
    from conftest import ROOT
    from backend.app.main import create_app
    from backend.app.settings import Settings
    path = tmp_path / 'old.sqlite3'
    fixture = json.loads((ROOT / 'contracts/examples/run-completed.json').read_text())
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,snapshot TEXT NOT NULL)')
        db.execute('INSERT INTO runs VALUES(?,?,?,?)', (fixture['id'], fixture['status'], fixture['created_at'], json.dumps(fixture)))
    with TestClient(create_app(Settings(database_path=path))) as client:
        assert client.get('/api/v1/runs/' + fixture['id']).json() == fixture
        assert wait(client, start(client, max_cases=1))['status'] == 'completed'


def test_benchmark_submission_rate_limit_survives_restart(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'runs.sqlite3', benchmark_runs_per_minute=1)
    with TestClient(create_app(settings)) as client:
        wait(client, start(client, max_cases=1))
    with TestClient(create_app(settings)) as client:
        response = client.post(BASE + '/runs', json={**REQUEST, 'max_cases': 1})
        assert response.status_code == 429
        assert response.json()['error']['code'] == 'RATE_LIMITED'


def test_two_benchmark_submissions_share_gate(client):
    barrier = Barrier(2)
    def submit(_):
        barrier.wait()
        return client.post(BASE + '/runs', json=REQUEST)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(submit, [0, 1]))
    assert sorted(r.status_code for r in replies) == [202, 409]


def test_evaluators_reject_wrong_or_unscored_content():
    from backend.app.benchmarks.catalog import dataset, evaluate
    cases = dataset()['cases']
    assert evaluate(cases[0], ' BILLING ')
    assert not evaluate(cases[0], 'technical')
    assert not evaluate(cases[1], 'This says nothing about the required facts.')
    assert not evaluate(cases[3], '{"order_id":"ECO-1042","total_usd":true}')
    assert not evaluate(cases[3], '{"order_id":"ECO-1042","total_usd":41}')
    assert not evaluate(cases[3], '```json\n{}\n```')


def test_null_usage_benchmark_retains_null_cost(client):
    from backend.app.providers.base import InferenceResult
    async def infer(case, model, run_id):
        return InferenceResult('billing', 10, None, 2)
    client.app.state.benchmarks.infer = infer
    path = start(client, max_cases=1)
    run = wait(client, path)
    assert run['status'] == 'completed'
    assert run['baseline_metrics']['total_cost_usd'] is None
    assert run['baseline_metrics']['input_tokens'] is None
    assert run['baseline_metrics']['output_tokens'] == 2
    assert run['baseline_metrics']['mean_latency_ms'] == 10


def test_truncated_outputs_are_incomplete_and_excluded_from_pass_rate(client):
    from backend.app.providers.base import InferenceResult
    async def infer(case, model, run_id):
        return InferenceResult('billing', 10, 8, 256, 'length', True)
    client.app.state.benchmarks.infer = infer
    run = wait(client, start(client, max_cases=1))
    assert run['status'] == 'completed'
    assert run['baseline_metrics']['total_cases'] == 1
    assert run['baseline_metrics']['evaluated_cases'] == 0
    assert run['baseline_metrics']['pass_rate'] is None
    assert run['baseline_metrics']['incomplete_cases'] == 1
    case = client.get(BASE + '/runs/' + run['run_id'] + '/cases').json()['items'][0]
    assert case['status'] == 'incomplete'
    assert case['baseline']['output_truncated'] is True


def test_live_model_pair_case_cap_accounts_for_reserved_cost_before_submission(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'priced.sqlite3', live_enabled=True,
                        api_key='test-only-placeholder', benchmark_mode='groq')
    with TestClient(create_app(settings)) as client:
        response = client.post(BASE + '/runs', json={
            'dataset_id': 'starter-v2',
            'baseline': {'model_id': 'qwen/qwen3.8-27b', 'optimization_enabled': False},
            'candidate': {'model_id': 'qwen/qwen3.8-27b', 'optimization_enabled': False},
            'max_cases': 3,
        })
        assert response.status_code == 422
        assert response.json()['error']['details']['max_cases_per_run'] == 1
        assert client.app.state.store.remaining_daily_cost(settings) == settings.max_daily_cost_usd


def test_completion_budget_changes_benchmark_case_cap(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'extended-priced.sqlite3', live_enabled=True,
                        api_key='test-only-placeholder', benchmark_mode='groq', max_completion_tokens=4096)
    with TestClient(create_app(settings)) as client:
        response = client.post(BASE + '/runs', json={
            'dataset_id': 'starter-v2',
            'baseline': {'model_id': 'qwen/qwen3.8-27b', 'optimization_enabled': False},
            'candidate': {'model_id': 'qwen/qwen3.8-27b', 'optimization_enabled': False},
            'max_cases': 3,
        })
        assert response.status_code == 422
        assert response.json()['error']['details']['max_cases_per_run'] == 2


def test_structurally_valid_but_invalid_history_cursor_is_rejected(client):
    import base64
    import json
    cursor = base64.urlsafe_b64encode(json.dumps([1, 'runs', ['not-a-time', 'not-a-uuid']]).encode()).decode()
    assert client.get(BASE + '/runs', params={'cursor': cursor}).status_code == 422
