"""Current v1.1 progress/recovery contract; see docs/READINESS_REVIEW.md.

The incoming implementation replaced periodic review and budget-extension APIs.
"""
import json
from uuid import uuid4

import pytest

from test_agents import agent_client, approve, propose, wait_for
from backend.app.providers.base import InferenceResult, ProviderError


def test_legacy_run_missing_usage_is_unknown():
    from backend.app.agent_schemas import AgentRun
    old = AgentRun(run_id=uuid4(), status='running', phase='paused',
                   task_type='code', workspace_name='sandbox', instruction='Legacy',
                   read_paths=['a.txt'], write_paths=[], max_steps=8, model_calls=3,
                   created_at='2026-10-24T00:00:00Z')
    assert old.input_tokens is None and old.estimated_cost_usd is None


def request_body(**overrides):
    return {
        'task_type': 'code', 'instruction': 'Update the file.',
        'confirm_provider_submission': True, 'read_paths': ['a.txt'],
        'write_paths': ['a.txt'], 'max_steps': 4, **overrides,
    }


@pytest.mark.parametrize('legacy_field,value', [
    ('review_interval', 2), ('max_elapsed_seconds', 60),
    ('checklist', ['Review the output']),
])
def test_removed_progress_fields_are_rejected_not_silently_ignored(tmp_path, legacy_field, value):
    client, _ = agent_client(tmp_path)
    with client:
        response = client.post('/api/v1/agent-runs', json=request_body(**{legacy_field: value}))
        assert response.status_code == 422
        assert client.app.state.store.active_run() is None


@pytest.mark.parametrize('endpoint', ['extend', 'review'])
def test_removed_progress_endpoints_are_not_advertised(tmp_path, endpoint):
    client, _ = agent_client(tmp_path)
    with client:
        response = client.post(f'/api/v1/agent-runs/{uuid4()}/{endpoint}', json={})
        # The SPA GET catch-all makes unknown POST routes return 405.
        assert response.status_code == 405
        assert f'/api/v1/agent-runs/{{run_id}}/{endpoint}' not in client.app.openapi()['paths']


def test_continue_cannot_dispatch_while_approval_is_pending(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        async def infer(*args, **kwargs):
            return propose('write_file', 'a.txt', 'new')
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-runs', json=request_body())
        assert started.status_code == 202
        run_id = started.json()['run_id']
        wait_for(client, run_id, 'awaiting_approval')
        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 409
        assert client.get(f'/api/v1/agent-runs/{run_id}').json()['model_calls'] == 1


def test_restart_invalidates_approval_and_preserves_completed_work(tmp_path):
    client, settings = agent_client(tmp_path)
    with client:
        responses = [propose('write_file', 'a.txt', 'approved'),
                     propose('write_file', 'a.txt', 'unapproved')]
        async def infer(*args, **kwargs):
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-runs', json=request_body())
        assert started.status_code == 202
        run_id = started.json()['run_id']
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        client.post(f'/api/v1/agent-runs/{run_id}/continue')
        pending_run = wait_for(client, run_id, 'awaiting_approval')
        pending = pending_run['pending_action']
        recovered = client.app.state.store.recover()
        assert run_id in recovered
        client.app.state.agents.refresh_recovered_handoff(run_id)
        run = client.get(f'/api/v1/agent-runs/{run_id}').json()
        assert run['phase'] == 'paused'
        assert run['model_calls'] == 2 and run['steps_completed'] == 1
        assert run['pending_action'] is None
        assert run['stop_reason'] == 'APPLICATION_RESTARTED_REVIEW_REQUIRED'
        assert run['handoff'] is not None
        assert (settings.agent_workspace_root / 'a.txt').read_text() == 'approved'
        stale = client.post(f'/api/v1/agent-runs/{run_id}/approvals', json={
            'action_id': pending['action_id'], 'action_hash': pending['action_hash'], 'approved': True,
        })
        assert stale.status_code == 409
        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 200


def test_stop_pending_write_never_changes_file_and_keeps_handoff(tmp_path):
    client, settings = agent_client(tmp_path)
    target = settings.agent_workspace_root / 'a.txt'
    target.write_text('original')
    with client:
        async def infer(*args, **kwargs):
            return propose('write_file', 'a.txt', 'unapproved')
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-runs', json=request_body())
        assert started.status_code == 202
        run_id = started.json()['run_id']
        pending_run = wait_for(client, run_id, 'awaiting_approval')
        stopped = client.post(f'/api/v1/agent-runs/{run_id}/stop')
        assert stopped.status_code == 200
        run = stopped.json()
        assert run['status'] == 'cancelled'
        assert run['pending_action'] is None and run['handoff'] is not None
        assert run['model_calls'] == pending_run['model_calls']
        assert target.read_text() == 'original'
        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 409


def test_restart_keeps_manager_plan_available_for_explicit_approval(tmp_path):
    client, _ = agent_client(tmp_path)
    plan = {'summary': 'Write a short note.', 'tasks': [{
        'task_id': 'note', 'agent_name': 'Writer', 'role': 'writer',
        'title': 'Write note', 'instruction': 'Write the note.',
        'read_paths': [], 'write_paths': ['a.txt'], 'depends_on': [],
        'success_criteria': ['a.txt exists'],
    }]}
    with client:
        responses = [InferenceResult(json.dumps(plan), 10, 50, 20, 'stop', False),
                     propose('write_file', 'a.txt', 'note')]
        async def infer(*args, **kwargs):
            return responses.pop(0)
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Write a short note.', 'confirm_provider_submission': True,
            'write_paths': ['a.txt'], 'max_steps': 4,
        })
        assert started.status_code == 202
        run_id = started.json()['run_id']
        before = wait_for(client, run_id, 'awaiting_plan_approval')
        client.app.state.store.recover()
        run = client.get(f'/api/v1/agent-runs/{run_id}').json()
        assert run['phase'] == 'awaiting_plan_approval'
        assert run['model_calls'] == before['model_calls']
        approved = client.post(f'/api/v1/agent-runs/{run_id}/plan-approvals', json={
            'plan_hash': before['plan_hash'], 'approved': True,
        })
        assert approved.status_code == 200
        wait_for(client, run_id, 'awaiting_approval')


def test_recovered_manager_planning_can_continue_only_on_request(tmp_path):
    client, _ = agent_client(tmp_path)
    calls = []
    with client:
        async def infer(*args, **kwargs):
            calls.append(args)
            raise ProviderError('PROVIDER_TIMEOUT')
        client.app.state.agents.live.infer = infer
        started = client.post('/api/v1/agent-workflows', json={
            'instruction': 'Write a short note.', 'confirm_provider_submission': True,
            'write_paths': ['a.txt'], 'max_steps': 4,
        })
        assert started.status_code == 202
        run_id = started.json()['run_id']
        before = wait_for(client, run_id, 'paused')
        assert before['workflow_stage'] == 'planning'
        client.app.state.store.recover()
        assert len(calls) == 1
        response = client.post(f'/api/v1/agent-runs/{run_id}/continue')
        assert response.status_code == 200
        after = wait_for(client, run_id, 'paused')
        assert after['model_calls'] == 2 and len(calls) == 2
        assert after['plan_approved'] is False
