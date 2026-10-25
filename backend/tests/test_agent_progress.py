from uuid import UUID

from test_agents import agent_client, approve, propose, wait_for


def start(client, **kwargs):
    response = client.post('/api/v1/agent-runs', json={
        'task_type': 'code', 'instruction': 'Update the files.', 'confirm_provider_submission': True,
        'read_paths': ['a.txt'], 'write_paths': ['a.txt'], 'max_steps': 20, 'review_interval': 2,
        **kwargs,
    })
    assert response.status_code == 202, response.text
    return response.json()['run_id']


def feed(client, outputs):
    async def infer(*args, **kwargs):
        return outputs.pop(0)
    client.app.state.agents.live.infer = infer


def advance(client, run_id, **body):
    response = client.post(f'/api/v1/agent-runs/{run_id}/continue', json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_periodic_checkpoint_records_actual_work_and_persists(tmp_path):
    client, settings = agent_client(tmp_path)
    (settings.agent_workspace_root / 'a.txt').write_text('old')
    with client:
        feed(client, [propose('read_file', 'a.txt'), propose('write_file', 'a.txt', 'new')])
        run_id = start(client)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        advance(client, run_id)
        run = approve(client, wait_for(client, run_id, 'awaiting_approval'))
        check = run['checkpoints'][-1]
        assert check['model_calls'] == 2
        assert check['new_reads'] == 1 and check['changed_writes'] == 1
        assert check['assessment'] == 'observed_progress'
        assert run['estimated_cost_usd'] > 0
        assert run['input_tokens'] == 100 and run['output_tokens'] == 40
        stored = client.app.state.store.get_agent(run_id)
        assert stored.checkpoints[-1].assessment == 'observed_progress'
        assert client.get(f'/api/v1/agent-runs/{run_id}').json()['checkpoints'] == run['checkpoints']


def test_changed_file_can_be_read_again_but_unchanged_read_is_blocked(tmp_path):
    client, settings = agent_client(tmp_path)
    target = settings.agent_workspace_root / 'a.txt'
    target.write_text('v1')
    with client:
        feed(client, [propose('read_file', 'a.txt') for _ in range(3)])
        run_id = start(client)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        target.write_text('v2')
        advance(client, run_id)
        run = approve(client, wait_for(client, run_id, 'awaiting_approval'))
        assert run['steps_completed'] == 2
        advance(client, run_id)
        run = wait_for(client, run_id, 'paused')
        assert run['stop_reason'] == 'DUPLICATE_OPERATION'
        assert run['steps_completed'] == 2


def test_budget_exhaustion_pauses_and_extension_preserves_run(tmp_path):
    client, settings = agent_client(tmp_path)
    (settings.agent_workspace_root / 'a.txt').write_text('v1')
    with client:
        feed(client, [propose('read_file', 'a.txt'), propose('write_file', 'a.txt', 'v2')])
        run_id = start(client, max_steps=1)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        run = advance(client, run_id)
        assert run['phase'] == 'paused' and run['status'] == 'running'
        assert run['stop_reason'] == 'STEP_LIMIT_REACHED'
        assert run['finished_at'] is None
        response = client.post(f'/api/v1/agent-runs/{run_id}/extend', json={'additional_steps': 15, 'reason': 'Continue remaining task'})
        assert response.status_code == 200, response.text
        extended = response.json()
        assert extended['max_steps'] == 16 and extended['model_calls'] == 1
        assert extended['steps_completed'] == 1 and extended['run_id'] == run_id
        assert client.post(f'/api/v1/agent-runs/{run_id}/extend', json={'additional_steps': 100, 'reason': 'Too many'}).status_code == 422
        advance(client, run_id)
        assert wait_for(client, run_id, 'awaiting_approval')['model_calls'] == 2


def test_stalled_window_requires_guidance_before_more_calls(tmp_path):
    client, _ = agent_client(tmp_path)
    bad = propose('run_shell')
    with client:
        feed(client, [bad, bad, propose('write_file', 'a.txt', 'safe')])
        run_id = start(client)
        wait_for(client, run_id, 'paused')
        advance(client, run_id)
        run = wait_for(client, run_id, 'paused')
        assert run['checkpoints'][-1]['assessment'] == 'stalled'
        assert run['review_required'] is True
        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 409
        advance(client, run_id, guidance='Use only an approved write to a.txt.')
        run = wait_for(client, run_id, 'awaiting_approval')
        assert run['model_calls'] == 3


def test_noop_and_cyclic_writes_do_not_count_as_progress(tmp_path):
    client, settings = agent_client(tmp_path)
    (settings.agent_workspace_root / 'a.txt').write_text('A')
    with client:
        feed(client, [propose('write_file', 'a.txt', 'A'), propose('write_file', 'a.txt', 'B'), propose('write_file', 'a.txt', 'A')])
        run_id = start(client)
        run = wait_for(client, run_id, 'paused')
        assert run['stop_reason'] == 'NO_CHANGE'
        advance(client, run_id)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        advance(client, run_id)
        run = wait_for(client, run_id, 'paused')
        assert run['stop_reason'] == 'CYCLIC_WRITE'
        assert (settings.agent_workspace_root / 'a.txt').read_text() == 'B'


def test_model_finish_requires_checklist_and_human_completion_review(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        feed(client, [propose('finish', final_text='Done')])
        run_id = start(client, checklist=['Output meets the requested format'])
        run = wait_for(client, run_id, 'paused')
        assert run['stop_reason'] == 'COMPLETION_REVIEW_REQUIRED'
        response = client.post(f'/api/v1/agent-runs/{run_id}/review', json={'completed_items': [], 'accept_completion': True, 'note': 'Reviewed'})
        assert response.status_code == 409
        response = client.post(f'/api/v1/agent-runs/{run_id}/review', json={'completed_items': [0], 'accept_completion': True, 'note': 'Checked output against the requirement'})
        assert response.status_code == 200
        assert response.json()['status'] == 'completed'
        assert response.json()['completion_reviewed'] is True


def test_productive_workflow_exceeds_twelve_calls_without_reset(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', f'Version {i}') for i in range(14)])
        run_id = start(client, max_steps=20, review_interval=5)
        for i in range(14):
            if i:
                advance(client, run_id)
            run = approve(client, wait_for(client, run_id, 'awaiting_approval'))
        assert run['model_calls'] == 14 and run['steps_completed'] == 14
        assert len(run['checkpoints']) == 2
        assert all(c['assessment'] == 'observed_progress' for c in run['checkpoints'])
        assert len(run['revisions']) == 14
        assert run['revisions'][1]['before_text'] == 'Version 0'


def test_elapsed_deadline_blocks_pending_write_and_extension(tmp_path):
    client, settings = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'new')])
        run_id = start(client)
        run = wait_for(client, run_id, 'awaiting_approval')
        stored = client.app.state.store.get_agent(run_id)
        stored.created_at = '2020-01-01T00:00:00Z'
        client.app.state.store.save_agent(stored)
        paused = approve(client, run)
        assert paused['stop_reason'] == 'TIME_LIMIT_REACHED'
        assert not (settings.agent_workspace_root / 'a.txt').exists()
        assert client.post(f'/api/v1/agent-runs/{run_id}/extend', json={'additional_steps': 2, 'reason': 'More time'}).status_code == 409


def test_restart_preserves_progress_and_does_not_autoresume(tmp_path):
    client, settings = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'new')])
        run_id = start(client, review_interval=1)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
    from backend.app.store import Store
    store = Store(settings.database_path)
    store.recover()
    run = store.get_agent(run_id)
    assert run.phase == 'paused'
    assert run.model_calls == 1 and len(run.checkpoints) == 1
    assert run.revisions[0].after_text == 'new'


def test_duplicate_continue_cannot_dispatch_two_calls(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'new')])
        run_id = start(client)
        wait_for(client, run_id, 'awaiting_approval')
        assert client.post(f'/api/v1/agent-runs/{run_id}/continue').status_code == 409
        assert client.get(f'/api/v1/agent-runs/{run_id}').json()['model_calls'] == 1


def test_missing_usage_remains_unknown_and_stop_preserves_checkpoint(tmp_path):
    from backend.app.providers.base import InferenceResult
    client, _ = agent_client(tmp_path)
    with client:
        item = propose('write_file', 'a.txt', 'new')
        feed(client, [InferenceResult(item.output_text, 10, None, None, 'stop', False)])
        run_id = start(client, review_interval=1)
        run = approve(client, wait_for(client, run_id, 'awaiting_approval'))
        assert run['estimated_cost_usd'] is None and run['input_tokens'] is None
        stopped = client.post(f'/api/v1/agent-runs/{run_id}/stop').json()
        assert stopped['status'] == 'cancelled' and len(stopped['checkpoints']) == 1
        assert client.post(f'/api/v1/agent-runs/{run_id}/extend', json={'additional_steps': 1, 'reason': 'No reset'}).status_code == 409


def test_restart_invalidates_pending_approval_and_can_resume(tmp_path):
    client, settings = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'new')])
        run_id = start(client)
        pending = wait_for(client, run_id, 'awaiting_approval')['pending_action']
        client.app.state.store.recover()
        run = client.get(f'/api/v1/agent-runs/{run_id}').json()
        assert run['phase'] == 'paused' and run['pending_action'] is None
        assert client.post(f'/api/v1/agent-runs/{run_id}/approvals', json={
            'action_id': pending['action_id'], 'action_hash': pending['action_hash'], 'approved': True,
        }).status_code == 409
        feed(client, [propose('write_file', 'a.txt', 'new')])
        advance(client, run_id)
        assert wait_for(client, run_id, 'awaiting_approval')['model_calls'] == 2


def test_completion_rejects_file_changed_after_last_approved_write(tmp_path):
    client, settings = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'approved'), propose('finish', final_text='Done')])
        run_id = start(client)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        advance(client, run_id)
        wait_for(client, run_id, 'paused')
        (settings.agent_workspace_root / 'a.txt').write_text('external change')
        response = client.post(f'/api/v1/agent-runs/{run_id}/review', json={
            'completed_items': [], 'accept_completion': True, 'note': 'Looks complete',
        })
        assert response.status_code == 409
        assert response.json()['error']['code'] == 'AGENT_ARTIFACT_CHANGED'


def test_denied_actions_are_in_periodic_review(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'new') for _ in range(2)])
        run_id = start(client)
        for i in range(2):
            if i:
                advance(client, run_id)
            run = wait_for(client, run_id, 'awaiting_approval')
            pending = run['pending_action']
            run = client.post(f'/api/v1/agent-runs/{run_id}/approvals', json={
                'action_id': pending['action_id'], 'action_hash': pending['action_hash'], 'approved': False,
            }).json()
        assert run['review_required'] is True
        assert run['checkpoints'][-1]['failures'] == 2


def test_pending_completion_review_survives_restart(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        feed(client, [propose('finish', final_text='Done')])
        run_id = start(client)
        wait_for(client, run_id, 'paused')
        client.app.state.store.recover()
        run = client.get(f'/api/v1/agent-runs/{run_id}').json()
        assert run['stop_reason'] == 'COMPLETION_REVIEW_REQUIRED'
        assert client.post(f'/api/v1/agent-runs/{run_id}/review', json={
            'completed_items': [], 'accept_completion': True, 'note': 'Reviewed after restart',
        }).status_code == 200


def test_legacy_run_missing_usage_is_unknown():
    from backend.app.agent_schemas import AgentRun
    old = AgentRun(run_id=UUID('11111111-1111-4111-8111-111111111111'), status='running', phase='paused',
                   task_type='code', workspace_name='sandbox', instruction='Legacy', read_paths=['a.txt'],
                   write_paths=[], max_steps=8, model_calls=3, created_at='2026-10-24T00:00:00Z')
    assert old.input_tokens is None and old.estimated_cost_usd is None


def test_first_verification_read_of_written_version_counts_as_new_evidence(tmp_path):
    client, _ = agent_client(tmp_path)
    with client:
        feed(client, [propose('write_file', 'a.txt', 'new'), propose('read_file', 'a.txt')])
        run_id = start(client, review_interval=1)
        approve(client, wait_for(client, run_id, 'awaiting_approval'))
        advance(client, run_id)
        run = approve(client, wait_for(client, run_id, 'awaiting_approval'))
        assert run['checkpoints'][-1]['new_reads'] == 1
        assert run['review_required'] is False


def test_stopping_inflight_call_keeps_usage_unknown_and_run_cancelled(tmp_path):
    import asyncio
    from time import sleep
    client, _ = agent_client(tmp_path)
    with client:
        async def infer(*args, **kwargs):
            await asyncio.sleep(10)
            return propose('finish', final_text='Late response')
        client.app.state.agents.live.infer = infer
        run_id = start(client)
        wait_for(client, run_id, 'planning')
        stopped = client.post(f'/api/v1/agent-runs/{run_id}/stop').json()
        assert stopped['status'] == 'cancelled'
        assert stopped['estimated_cost_usd'] is None
        sleep(.03)
        assert client.get(f'/api/v1/agent-runs/{run_id}').json()['status'] == 'cancelled'
