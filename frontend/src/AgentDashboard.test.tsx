import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import AgentDashboard from './AgentDashboard';

const caps = { enabled: true, workspace_name: 'sandbox', max_steps: 100, default_steps: 12, default_review_interval: 5 };
const run = {
  run_id: 'r1', task_type: 'code', workspace_name: 'sandbox', instruction: 'Update file',
  status: 'running', phase: 'paused', model_calls: 12, max_steps: 12, steps_completed: 4,
  stop_reason: 'STEP_LIMIT_REACHED', pending_action: null, final_text: null, events: [],
  checkpoints: [{ sequence: 1, model_calls: 10, assessment: 'stalled', summary: 'No new evidence in this window.' }],
  review_required: true, checklist: ['Check output'], completed_items: [], revisions: [],
  input_tokens: 120, output_tokens: 80, estimated_cost_usd: .001, provider_latency_ms: 100,
  created_at: '2026-10-24T12:00:00Z', max_elapsed_seconds: 3600,
};
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

it('lets operators configure periodic review and completion criteria', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok(caps)));
  render(<AgentDashboard initialRunId={null} />);
  expect(await screen.findByLabelText(/Review progress every/)).toHaveValue(5);
  expect(screen.getByLabelText(/Maximum model calls/)).toHaveAttribute('max', '100');
  expect(screen.getByLabelText(/Completion criteria/)).toBeInTheDocument();
});

it('shows stalled evidence and extends the same run without continuing automatically', async () => {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).endsWith('/capabilities')) return ok(caps);
    if (String(url).endsWith('/extend')) return ok({ ...run, max_steps: 22 });
    return ok(run);
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<AgentDashboard initialRunId="r1" />);
  expect(await screen.findByText('No new evidence in this window.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Finish at step limit' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText(/Review notes/), 'Need to finish remaining task');
  await user.click(screen.getByRole('button', { name: /Approve additional calls/ }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/extend'))).toBe(true));
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/continue'))).toBe(false);
});

it('requires checked criteria before accepting model completion', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => ok(String(url).endsWith('/capabilities') ? caps : {
    ...run, stop_reason: 'COMPLETION_REVIEW_REQUIRED', final_text: 'Done', model_calls: 3,
  })));
  render(<AgentDashboard initialRunId="r1" />);
  expect(await screen.findByRole('button', { name: 'Accept reviewed completion' })).toBeDisabled();
});
