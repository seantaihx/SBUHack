import json
import os

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.providers.base import InferenceResult
from backend.app.settings import Settings


def agent_client(tmp_path, **overrides):
    settings = Settings(database_path=tmp_path / 'agent.sqlite3', agent_enabled=True,
                        agent_workspace_root=tmp_path / 'workspace', live_enabled=True,
                        api_key='test-only-placeholder', **overrides)
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
        assert caps['max_steps'] == 20
        invalid = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Edit code', 'read_paths': ['README.md'],
        })
        assert invalid.status_code == 422
        localhost = TestClient(client.app, base_url='http://localhost', client=('127.0.0.1', 1234))
        assert localhost.get('/api/v1/agent/capabilities').status_code == 200


def test_agent_rejects_credential_like_user_input_without_echoing_it(tmp_path):
    client, _ = agent_client(tmp_path)
    credential = 'gsk_abcdefghijklmnopqrstuvwxyz'
    with client:
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': f'Draft a note using {credential}.',
            'confirm_provider_submission': True, 'write_paths': ['note.txt'],
        })
        assert response.status_code == 422
        assert credential not in response.text
        assert response.json()['error']['code'] == 'AGENT_CREDENTIAL_INPUT'


def test_agent_redacts_credential_like_model_operation_from_event_log(tmp_path):
    client, _ = agent_client(tmp_path)
    credential = 'gsk_abcdefghijklmnopqrstuvwxyz'
    with client:
        async def infer(*args, **kwargs):
            return InferenceResult(json.dumps({'summary': 'Try a disallowed action.',
                                              'action': {'operation': 'write_file', 'path': credential,
                                                         'content': 'must not be written'}}),
                                   10, 50, 20, 'stop', False)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Draft a safe note.', 'confirm_provider_submission': True,
            'write_paths': ['note.txt'],
        })
        run = wait_for(client, started.json()['run_id'], 'paused')
        serialized = json.dumps(run)
        assert credential not in serialized
        assert run['events'][-1]['target'] == '[redacted credential-like text]'


def test_agent_actions_require_exact_approval_and_log_human_readable_steps(tmp_path):
    client, settings = agent_client(tmp_path)
    target = settings.agent_workspace_root / 'note.txt'
    target.write_text('before\n', encoding='utf-8')
    responses = [propose('read_file', 'note.txt'), propose('write_file', 'note.txt', 'after\n'),
                 propose('finish', final_text='Updated note.')]
    calls = []
    with client:
        async def infer(*args, **kwargs):
            calls.append(kwargs)
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
        assert run['handoff']['summary'] == 'Updated note.'
        assert run['handoff']['completed_task_ids'] == ['workspace-task']
        assert run['handoff']['files_read'] == ['note.txt']
        assert run['handoff']['files_changed'] == ['note.txt']
        assert run['handoff']['role_model_ids']['writer'] == run['agent_model_id']
        assert 'before\\r\\n' not in json.dumps(run['handoff'])
        assert run['input_tokens'] == 150 and run['output_tokens'] == 60
        assert run['usage_reported_calls'] == 3 and run['estimated_cost_usd'] is not None
        assert all(call['task_id'] == 'workspace-task' for call in calls)
        assert [call['max_completion_tokens'] for call in calls] == [12000, 11930, 11860]
        page = client.get(f'/api/v1/agent-runs/{run_id}/events?limit=3')
        assert page.status_code == 200
        assert page.json()['next_cursor'] == '3'


def test_single_agent_token_budget_stops_before_proposed_file_action(tmp_path):
    client, settings = agent_client(tmp_path, max_agent_tokens_per_run=2048, max_agent_tokens_per_task=1024)
    calls = []
    with client:
        async def infer(*args, **kwargs):
            calls.append(kwargs)
            response = {'summary': 'Write the requested output.',
                        'action': {'operation': 'write_file', 'path': 'output.py', 'content': 'print("safe")'}}
            return InferenceResult(json.dumps(response), 10, 1100, 100, 'stop', False)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Generate a tiny code sample.',
            'confirm_provider_submission': True, 'write_paths': ['output.py'], 'max_steps': 3,
        })
        run = wait_for(client, started.json()['run_id'], 'failed')
        assert calls[0]['max_completion_tokens'] == 1024
        assert calls[0]['task_id'] == 'workspace-task'
        assert run['stop_reason'] == 'TOKEN_BUDGET_REACHED'
        assert run['handoff']['stop_reason'] == 'TOKEN_BUDGET_REACHED'
        assert run['input_tokens'] == 1100 and run['output_tokens'] == 100
        assert run['pending_action'] is None
        assert not (settings.agent_workspace_root / 'output.py').exists()


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


def test_agent_fails_honestly_after_reaching_model_call_limit(tmp_path):
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
        assert finished.json()['status'] == 'failed'
        assert finished.json()['stop_reason'] == 'STEP_LIMIT_REACHED'


def test_agent_allows_longer_bounded_run_but_never_above_provider_budget(tmp_path):
    client, settings = agent_client(tmp_path)
    read_paths = [f'file-{index}.txt' for index in range(12)]
    for path in read_paths:
        (settings.agent_workspace_root / path).write_text(path, encoding='utf-8')
    responses = [propose('read_file', path) for path in read_paths] + [propose('finish', final_text='All 12 files reviewed.')]
    with client:
        async def infer(*args, **kwargs):
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Do a longer bounded task.', 'confirm_provider_submission': True,
            'read_paths': read_paths, 'max_steps': 13,
        })
        assert response.status_code == 202, response.text
        run_id = response.json()['run_id']
        for _ in read_paths:
            run = wait_for(client, run_id, 'awaiting_approval')
            approve(client, run)
            client.post(f'/api/v1/agent-runs/{run_id}/continue')
        run = wait_for(client, run_id, 'completed')
        assert run['max_steps'] == 13
        assert run['model_calls'] == 13
        assert run['checkpoint_sequence'] > 1
        too_many = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Exceed the configured budget.', 'confirm_provider_submission': True,
            'write_paths': ['out.txt'], 'max_steps': 21,
        })
        assert too_many.status_code == 422


def test_completion_checks_pause_unverified_finish_and_verify_after_output(tmp_path):
    client, settings = agent_client(tmp_path)
    responses = [propose('finish', final_text='I completed the output.'),
                 propose('write_file', 'result.json', '{"ok": true}'),
                 propose('finish', final_text='The JSON output is ready.')]
    with client:
        async def infer(*args, **kwargs):
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'code', 'instruction': 'Create valid JSON.', 'confirm_provider_submission': True,
            'write_paths': ['result.json'], 'max_steps': 4,
            'completion_checks': [{'check_id': 'json-result', 'kind': 'valid_json', 'path': 'result.json'}],
        })
        assert response.status_code == 202, response.text
        run = wait_for(client, response.json()['run_id'], 'paused')
        assert run['stop_reason'] == 'COMPLETION_CHECKS_FAILED'
        assert run['status'] == 'running'
        assert run['verification_status'] == 'failed'
        assert run['completion_check_results'][0]['status'] == 'failed'
        client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
        run = wait_for(client, run['run_id'], 'awaiting_approval')
        approve(client, run)
        client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
        run = wait_for(client, run['run_id'], 'completed')
        assert run['verification_status'] == 'verified'
        assert run['completion_check_results'][0]['status'] == 'passed'
        assert (settings.agent_workspace_root / 'result.json').read_text(encoding='utf-8') == '{"ok": true}'


def test_completion_check_must_target_permitted_write_path(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Draft a file.', 'confirm_provider_submission': True,
            'read_paths': ['README.md'],
            'completion_checks': [{'check_id': 'output', 'kind': 'file_exists', 'path': 'README.md'}],
        })
        assert response.status_code == 422


def test_changed_file_can_be_reread_but_noop_write_is_paused(tmp_path):
    client, settings = agent_client(tmp_path)
    target = settings.agent_workspace_root / 'note.txt'
    target.write_text('first', encoding='utf-8')
    read_responses = [propose('read_file', 'note.txt'), propose('read_file', 'note.txt')]
    with client:
        async def infer(*args, **kwargs):
            return read_responses.pop(0)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Read a file after it changes.', 'confirm_provider_submission': True,
            'read_paths': ['note.txt'], 'write_paths': ['note.txt'], 'max_steps': 4,
        })
        run = wait_for(client, response.json()['run_id'], 'awaiting_approval')
        approve(client, run)
        target.write_text('changed', encoding='utf-8')
        client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
        run = wait_for(client, run['run_id'], 'awaiting_approval')
        assert run['pending_action']['before_text'] == 'changed'

    # A write proposal identical to the current bytes is not meaningful progress.
    client2, settings2 = agent_client(tmp_path / 'noop')
    same = 'unchanged'
    (settings2.agent_workspace_root / 'note.txt').write_text(same, encoding='utf-8')
    with client2:
        async def infer_noop(*args, **kwargs):
            return propose('write_file', 'note.txt', same)
        client2.app.state.agents.live.infer = infer_noop
        response = client2.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Update a file.', 'confirm_provider_submission': True,
            'write_paths': ['note.txt'],
        })
        run = wait_for(client2, response.json()['run_id'], 'paused')
        assert run['stop_reason'] == 'NO_PROGRESS_LOOP'
        assert run['pending_action'] is None
        assert (settings2.agent_workspace_root / 'note.txt').read_text(encoding='utf-8') == same


def test_transient_provider_failure_requires_explicit_continue(tmp_path):
    from backend.app.providers.base import ProviderError

    client, settings = agent_client(tmp_path)
    with client:
        calls = 0
        async def infer(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ProviderError('PROVIDER_TIMEOUT')
            if calls == 2:
                return propose('write_file', 'note.txt', 'Recovered note.\n')
            return propose('finish', final_text='Recovered after review.')
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Draft a note.', 'confirm_provider_submission': True,
            'write_paths': ['note.txt'], 'max_steps': 3,
        })
        run = wait_for(client, response.json()['run_id'], 'paused')
        assert calls == 1
        assert run['stop_reason'] == 'PROVIDER_TIMEOUT'
        assert client.post(f"/api/v1/agent-runs/{run['run_id']}/continue").status_code == 200
        run = wait_for(client, run['run_id'], 'awaiting_approval')
        assert run['pending_action']['operation'] == 'write_file'
        approve(client, run)
        assert client.post(f"/api/v1/agent-runs/{run['run_id']}/continue").status_code == 200
        run = wait_for(client, run['run_id'], 'completed')
        assert calls == 3
        assert run['final_text'] == 'Recovered after review.'
        assert run['retry_count'] == 1
        assert (settings.agent_workspace_root / 'note.txt').read_text(encoding='utf-8') == 'Recovered note.\n'


def test_repeated_identical_provider_failures_stop_after_three_user_reviewed_calls(tmp_path):
    from backend.app.providers.base import ProviderError

    client, _ = agent_client(tmp_path)
    with client:
        calls = 0
        async def infer(*args, **kwargs):
            nonlocal calls
            calls += 1
            raise ProviderError('PROVIDER_TIMEOUT')
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-runs', json={
            'task_type': 'write', 'instruction': 'Draft a file.', 'confirm_provider_submission': True,
            'write_paths': ['note.txt'], 'max_steps': 8,
        })
        run = wait_for(client, response.json()['run_id'], 'paused')
        assert calls == 1
        for _ in range(2):
            client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
            run = wait_for(client, run['run_id'], 'failed' if calls == 3 else 'paused')
        assert calls == 3
        assert run['stop_reason'] == 'REPEATED_PROVIDER_FAILURE'
        assert run['repeated_failure_count'] == 3
        assert client.post(f"/api/v1/agent-runs/{run['run_id']}/continue").status_code == 409


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


def test_manager_workflow_uses_reviewed_plan_serial_specialists_approvals_and_handoff(tmp_path):
    client, settings = agent_client(tmp_path)
    plan = {
        'summary': 'Create a short document, then prepare a code example and review both outputs.',
        'tasks': [
            {'task_id': 'write-doc', 'agent_name': 'Writer 1', 'role': 'writer', 'title': 'Write the guide',
             'instruction': 'Create a concise guide.', 'read_paths': [], 'write_paths': ['draft.txt'],
             'depends_on': [], 'success_criteria': ['draft.txt exists']},
            {'task_id': 'code-example', 'agent_name': 'Coder 1', 'role': 'coder', 'title': 'Create the example',
             'instruction': 'Create a small example as text; do not run it.', 'read_paths': [], 'write_paths': ['example.py'],
             'depends_on': ['write-doc'], 'success_criteria': ['example.py exists']},
        ],
    }
    review = {'summary': 'Both planned outputs exist and the requested workflow is complete.',
              'status': 'ready', 'open_items': []}
    responses = [
        InferenceResult(json.dumps(plan), 12, 100, 60, 'stop', False),
        propose('write_file', 'draft.txt', 'A short guide.\n'),
        propose('finish', final_text='The guide draft was saved.'),
        propose('write_file', 'example.py', 'print("hello")\n'),
        propose('finish', final_text='The example was saved as text and not executed.'),
        InferenceResult(json.dumps(review), 12, 120, 50, 'stop', False),
    ]
    completion_caps = []
    configured_models = []

    with client:
        async def infer(*args, **kwargs):
            completion_caps.append(kwargs['max_completion_tokens'])
            configured_models.append(args[1])
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Create a short guide and a code example. Do not run code.',
            'confirm_provider_submission': True,
            'read_paths': ['README.md'], 'write_paths': ['draft.txt', 'example.py'],
            'max_steps': 8, 'max_tasks': 4,
            'completion_checks': [
                {'check_id': 'draft-exists', 'kind': 'file_exists', 'path': 'draft.txt'},
                {'check_id': 'example-exists', 'kind': 'file_exists', 'path': 'example.py'},
            ],
        })
        assert response.status_code == 202, response.text
        run_id = response.json()['run_id']
        run = wait_for(client, run_id, 'awaiting_plan_approval')
        assert run['run_mode'] == 'team'
        assert [task['role'] for task in run['workflow_tasks']] == ['writer', 'coder']
        assert run['workflow_tasks'][1]['depends_on'] == ['write-doc']
        assert not (settings.agent_workspace_root / 'draft.txt').exists()
        assert run['pending_action'] is None

        stale = client.post(f'/api/v1/agent-runs/{run_id}/plan-approvals', json={
            'plan_hash': '0' * 64, 'approved': True,
        })
        assert stale.status_code == 409
        decision = client.post(f'/api/v1/agent-runs/{run_id}/plan-approvals', json={
            'plan_hash': run['plan_hash'], 'approved': True,
        })
        assert decision.status_code == 200
        run = wait_for(client, run_id, 'awaiting_approval')
        assert run['pending_action']['agent_name'] == 'Writer 1'
        assert run['pending_action']['agent_role'] == 'writer'
        assert not (settings.agent_workspace_root / 'draft.txt').exists()
        run = approve(client, run)
        assert (settings.agent_workspace_root / 'draft.txt').read_text(encoding='utf-8') == 'A short guide.\n'
        assert run['workflow_tasks'][0]['steps_completed'] == 1

        client.post(f'/api/v1/agent-runs/{run_id}/continue')
        run = wait_for(client, run_id, 'paused')
        assert run['stop_reason'] == 'TASK_COMPLETE_REVIEW_NEXT'
        client.post(f'/api/v1/agent-runs/{run_id}/continue')
        run = wait_for(client, run_id, 'awaiting_approval')
        assert run['active_task_id'] == 'code-example'
        assert run['pending_action']['agent_name'] == 'Coder 1'
        assert not (settings.agent_workspace_root / 'example.py').exists()
        run = approve(client, run)
        assert (settings.agent_workspace_root / 'example.py').read_text(encoding='utf-8') == 'print("hello")\n'
        client.post(f'/api/v1/agent-runs/{run_id}/continue')
        run = wait_for(client, run_id, 'paused')
        assert run['workflow_tasks'][1]['status'] == 'completed'
        client.post(f'/api/v1/agent-runs/{run_id}/continue')
        run = wait_for(client, run_id, 'completed')

        assert run['manager_model_calls'] == 2
        assert run['model_calls'] == 6
        assert run['usage_reported_calls'] == 6
        assert run['verification_status'] == 'verified'
        assert run['workflow_stage'] == 'completed'
        assert run['handoff']['completed_task_ids'] == ['write-doc', 'code-example']
        assert run['handoff']['files_changed'] == ['draft.txt', 'example.py']
        assert run['handoff']['tasks'][0]['instruction_summary'] == 'Create a concise guide.'
        assert run['handoff']['tasks'][0]['write_paths'] == ['draft.txt']
        assert run['handoff']['tasks'][1]['write_paths'] == ['example.py']
        assert run['handoff']['estimated_carbon_g'] is None
        assert run['handoff']['next_steps']
        assert run['handoff']['original_task_summary'] == 'Create a short guide and a code example. Do not run code.'
        assert any(action['operation'] == 'write_file' and action['decision'] == 'completed'
                   for action in run['handoff']['actions'])
        assert run['max_tokens_per_run'] == 48000
        assert run['max_tokens_per_task'] == 12000
        assert len(completion_caps) == 6
        assert completion_caps[0] == 12000
        assert all(1 <= limit <= 12000 for limit in completion_caps)
        assert configured_models == [settings.agent_role_models[role] for role in
                                     ('manager', 'writer', 'writer', 'coder', 'coder', 'manager')]
        assert responses == []


def test_manager_plan_rejects_case_aliases_for_write_paths_on_case_insensitive_filesystems(tmp_path):
    if os.path.normcase('Guide.txt') != os.path.normcase('GUIDE.TXT'):
        pytest.skip('This filesystem treats differently cased paths as distinct files.')

    client, settings = agent_client(tmp_path)
    plan = {
        'summary': 'Prepare two outputs.',
        'tasks': [
            {'task_id': 'first', 'agent_name': 'Writer 1', 'role': 'writer', 'title': 'Write first version',
             'instruction': 'Write the first output.', 'read_paths': [], 'write_paths': ['guide.txt'],
             'depends_on': [], 'success_criteria': ['The requested content is written.']},
            {'task_id': 'second', 'agent_name': 'Writer 2', 'role': 'writer', 'title': 'Write second version',
             'instruction': 'Write the second output.', 'read_paths': [], 'write_paths': ['GUIDE.TXT'],
             'depends_on': ['first'], 'success_criteria': ['The requested content is written.']},
        ],
    }

    with client:
        async def infer(*args, **kwargs):
            return InferenceResult(json.dumps(plan), 10, 80, 40, 'stop', False)
        client.app.state.agents.live.infer = infer
        response = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Write a guide in two stages.', 'confirm_provider_submission': True,
            'read_paths': [], 'write_paths': ['guide.txt', 'GUIDE.TXT'], 'max_steps': 4,
        })
        assert response.status_code == 202, response.text
        run = wait_for(client, response.json()['run_id'], 'paused')
        assert run['stop_reason'] == 'INVALID_WORKFLOW_RESPONSE'
        assert run['workflow_tasks'] == []
        assert not any((settings.agent_workspace_root / name).exists() for name in ('guide.txt', 'GUIDE.TXT'))


def test_manager_rejects_conflicting_specialist_output_paths(tmp_path):
    client, settings = agent_client(tmp_path)
    plan = {'summary': 'Two workers will draft the same output.', 'tasks': [
        {'task_id': 'writer-a', 'agent_name': 'Writer A', 'role': 'writer', 'title': 'Draft A',
         'instruction': 'Draft the file.', 'read_paths': [], 'write_paths': ['shared.txt'], 'depends_on': [],
         'success_criteria': ['shared.txt is complete']},
        {'task_id': 'writer-b', 'agent_name': 'Writer B', 'role': 'writer', 'title': 'Draft B',
         'instruction': 'Draft the file again.', 'read_paths': [], 'write_paths': ['shared.txt'], 'depends_on': [],
         'success_criteria': ['shared.txt is complete']},
    ]}
    with client:
        async def infer(*args, **kwargs):
            return InferenceResult(json.dumps(plan), 12, 100, 60, 'stop', False)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Create one shared file.', 'confirm_provider_submission': True,
            'write_paths': ['shared.txt'], 'max_steps': 5,
        })
        run = wait_for(client, started.json()['run_id'], 'paused')
        assert run['stop_reason'] == 'INVALID_WORKFLOW_RESPONSE'
        assert not (settings.agent_workspace_root / 'shared.txt').exists()


def test_manager_workflow_token_budget_stops_before_next_call(tmp_path):
    client, settings = agent_client(tmp_path, max_agent_tokens_per_run=2048, max_agent_tokens_per_task=2048)
    plan = {'summary': 'Write one file.', 'tasks': [
        {'task_id': 'writer', 'agent_name': 'Writer', 'role': 'writer', 'title': 'Write file',
         'instruction': 'Create the file.', 'read_paths': [], 'write_paths': ['result.txt'], 'depends_on': [],
         'success_criteria': ['result.txt exists']},
    ]}
    completion_caps = []
    with client:
        async def infer(*args, **kwargs):
            completion_caps.append(kwargs['max_completion_tokens'])
            return InferenceResult(json.dumps(plan), 12, 1024, 1024, 'stop', False)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Write one file.', 'confirm_provider_submission': True,
            'write_paths': ['result.txt'], 'max_steps': 4,
        })
        run = wait_for(client, started.json()['run_id'], 'awaiting_plan_approval')
        assert completion_caps == [2048]
        approved = client.post(f"/api/v1/agent-runs/{run['run_id']}/plan-approvals", json={
            'plan_hash': run['plan_hash'], 'approved': True,
        })
        run = wait_for(client, run['run_id'], 'failed')
        assert run['stop_reason'] == 'TOKEN_BUDGET_REACHED'
        assert completion_caps == [2048]
        assert not (settings.agent_workspace_root / 'result.txt').exists()


def test_manager_workflow_deadline_expires_before_approval(tmp_path):
    from datetime import datetime, timedelta, timezone

    client, _ = agent_client(tmp_path)
    plan = {'summary': 'Write one file.', 'tasks': [
        {'task_id': 'writer', 'agent_name': 'Writer', 'role': 'writer', 'title': 'Write file',
         'instruction': 'Create the file.', 'read_paths': [], 'write_paths': ['result.txt'], 'depends_on': [],
         'success_criteria': ['result.txt exists']},
    ]}
    with client:
        async def infer(*args, **kwargs):
            return InferenceResult(json.dumps(plan), 12, 100, 60, 'stop', False)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Write one file.', 'confirm_provider_submission': True,
            'write_paths': ['result.txt'], 'max_steps': 4,
        })
        run = wait_for(client, started.json()['run_id'], 'awaiting_plan_approval')
        saved = client.app.state.store.get_agent(run['run_id'])
        saved.workflow_deadline_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat().replace('+00:00', 'Z')
        client.app.state.store.save_agent(saved)
        expired = client.post(f"/api/v1/agent-runs/{run['run_id']}/plan-approvals", json={
            'plan_hash': run['plan_hash'], 'approved': True,
        }).json()
        assert expired['status'] == 'failed'
        assert expired['stop_reason'] == 'WORKFLOW_DEADLINE_REACHED'


def test_manager_workflow_per_specialist_call_limit_is_enforced(tmp_path):
    client, settings = agent_client(tmp_path)
    plan = {'summary': 'Write one file.', 'tasks': [
        {'task_id': 'writer', 'agent_name': 'Writer', 'role': 'writer', 'title': 'Write file',
         'instruction': 'Create the file.', 'read_paths': [], 'write_paths': ['result.txt'], 'depends_on': [],
         'success_criteria': ['result.txt exists']},
    ]}
    responses = [InferenceResult(json.dumps(plan), 12, 100, 60, 'stop', False),
                 propose('write_file', 'result.txt', 'safe text')]
    with client:
        async def infer(*args, **kwargs):
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Write one file.', 'confirm_provider_submission': True,
            'write_paths': ['result.txt'], 'max_steps': 4, 'max_task_calls': 1,
        })
        run = wait_for(client, started.json()['run_id'], 'awaiting_plan_approval')
        client.post(f"/api/v1/agent-runs/{run['run_id']}/plan-approvals", json={
            'plan_hash': run['plan_hash'], 'approved': True,
        })
        run = wait_for(client, run['run_id'], 'awaiting_approval')
        approve(client, run)
        client.post(f"/api/v1/agent-runs/{run['run_id']}/continue")
        run = wait_for(client, run['run_id'], 'failed')
        assert run['stop_reason'] == 'TASK_STEP_LIMIT_REACHED'
        assert (settings.agent_workspace_root / 'result.txt').read_text(encoding='utf-8') == 'safe text'
