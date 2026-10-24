import json

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.providers.base import InferenceResult
from backend.app.settings import Settings


def agent_client(tmp_path):
    settings = Settings(database_path=tmp_path / 'agent.sqlite3', agent_enabled=True,
                        agent_workspace_root=tmp_path / 'workspace', live_enabled=True,
                        api_key='test-only-placeholder')
    settings.agent_workspace_root.mkdir(parents=True)
    return TestClient(create_app(settings), base_url='http://127.0.0.1', client=('127.0.0.1', 1234)), settings


def wait_for(client, run_id, phase):
    from time import monotonic, sleep
    deadline = monotonic() + 3
    while monotonic() < deadline:
        run = client.get(f'/api/v1/agent-runs/{run_id}').json()
        if run['phase'] == phase:
            return run
        sleep(0.01)
    pytest.fail(f'agent did not reach phase {phase}')


def propose(operation, path=None, content=None, final_text=None):
    action = {'operation': operation}
    if path is not None: action['path'] = path
    if content is not None: action['content'] = content
    if final_text is not None: action['final_text'] = final_text
    return InferenceResult(json.dumps({'summary': f'Propose {operation}.', 'action': action}), 10, 50, 20, 'stop', False)


def approve(client, run):
    pending = run['pending_action']
    response = client.post(f"/api/v1/agent-runs/{run['run_id']}/approvals", json={
        'action_id': pending['action_id'], 'action_hash': pending['action_hash'], 'approved': True,
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_agent_requires_explicit_scope_and_provider_confirmation(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        caps = client.get('/api/v1/agent/capabilities').json()
        assert caps['enabled'] is True
        assert caps['shell_execution_enabled'] is False
        assert caps['network_tools_enabled'] is False
        invalid = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Edit code', 'read_paths': ['README.md'],
        })
        assert invalid.status_code == 422
        localhost = TestClient(client.app, base_url='http://localhost', client=('127.0.0.1', 1234))
        assert localhost.get('/api/v1/agent/capabilities').status_code == 200


def test_agent_actions_require_exact_approval_and_log_human_readable_steps(tmp_path):
    client, settings = agent_client(tmp_path)
    target = settings.agent_workspace_root / 'note.txt'
    target.write_text('before\n', encoding='utf-8')
    responses = [propose('read_file', 'note.txt'), propose('write_file', 'note.txt', 'after\n'),
                 propose('finish', final_text='Updated note.')]
    with client:
        async def infer(*args, **kwargs):
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Update the note.', 'confirm_provider_submission': True,
            'read_paths': ['note.txt'], 'write_paths': ['note.txt'], 'max_steps': 4,
        })
        assert response.status_code == 202, response.text
        run_id = response.json()['run_id']
        run = wait_for(client, run_id, 'awaiting_approval')
        assert run['pending_action']['before_text'] == 'before\r\n'
        pending = run['pending_action']
        wrong = client.post(f'/api/v1/agent-runs/{run_id}/approvals', json={
            'action_id': pending['action_id'], 'action_hash': '0' * 64, 'approved': True,
        })
        assert wrong.status_code == 409
        run = approve(client, run)
        assert run['phase'] == 'paused'
        assert run['events'][-1]['details'] == 'before\r\n'

        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 200
        run = wait_for(client, run_id, 'awaiting_approval')
        assert run['pending_action']['before_text'] == 'before\r\n'
        assert run['pending_action']['content'] == 'after\n'
        run = approve(client, run)
        assert target.read_text(encoding='utf-8') == 'after\n'
        assert 'SHA-256:' in run['events'][-1]['details']

        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 200
        run = wait_for(client, run_id, 'completed')
        assert run['final_text'] == 'Updated note.'
        page = client.get(f'/api/v1/agent-runs/{run_id}/events?limit=3')
        assert page.status_code == 200
        assert page.json()['next_cursor'] == '3'


@pytest.mark.parametrize(('action', 'stop_reason'), [
    ({'operation': 'run_shell', 'command': 'rm -rf .'}, 'OUT_OF_SCOPE_OPERATION'),
    ({'operation': 'write_file', 'path': '../outside.txt', 'content': 'x'}, 'OUT_OF_SCOPE_PATH'),
])
def test_agent_denies_disallowed_operations_without_running_them(tmp_path, action, stop_reason):
    client, settings = agent_client(tmp_path)
    with client:
        async def infer(*args, **kwargs):
            return InferenceResult(json.dumps({'summary': 'Try an operation.', 'action': action}), 10, 50, 20, 'stop', False)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Do a bounded task.', 'confirm_provider_submission': True,
            'read_paths': ['allowed.txt'], 'write_paths': ['allowed.txt'],
        })
        assert response.status_code == 202
        run = wait_for(client, response.json()['run_id'], 'paused')
        assert run['stop_reason'] == stop_reason
        assert run['pending_action'] is None
        assert list(settings.agent_workspace_root.iterdir()) == []
        assert run['events'][-1]['decision'] == 'denied_out_of_scope'


def test_agent_duplicate_operations_pause_without_second_execution(tmp_path):
    client, settings = agent_client(tmp_path)
    (settings.agent_workspace_root / 'allowed.txt').write_text('safe', encoding='utf-8')
    with client:
        async def infer(*args, **kwargs):
            return propose('read_file', 'allowed.txt')
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Read one file.', 'confirm_provider_submission': True,
            'read_paths': ['allowed.txt'], 'max_steps': 4,
        })
        run = wait_for(client, response.json()['run_id'], 'awaiting_approval')
        run = approve(client, run)
        client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
        run = wait_for(client, run['run_id'], 'paused')
        assert run['stop_reason'] == 'DUPLICATE_OPERATION'
        assert run['events'][-1]['decision'] == 'denied_duplicate'
        assert run['steps_completed'] == 1


def test_agent_can_finish_cleanly_after_reaching_model_call_limit(tmp_path):
    client, settings = agent_client(tmp_path)
    (settings.agent_workspace_root / 'allowed.txt').write_text('safe', encoding='utf-8')
    with client:
        async def infer(*args, **kwargs):
            return propose('read_file', 'allowed.txt')
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Read one file.', 'confirm_provider_submission': True,
            'read_paths': ['allowed.txt'], 'max_steps': 1,
        })
        run = wait_for(client, response.json()['run_id'], 'awaiting_approval')
        run = approve(client, run)
        assert run['phase'] == 'paused'
        finished = client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
        assert finished.status_code == 200
        assert finished.json()['status'] == 'completed'
        assert finished.json()['stop_reason'] == 'STEP_LIMIT_REACHED'


def test_agent_paths_block_secrets_and_remote_clients(tmp_path):
    client, settings = agent_client(tmp_path)
    with client:
        remote = TestClient(client.app, base_url='http://127.0.0.1', client=('192.0.2.15', 1234))
        assert remote.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Try local route.', 'confirm_provider_submission': True,
            'read_paths': ['allowed.txt'],
        }).status_code == 403
        for path in ('.env', '.env.local', '../outside', '.git/config', 'node_modules/pkg/file'):
            response = client.post('/api/v1/agent-runs', json={
                'task_type': 'code', 'instruction': 'Read file', 'confirm_provider_submission': True,
                'read_paths': [path],
            })
            assert response.status_code == 422
