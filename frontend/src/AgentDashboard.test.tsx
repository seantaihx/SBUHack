import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentDashboard from './AgentDashboard';
import { agentApi, ApiError } from './api/client';
import type { AgentCapabilities, AgentRun, AgentStartRequest } from './api/types';

const capabilities: AgentCapabilities = {
  enabled: true, disabled_reason: null, workspace_name: 'test-workspace', task_types: ['write', 'code'],
  operations: ['read_file', 'write_file'], approval_required_for_each_operation: true,
  shell_execution_enabled: false, network_tools_enabled: false, max_steps: 20, max_file_chars: 50000,
  team_workflows_enabled: true, team_roles: ['manager', 'writer', 'coder', 'reviewer'], max_workflow_tasks: 8, parallel_workers: 1,
  max_task_calls: 8, max_runtime_seconds: 7200, max_tokens_per_run: 48000, max_tokens_per_task: 12000,
};

const queuedRun: AgentRun = {
  run_id: 'run-123', status: 'queued', phase: 'planning', task_type: 'write', workspace_name: 'test-workspace',
  instruction: 'Write JSON', read_paths: [], write_paths: ['result.json'], max_steps: 13,
  checkpoint_sequence: 1, checkpoint_at: '2026-10-24T12:00:00Z', model_calls: 0, repeated_failure_count: 0, retry_count: 0,
  last_failure_fingerprint: null, steps_completed: 0, pending_action: null, events: [],
  completion_checks: [{ check_id: 'check-1', kind: 'valid_json', path: 'result.json', expected_text: null }],
  completion_check_baselines: { 'check-1': null }, completion_check_results: [], verification_status: 'pending', final_text: null,
  stop_reason: null, created_at: '2026-10-24T12:00:00Z', started_at: null, finished_at: null,
  run_mode: 'single', workflow_stage: null, max_tasks: 0, max_task_calls: 4, max_runtime_seconds: null,
  workflow_deadline_at: null, max_run_cost_usd: null, max_task_cost_usd: null,
  max_tokens_per_run: 48000, max_tokens_per_task: 12000, reserved_output_tokens: 0, manager_reserved_output_tokens: 0,
  workflow_tasks: [], active_task_id: null,
  plan_hash: null, plan_approved: false, manager_summary: null, manager_open_items: [], manager_model_calls: 0,
  manager_input_tokens: null, manager_output_tokens: null, manager_usage_reported_calls: 0, manager_estimated_cost_usd: null,
  manager_retry_count: 0,
  agent_model_id: null, input_tokens: null, output_tokens: null, usage_reported_calls: 0, estimated_cost_usd: null, handoff: null,
};
const approvalRun: AgentRun = {
  ...queuedRun, status: 'running', phase: 'awaiting_approval',
  pending_action: {
    action_id: 'action-1', action_hash: 'a'.repeat(64), operation: 'write_file', path: 'result.json',
    summary: 'Create the requested JSON file.', content: '{"ok":true}', before_text: null, base_sha256: null,
    task_id: null, agent_name: null, agent_role: null,
  },
};
const teamPlanRun: AgentRun = {
  ...queuedRun, status: 'running', phase: 'awaiting_plan_approval', run_mode: 'team',
  workflow_stage: 'plan_review', max_tasks: 4, max_task_calls: 3, max_runtime_seconds: 1800,
  workflow_deadline_at: '2026-10-24T13:00:00Z', max_run_cost_usd: 0.5, max_task_cost_usd: 0.25,
  plan_hash: 'b'.repeat(64), manager_summary: 'Draft the guide, then create a code example.',
  workflow_tasks: [{
    task_id: 'writer', agent_name: 'Writer 1', role: 'writer', title: 'Draft the guide',
    instruction: 'Write a short guide.', read_paths: [], write_paths: ['result.json'], depends_on: [],
    success_criteria: ['The requested file exists.'], status: 'planned', model_calls: 0,
    max_model_calls: 3, steps_completed: 0, input_tokens: null, output_tokens: null,
    usage_reported_calls: 0, estimated_cost_usd: null, max_tokens: 12000,
    reserved_output_tokens: 0, retry_count: 0, result_summary: null, final_text: null, stop_reason: null,
  }],
};
const handoffRun: AgentRun = {
  ...teamPlanRun, status: 'completed', phase: 'completed', workflow_stage: 'completed',
  verification_status: 'not_requested', manager_summary: 'The workflow finished; review the saved output.',
  workflow_tasks: teamPlanRun.workflow_tasks.map((task) => ({ ...task, status: 'completed',
    model_id: 'openai/gpt-oss-20b', model_calls: 2, steps_completed: 1, result_summary: 'Saved output.',
    final_text: 'Drafted guide content for the approved output.' })),
  handoff: {
    updated_at: '2026-10-24T12:30:00Z', original_task_summary: 'Write a short guide.',
    summary: 'The writer saved the requested guide.', completed_task_ids: ['writer'],
    remaining_task_ids: [], blocked_task_ids: [], files_read: [], files_changed: ['result.json'],
    action_counts: { 'tool.write_file.completed': 1 },
    actions: [{ sequence: 1, actor: 'tool', agent_name: 'Writer 1', agent_role: 'writer',
      model_id: 'openai/gpt-oss-20b', operation: 'write_file', target: 'result.json', decision: 'completed', summary: 'Saved output.' }],
    tasks: [{ task_id: 'writer', agent_name: 'Writer 1', role: 'writer', title: 'Draft the guide',
      status: 'completed', instruction_summary: 'Write a short guide.', model_id: 'openai/gpt-oss-20b',
      read_paths: [], write_paths: ['result.json'], depends_on: [], success_criteria: ['The requested file exists.'],
      result_summary: 'Saved output.', model_calls: 2, max_model_calls: 3,
      input_tokens: 80, output_tokens: 40, usage_reported_calls: 2, estimated_cost_usd: 0.00002,
      retry_count: 0, stop_reason: null }],
    manager_retry_count: 0,
    completion_check_results: [], model_id: 'openai/gpt-oss-120b', model_calls_used: 4,
    model_calls_remaining: 9, max_tokens_per_run: 48000, max_tokens_per_task: 12000,
    reported_tokens_remaining: 47800, reserved_output_tokens: 0, deadline_at: '2026-10-24T13:00:00Z',
    max_run_cost_usd: 0.5, max_task_cost_usd: 0.25, input_tokens: 100, output_tokens: 100,
    usage_reported_calls: 4, estimated_cost_usd: 0.0001, estimated_carbon_g: null,
    retry_count: 1, stop_reason: null, next_steps: ['Review the saved file.'],
  },
};
const singleHandoffRun: AgentRun = {
  ...queuedRun, status: 'completed', phase: 'completed', run_mode: 'single', task_type: 'write',
  instruction: 'Write a concise report to report.txt.', agent_model_id: 'openai/gpt-oss-20b',
  model_calls: 3, final_text: 'The full generated report is visible only in the run output.',
  handoff: {
    ...handoffRun.handoff!, updated_at: '2026-10-24T12:35:00Z',
    original_task_summary: 'Write a concise report to report.txt.', summary: 'The report was saved for review.',
    completed_task_ids: ['workspace-task'], remaining_task_ids: [], blocked_task_ids: [],
    files_read: ['source.txt'], files_changed: ['report.txt'], actions: [], tasks: [],
    role_model_ids: { writer: 'openai/gpt-oss-20b' }, model_id: 'openai/gpt-oss-20b',
    model_calls_used: 3, model_calls_remaining: 5, input_tokens: 120, output_tokens: 50,
    usage_reported_calls: 3, estimated_cost_usd: 0.0002, stop_reason: null,
    next_steps: ['Review report.txt and its deterministic checks.'],
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
    await user.clear(screen.getByLabelText(/Maximum model calls/));
    await user.type(screen.getByLabelText(/Maximum model calls/), '13');
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
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current file preview')).toHaveTextContent('(new file)');
    expect(screen.getByLabelText('Proposed file content')).toHaveTextContent('{"ok":true}');
    const approve = screen.getByRole('button', { name: 'Approve this exact action' });
    approve.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(agentApi.approve).toHaveBeenCalledWith(
      approvalRun.run_id, 'action-1', 'a'.repeat(64), true,
    ));
  });

  it('keeps a queued run locked and offers Stop while the backend is scheduling it', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'get').mockResolvedValue(queuedRun);
    vi.spyOn(agentApi, 'stop').mockResolvedValue({ ...queuedRun, status: 'cancelled', phase: 'completed', stop_reason: 'OPERATOR_STOPPED' });
    const user = userEvent.setup();
    render(<AgentDashboard initialRunId={queuedRun.run_id} />);

    const stop = await screen.findByRole('button', { name: 'Stop run' });
    expect(screen.getByRole('button', { name: 'Start bounded run' })).toBeDisabled();
    expect(screen.getByLabelText('What should the agent do?')).toBeDisabled();
    await user.click(stop);

    await waitFor(() => expect(agentApi.stop).toHaveBeenCalledWith(queuedRun.run_id));
    expect(await screen.findByText(/This run was stopped/)).toBeInTheDocument();
  });

  it('reopens the active agent run after a 409 instead of leaving the user locked out', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'start').mockRejectedValue(new ApiError('Another EcoAgent run is active.', 409, 'RUN_ALREADY_ACTIVE', {
      active_run_id: approvalRun.run_id, active_run_kind: 'agent',
    }));
    vi.spyOn(agentApi, 'get').mockResolvedValue(approvalRun);
    const onOpenActiveRun = vi.fn();
    const user = userEvent.setup();
    render(<AgentDashboard initialRunId={null} onOpenActiveRun={onOpenActiveRun} />);

    await user.type(await screen.findByLabelText('What should the agent do?'), 'Write a JSON result');
    await user.type(screen.getByLabelText(/Allowed write paths/), 'result.json');
    await user.click(screen.getByRole('checkbox', { name: /I confirm the instruction/ }));
    await user.click(screen.getByRole('button', { name: 'Start bounded run' }));

    expect(await screen.findByText('Create the requested JSON file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
    expect(await screen.findByText(/An existing Workspace Agent run was reopened/i)).toBeInTheDocument();
    expect(agentApi.get).toHaveBeenCalledWith(approvalRun.run_id);
    expect(onOpenActiveRun).toHaveBeenCalledWith(approvalRun.run_id);
  });

  it('shows a reviewable manager plan, task ownership and a stop control before approval', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'get').mockResolvedValue(teamPlanRun);
    render(<AgentDashboard initialRunId={teamPlanRun.run_id} />);

    expect(await screen.findByText('Draft the guide, then create a code example.')).toBeInTheDocument();
    expect(screen.getByText('Writer 1 · writer')).toBeInTheDocument();
    expect(screen.getByText(/No task dependency/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve workflow plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
    expect(screen.getByText('SERIAL EXECUTION · NO PARALLEL CLAIMS')).toBeInTheDocument();
    const assignment = screen.getByText('Review assignment and permitted paths');
    await userEvent.setup().click(assignment);
    expect(screen.getByText('Write a short guide.')).toBeInTheDocument();
    expect(screen.getByText('result.json')).toBeInTheDocument();
  });

  it('renders specialist output and a human-readable durable handoff', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'get').mockResolvedValue(handoffRun);
    const user = userEvent.setup();
    render(<AgentDashboard initialRunId={handoffRun.run_id} />);

    const taskSummaryLabel = await screen.findByText('Task summary:');
    const handoff = taskSummaryLabel.closest('.workflow-handoff');
    expect(handoff).not.toBeNull();
    expect(handoff!).toHaveTextContent(/Task summary:\s*Write a short guide\./);
    expect(screen.getByText(/Recorded actions · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Writer 1 · openai\/gpt-oss-20b · write_file · result\.json · completed/)).toBeInTheDocument();
    await user.click(within(handoff as HTMLElement).getByText(/Task details and outcomes/));
    expect(within(handoff as HTMLElement).getByText(/Writer 1 · writer · completed · openai\/gpt-oss-20b/)).toBeInTheDocument();
    expect(within(handoff as HTMLElement).getByText(/Next-agent context: Write a short guide\./)).toBeInTheDocument();
    expect(within(handoff as HTMLElement).getByText(/Allowed reads: None · allowed writes: result\.json/)).toBeInTheDocument();
    expect(within(handoff as HTMLElement).getByText(/Calls 2\/3 · retries 0 · tokens 120 reported/)).toBeInTheDocument();
    await user.click(screen.getByText('View Writer 1 output'));
    expect(screen.getByLabelText('Writer 1 final output')).toHaveTextContent('Drafted guide content for the approved output.');
    expect(screen.getByText(/Agent energy is not measured or estimated/)).toBeInTheDocument();
  });

  it('shows and copies a secret-free handoff after a single-agent run', async () => {
    vi.spyOn(agentApi, 'capabilities').mockResolvedValue(capabilities);
    vi.spyOn(agentApi, 'get').mockResolvedValue(singleHandoffRun);
    const user = userEvent.setup();
    render(<AgentDashboard initialRunId={singleHandoffRun.run_id} />);

    expect(await screen.findByText(/Handoff for next agent/)).toBeInTheDocument();
    expect(screen.getAllByText('The report was saved for review.').length).toBeGreaterThan(0);
    expect(screen.getByText('report.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy handoff JSON' })).toBeInTheDocument();
    await user.click(screen.getByText('View structured handoff JSON'));
    const handoffJson = JSON.parse(screen.getByLabelText('Structured workspace handoff').textContent ?? '{}') as Record<string, unknown>;
    expect(handoffJson).not.toHaveProperty('final_text');
  });
});
