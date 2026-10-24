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
