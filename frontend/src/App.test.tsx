import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Capabilities, CreateRun, Run, SampleTasks } from './api/types';
import capabilitiesFixture from '../public/mock/capabilities.json';
import tasksFixture from '../public/mock/tasks.json';
import queuedFixture from '../public/mock/run-queued.json';
import completedFixture from '../public/mock/run-completed.json';
import partialFixture from '../public/mock/run-partial.json';

const capabilities = capabilitiesFixture as Capabilities;
const sampleTasks = tasksFixture as SampleTasks;
const queuedRun = queuedFixture as Run;
const completedRun = completedFixture as Run;
const partialRun = partialFixture as Run;
type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchOptions = {
  caps?: Capabilities;
  post?: (body: CreateRun) => FetchResponse | Promise<FetchResponse>;
  getRun?: (id: string) => FetchResponse | Promise<FetchResponse>;
};

const response = (body: unknown, status = 200): FetchResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockApi(options: FetchOptions = {}) {
  const caps = options.caps ?? capabilities;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/capabilities')) return response(caps);
    if (url.endsWith('/sample-tasks')) return response(sampleTasks);
    if (url.endsWith('/runs') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as CreateRun;
      return options.post ? options.post(body) : response(queuedRun, 202);
    }
    const runMatch = url.match(/\/runs\/([^/?]+)/);
    if (runMatch) return options.getRun ? options.getRun(decodeURIComponent(runMatch[1])) : response(completedRun);
    return response({ error: { code: 'NOT_FOUND', message: 'No matching test route.', details: {} } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function loadApp() {
  render(<App />);
  await screen.findByText('3 of 3 tasks selected');
}

describe('EcoAgent frontend contract flows', () => {
  afterEach(() => vi.useRealTimers());

  it('loads capabilities and sample tasks, and explains when Live is disabled', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    await loadApp();

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/capabilities', expect.any(Object));
    await user.click(screen.getByRole('button', { name: /Live/ }));
    expect(screen.getByText(capabilities.live_disabled_reason!)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Prompt/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Compare policies/ })).toBeDisabled();
  });

  it('submits the exact selected demo tasks to POST /runs', async () => {
    let posted: CreateRun | undefined;
    mockApi({ post: (body) => { posted = body; return response({ ...queuedRun, tasks: body.tasks, total_attempts: body.tasks.length * 2 }, 202); } });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    await screen.findByText('Queued');
    expect(posted?.mode).toBe('demo');
    expect(posted?.tasks).toHaveLength(2);
    expect(posted?.tasks).toEqual(sampleTasks.tasks.slice(1));
    expect(posted?.carbon_intensity_g_per_kwh).toBe(400);
  });

  it('polls a run and renders plain-text outputs with simulated provenance', async () => {
    const fetchMock = mockApi({ getRun: () => response(completedRun) });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByText('Completed', {}, { timeout: 5000 })).toBeInTheDocument();
    expect((await screen.findAllByText('billing')).length).toBe(2);
    expect(screen.getByText('Simulated latency')).toBeInTheDocument();
    expect(screen.getByText(/answer quality not evaluated/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/runs\//), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('opens an existing active run after a 409 response', async () => {
    const activeId = completedRun.id;
    mockApi({
      post: () => response({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'A comparison is already running.', details: { active_run_id: activeId } } }, 409),
      getRun: (id) => { expect(id).toBe(activeId); return response(completedRun); },
    });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByText(/An active comparison already exists/i)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('run')).toBe(activeId);
  });

  it('shows a partial run as incomplete and exposes failed attempts', async () => {
    const liveCaps = { ...capabilities, live_enabled: true, live_disabled_reason: null };
    let posted: CreateRun | undefined;
    mockApi({ caps: liveCaps, post: (body) => { posted = body; return response({ ...queuedRun, mode: 'live', measurement_source: 'provider_usage_and_client_timing', tasks: body.tasks, total_attempts: body.tasks.length * 2 }, 202); }, getRun: () => response(partialRun) });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Live/ }));
    await user.selectOptions(screen.getByRole('combobox'), 'extract');
    await user.type(screen.getByRole('textbox', { name: /Prompt/ }), 'Classify this synthetic support message.');
    await user.click(screen.getByRole('button', { name: /Add task/ }));
    expect(screen.getByText('2/10')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remove task 2/ }));
    expect(screen.getByText('1 task ready')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByText('Partial results', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(posted?.mode).toBe('live');
    expect(posted?.tasks[0].type).toBe('extract');
    expect(posted?.tasks[0].prompt).toBe('Classify this synthetic support message.');
    expect(screen.getByText(/Incomplete comparison/i)).toBeInTheDocument();
    expect(screen.getAllByText(/PROVIDER_TIMEOUT/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });

  it('restores a run from ?run=<uuid> after reload', async () => {
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    const fetchMock = mockApi({ getRun: (id) => { expect(id).toBe(completedRun.id); return response(completedRun); } });
    await loadApp();

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getAllByText('billing')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/runs/${completedRun.id}`, expect.any(Object));
  });

  it('offers retry after a polling network failure without resubmitting', async () => {
    let polls = 0;
    const fetchMock = mockApi({ getRun: () => {
      polls += 1;
      return polls === 1 ? Promise.reject(new TypeError('Network unavailable')) : response(completedRun);
    } });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));
    expect(await screen.findByText('Network unavailable', {}, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry now/ }));

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/runs') && init?.method === 'POST');
    expect(posts).toHaveLength(1);
  });

  it('expands only the selected task prompt', async () => {
    mockApi({ getRun: () => response(completedRun) });
    const user = userEvent.setup();
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');
    const taskCards = screen.getAllByRole('article').filter((article) => article.classList.contains('answer-card'));
    expect(taskCards).toHaveLength(3);
    const firstCard = within(taskCards[0]);
    const secondCard = within(taskCards[1]);
    await user.click(firstCard.getByRole('button', { name: /Show task prompt/ }));
    expect(firstCard.getByText(completedRun.tasks[0].prompt)).toBeVisible();
    expect(secondCard.queryByText(completedRun.tasks[1].prompt)).not.toBeInTheDocument();
  });

  it('sends the edited carbon-intensity scenario and locks it during the run', async () => {
    let posted: CreateRun | undefined;
    mockApi({ post: (body) => { posted = body; return response(queuedRun, 202); } });
    const user = userEvent.setup();
    await loadApp();
    const intensity = screen.getByRole('spinbutton', { name: /Scenario carbon intensity/ });
    await user.clear(intensity);
    await user.type(intensity, '550');
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    await screen.findByText('Queued');
    expect(posted?.carbon_intensity_g_per_kwh).toBe(550);
    expect(intensity).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /New comparison/ }));
    expect(intensity).toBeEnabled();
  });

  it('displays a Live 503 error and does not switch to Demo', async () => {
    const liveCaps = { ...capabilities, live_enabled: true, live_disabled_reason: null };
    mockApi({ caps: liveCaps, post: () => response({ error: { code: 'LIVE_UNAVAILABLE', message: 'The configured inference service is unavailable.', details: {} } }, 503) });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Live/ }));
    await user.type(screen.getByRole('textbox', { name: /Prompt/ }), 'Use a synthetic task.');
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The configured inference service is unavailable.');
    expect(screen.getByRole('button', { name: /Live/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('renders model output as text rather than interpreting HTML', async () => {
    const unsafeOutput = '<img src=x onerror=alert(1)>';
    const runWithText = { ...completedRun, results: completedRun.results.map((result, index) => index === 0 ? { ...result, output_text: unsafeOutput } : result) };
    mockApi({ getRun: () => response(runWithText) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');

    expect(screen.getByText(unsafeOutput)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
