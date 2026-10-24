import pytest
from fastapi.testclient import TestClient

from conftest import SAMPLES, validate, wait_run


@pytest.mark.parametrize(('path', 'schema'), [
    ('health', 'Health'), ('capabilities', 'Capabilities'), ('sample-tasks', 'SampleTasks'),
])
def test_metadata_matches_contract(client, path, schema):
    response = client.get('/api/v1/' + path)
    assert response.status_code == 200
    validate(response.json(), schema)
    if path == 'sample-tasks':
        assert response.json() == SAMPLES
    if path == 'capabilities':
        assert response.json()['demo_enabled'] is True
        assert response.json()['live_enabled'] is False
        assert [m['role'] for m in response.json()['models']] == ['small', 'large']


def test_one_task_cycle_and_persistent_get(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'runs.sqlite3')
    with TestClient(create_app(settings)) as client:
        response = client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': SAMPLES['tasks'][:1]})
        assert response.status_code == 202
        queued = response.json()
        validate(queued, 'Run')
        assert queued['status'] == 'queued'
        assert queued['results'] == []
        location = response.headers['location']
        assert location == '/api/v1/runs/' + queued['id']
        run = wait_run(client, location)
        assert run['status'] == 'completed'
        assert run['completed_attempts'] == run['total_attempts'] == 2
        assert [r['output_text'] for r in run['results']] == ['billing', 'billing']
        assert [r['model_role'] for r in run['results']] == ['large', 'small']
        assert run['comparison']['energy_wh']['baseline'] == pytest.approx(0.0052)
        assert run['comparison']['energy_wh']['optimized'] == pytest.approx(0.00104)
        assert run['measurement_source'] == 'simulated'
        assert run['finished_at'].endswith('Z')
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get(location).json() == run


def test_all_fixtures_and_paired_arithmetic(client):
    response = client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': SAMPLES['tasks']})
    assert response.status_code == 202
    run = wait_run(client, response.headers['location'])
    assert run['status'] == 'completed'
    assert run['completed_attempts'] == run['total_attempts'] == 6
    assert [(r['task_id'], r['policy'], r['routing_reason']) for r in run['results']] == [
        ('classify-1', 'baseline', 'baseline_large'), ('classify-1', 'optimized', 'simple_task_small'),
        ('extract-1', 'baseline', 'baseline_large'), ('extract-1', 'optimized', 'simple_task_small'),
        ('summarize-1', 'baseline', 'baseline_large'), ('summarize-1', 'optimized', 'summary_large'),
    ]
    comparison = run['comparison']
    assert comparison['successful_pairs'] == comparison['energy_pairs'] == comparison['latency_pairs'] == 3
    for name, expected in {
        'energy_wh': (0.0434, 0.02644, 0.01696),
        'carbon_g': (0.01736, 0.010576, 0.006784),
        'latency_ms': (4700, 2750, 1950),
    }.items():
        assert [comparison[name][key] for key in ('baseline', 'optimized', 'saved')] == pytest.approx(expected)
    assert comparison['energy_wh']['savings_pct'] == pytest.approx(39.07834101382488)


def test_subset_order_and_trimmed_prompt(client):
    tasks = [dict(task) for task in reversed(SAMPLES['tasks'][1:])]
    tasks[0]['prompt'] = ' \n' + tasks[0]['prompt'] + '\t '
    response = client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': tasks})
    assert response.status_code == 202
    run = wait_run(client, response.headers['location'])
    assert [r['task_id'] for r in run['results']] == ['summarize-1', 'summarize-1', 'extract-1', 'extract-1']
    assert run['tasks'][0]['prompt'] == SAMPLES['tasks'][2]['prompt']


@pytest.mark.parametrize(('change', 'code'), [
    ({'tasks': []}, 'VALIDATION_ERROR'),
    ({'tasks': [SAMPLES['tasks'][0]] * 11}, 'VALIDATION_ERROR'),
    ({'tasks': [SAMPLES['tasks'][0]] * 2}, 'DUPLICATE_TASK_ID'),
    ({'carbon_intensity_g_per_kwh': -1}, 'VALIDATION_ERROR'),
    ({'carbon_intensity_g_per_kwh': 2001}, 'VALIDATION_ERROR'),
    ({'carbon_intensity_g_per_kwh': True}, 'VALIDATION_ERROR'),
    ({'carbon_intensity_g_per_kwh': '400'}, 'VALIDATION_ERROR'),
    ({'mode': 'other'}, 'VALIDATION_ERROR'),
    ({'unexpected': 'secret-must-not-echo'}, 'VALIDATION_ERROR'),
])
def test_invalid_run_request(client, change, code):
    payload = {'mode': 'demo', 'tasks': SAMPLES['tasks'][:1], **change}
    response = client.post('/api/v1/runs', json=payload)
    assert response.status_code == 422
    validate(response.json(), 'ErrorEnvelope')
    assert response.json()['error']['code'] == code
    assert 'secret-must-not-echo' not in response.text


@pytest.mark.parametrize(('change', 'code'), [
    ({'prompt': '  \t\n'}, 'VALIDATION_ERROR'),
    ({'prompt': 'x' * 2001}, 'VALIDATION_ERROR'),
    ({'prompt': 'modified'}, 'INVALID_DEMO_TASK'),
    ({'type': 'summarize'}, 'INVALID_DEMO_TASK'),
    ({'type': 'invented'}, 'VALIDATION_ERROR'),
    ({'id': 'unknown'}, 'INVALID_DEMO_TASK'),
    ({'id': ''}, 'VALIDATION_ERROR'),
    ({'id': 'x' * 65}, 'VALIDATION_ERROR'),
    ({'id': 'classify-1\n'}, 'VALIDATION_ERROR'),
    ({'id': '../../path'}, 'VALIDATION_ERROR'),
    ({'unexpected': 'secret-must-not-echo'}, 'VALIDATION_ERROR'),
])
def test_invalid_task(client, change, code):
    task = {**SAMPLES['tasks'][0], **change}
    response = client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': [task]})
    assert response.status_code == 422
    validate(response.json(), 'ErrorEnvelope')
    assert response.json()['error']['code'] == code
    assert 'secret-must-not-echo' not in response.text


@pytest.mark.parametrize('body', ['{', '{"mode":"demo","tasks":null}',
                                  '{"mode":"demo","tasks":[],"carbon_intensity_g_per_kwh":NaN}'])
def test_malformed_json_is_safe_envelope(client, body):
    response = client.post('/api/v1/runs', content=body, headers={'Content-Type': 'application/json'})
    assert response.status_code == 422
    validate(response.json(), 'ErrorEnvelope')
    assert response.json()['error']['code'] == 'VALIDATION_ERROR'


@pytest.mark.parametrize(('path', 'status', 'code'), [
    ('/api/v1/runs/00000000-0000-0000-0000-000000000000', 404, 'RUN_NOT_FOUND'),
    ('/api/v1/runs/not-a-uuid', 422, 'VALIDATION_ERROR'),
    ('/api/v1/not-a-route', 404, 'NOT_FOUND'), ('/api/missing', 404, 'NOT_FOUND'),
])
def test_unknown_api_and_run_errors(client, path, status, code):
    response = client.get(path)
    assert response.status_code == status
    validate(response.json(), 'ErrorEnvelope')
    assert response.json()['error']['code'] == code


def test_live_is_truthfully_disabled(client):
    response = client.post('/api/v1/runs', json={'mode': 'live', 'tasks': SAMPLES['tasks'][:1]})
    assert response.status_code == 503
    validate(response.json(), 'ErrorEnvelope')
    assert response.json()['error']['code'] == 'LIVE_UNAVAILABLE'


def test_concurrent_submissions_reserve_exactly_one_slot(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier = Barrier(2)

    def submit():
        barrier.wait(timeout=2)
        return client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': SAMPLES['tasks']})

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(), range(2)))
    assert sorted(r.status_code for r in responses) == [202, 409]
    accepted = next(r for r in responses if r.status_code == 202)
    rejected = next(r for r in responses if r.status_code == 409)
    validate(rejected.json(), 'ErrorEnvelope')
    assert rejected.json()['error']['details']['active_run_id'] == accepted.json()['id']
    assert wait_run(client, accepted.headers['location'])['status'] == 'completed'
    assert client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': SAMPLES['tasks'][:1]}).status_code == 202


def test_zero_intensity_has_zero_carbon_but_no_percentage(client):
    response = client.post('/api/v1/runs', json={'mode': 'demo', 'tasks': SAMPLES['tasks'][:1],
                                               'carbon_intensity_g_per_kwh': 0})
    run = wait_run(client, response.headers['location'])
    assert run['comparison']['energy_pairs'] == 1
    assert run['comparison']['carbon_g'] == {'baseline': 0, 'optimized': 0, 'saved': 0, 'savings_pct': None}


def test_fixtures_resolve_independently_of_cwd(tmp_path, monkeypatch):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    monkeypatch.chdir(tmp_path)
    with TestClient(create_app(Settings(database_path=tmp_path / 'other.sqlite3'))) as client:
        assert client.get('/api/v1/sample-tasks').json() == SAMPLES


def test_generated_response_schema_requires_every_shared_response_field():
    import backend.app.schemas as schemas
    import backend.app.benchmarks.schemas as benchmark_schemas
    from conftest import CONTRACT
    for name, shared in CONTRACT['components']['schemas'].items():
        if name in ('CreateRun', 'Task'):
            continue
        model = getattr(schemas, name, None) or getattr(benchmark_schemas, name)
        generated = model.model_json_schema(mode='serialization')
        assert set(generated['required']) == set(shared['required']), name
        assert set(generated['properties']) == set(shared['properties']), name
        assert generated['additionalProperties'] is False, name
