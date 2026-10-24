import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.providers.base import InferenceResult
from backend.app.schemas import Task
from backend.app.settings import Settings
from backend.app.task_quality import PROFILE_VERSION, system_instruction, validate_output


def test_task_instructions_and_deterministic_validation():
    classification = Task(id='c1', type='classify', prompt='Choose one.',
                          constraints={'allowed_labels': ['billing', 'general']})
    assert 'Allowed labels' in system_instruction(classification)
    assert validate_output(classification, 'billing')[0] == 'passed'
    assert validate_output(classification, 'billing because')[0] == 'failed'

    extraction = Task(id='e1', type='extract', prompt='Return JSON.',
                      constraints={'required_json_fields': ['order_id', 'total']})
    assert validate_output(extraction, '{"order_id":"A-1","total":null}')[0] == 'passed'
    assert validate_output(extraction, '{"order_id":"A-1"}')[0] == 'failed'
    assert validate_output(extraction, 'not json')[0] == 'failed'

    code = Task(id='code1', type='code', prompt='Write a function.')
    assert 'Do not claim that code was executed' in system_instruction(code)
    assert validate_output(code, 'def f(): pass')[0] == 'not_configured'
    assert PROFILE_VERSION == 'task-instructions-v1'


def run_to_terminal(client, path):
    from time import monotonic, sleep
    deadline = monotonic() + 5
    while monotonic() < deadline:
        payload = client.get(path).json()
        if payload['status'] in ('completed', 'partial', 'failed'):
            return payload
        sleep(0.01)
    pytest.fail('run did not finish')


def test_validation_fallback_is_bounded_and_accounts_for_both_calls(tmp_path):
    settings = Settings(database_path=tmp_path / 'fallback.sqlite3', live_enabled=True,
                        api_key='test-only-placeholder')
    with TestClient(create_app(settings)) as client:
        calls = []
        async def infer(prompt, model_id, run_id, allowed_models=None, system_message=None):
            calls.append((model_id, system_message))
            content = 'not json' if model_id == settings.small_model_id else '{"order_id":"E-7"}'
            return InferenceResult(content, 12 if model_id == settings.small_model_id else 20, 10, 4, 'stop', False)
        client.app.state.runner.live.infer = infer
        response = client.post('/api/v1/runs', json={
            'mode': 'live', 'quality_fallback': True,
            'tasks': [{'id': 'extract-7', 'type': 'extract', 'prompt': 'Return JSON with order_id.',
                       'constraints': {'required_json_fields': ['order_id']}}],
        })
        assert response.status_code == 202, response.text
        run = run_to_terminal(client, response.headers['location'])
        assert run['status'] == 'completed'
        assert run['policy_version'] == 'task-routing-v2-fallback'
        assert run['task_profile_version'] == 'task-instructions-v1'
        assert run['total_attempts'] == run['completed_attempts'] == 3
        optimized = run['results'][1]
        assert optimized['fallback_used'] is True
        assert optimized['attempt_count'] == 2
        assert optimized['initial_attempt']['output_validation'] == 'failed'
        assert optimized['fallback_attempt']['output_validation'] == 'passed'
        assert optimized['output_text'] == '{"order_id":"E-7"}'
        assert optimized['model_role'] == 'large'
        assert optimized['input_tokens'] == 20
        assert optimized['output_tokens'] == 8
        assert optimized['latency_ms'] == 32
        assert optimized['cost_usd'] == pytest.approx(optimized['initial_attempt']['cost_usd'] + optimized['fallback_attempt']['cost_usd'])
        assert len(calls) == 3
        assert all(call[1] and 'Extract only facts' in call[1] for call in calls)


def test_truncated_output_is_not_automatically_retried(tmp_path):
    settings = Settings(database_path=tmp_path / 'truncated.sqlite3', live_enabled=True,
                        api_key='test-only-placeholder')
    with TestClient(create_app(settings)) as client:
        calls = []
        async def infer(prompt, model_id, run_id, allowed_models=None, system_message=None):
            calls.append(model_id)
            return InferenceResult('not json', 12, 10, 3, 'length', True)
        client.app.state.runner.live.infer = infer
        response = client.post('/api/v1/runs', json={
            'mode': 'live', 'quality_fallback': True,
            'tasks': [{'id': 'extract-8', 'type': 'extract', 'prompt': 'Return JSON.'}],
        })
        assert response.status_code == 202, response.text
        run = run_to_terminal(client, response.headers['location'])
        assert run['total_attempts'] == run['completed_attempts'] == 2
        assert len(calls) == 2
        assert run['results'][1]['output_truncated'] is True
        assert run['results'][1]['fallback_used'] is False


def test_fallback_is_rejected_for_demo_runs(client):
    response = client.post('/api/v1/runs', json={
        'mode': 'demo', 'quality_fallback': True,
        'tasks': [{'id': 'classify-1', 'type': 'classify', 'prompt': 'not the fixture'}],
    })
    assert response.status_code == 422
