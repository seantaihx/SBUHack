import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentDashboard from './AgentDashboard';
import { agentApi } from './api/client';
import type { AgentCapabilities, AgentRun, AgentStartRequest } from './api/types';

const capabilities: AgentCapabilities = {
  enabled: true, disabled_reason: null, workspace_name: 'test-workspace', task_types: ['write', 'code'],
  operations: ['read_file', 'write_file'], approval_required_for_each_operation: true,
  shell_execution_enabled: false, network_tools_enabled: false, max_steps: 20, max_file_chars: 50000,
};

const queuedRun: AgentRun = {
  run_id: 'run-123', status: 'queued', phase: 'planning', task_type: 'write', workspace_name: 'test-workspace',
  instruction: 'Write JSON', read_paths: [], write_paths: ['result.json'], max_steps: 13,
  checkpoint_sequence: 1, checkpoint_at: '2026-10-24T12:00:00Z', model_calls: 0, repeated_failure_count: 0,
  last_failure_fingerprint: null, steps_completed: 0, pending_action: null, events: [],
  completion_checks: [{ check_id: 'check-1', kind: 'valid_json', path: 'result.json', expected_text: null }],
  completion_check_baselines: { 'check-1': null }, completion_check_results: [], verification_status: 'pending', final_text: null,
  stop_reason: null, created_at: '2026-10-24T12:00:00Z', started_at: null, finished_at: null,
};
const approvalRun: AgentRun = {
  ...queuedRun, status: 'running', phase: 'awaiting_approval',
  pending_action: {
    action_id: 'action-1', action_hash: 'a'.repeat(64), operation: 'write_file', path: 'result.json',
    summary: 'Create the requested JSON file.', content: '{"ok":true}', before_text: null, base_sha256: null,
  },
};

describe('AgentDashboard reliability controls', () => {
  afterEach(() => vi.restoreAllMocks());

  it('submits a typed completion check and permits a longer call budget advertised by the backend', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'start').mockResolvedValue(queuedRun);
    vi.spyOn(agentApi, 'get').mockResolvedValue(queuedRun);
    const user = userEvent.setup();
    render(<AgentDashboard initialRunId={null} />);

    const instruction = await screen.findByLabelText('What should the agent do?');
    await user.type(instruction, 'Write a JSON result');
    await user.type(screen.getByLabelText(/Allowed write paths/), 'result.json');
    await user.clear(screen.getByLabelText('Maximum model calls'));
    await user.type(screen.getByLabelText('Maximum model calls'), '13');
    await user.click(screen.getByRole('button', { name: 'Add completion check' }));
    await user.selectOptions(screen.getByLabelText('Check type'), 'valid_json');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Start bounded run' }));

    await waitFor(() => expect(agentApi.start).toHaveBeenCalled());
    const payload = vi.mocked(agentApi.start).mock.calls[0][0] as AgentStartRequest;
    expect(payload.max_steps).toBe(13);
    expect(payload.completion_checks).toEqual([{
      check_id: 'check-1', kind: 'valid_json', path: 'result.json', expected_text: null,
    }]);
    expect(await screen.findByText(/Independent checks are configured/)).toBeInTheDocument();
  });

  it('shows the exact proposed write and allows keyboard approval of that action', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'get').mockResolvedValue(approvalRun);
    vi.spyOn(agentApi, 'approve').mockResolvedValue({
      ...approvalRun, phase: 'paused', pending_action: null, steps_completed: 1,
    });
    const user = userEvent.setup();
    render(<AgentDashboard initialRunId={approvalRun.run_id} />);

    expect(await screen.findByText('Create the requested JSON file.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current file preview')).toHaveTextContent('(new file)');
    expect(screen.getByLabelText('Proposed file content')).toHaveTextContent('{"ok":true}');
    const approve = screen.getByRole('button', { name: 'Approve this exact action' });
    approve.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(agentApi.approve).toHaveBeenCalledWith(
      approvalRun.run_id, 'action-1', 'a'.repeat(64), true,
    ));
  });
});
