import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { benchmarkApi } from './api/client';
import type { BenchmarkCasesResponse, BenchmarkDatasetsResponse, BenchmarkRun, Capabilities, CreateRun, Run, SampleTasks } from './api/types';
import capabilitiesFixture from '../public/mock/capabilities.json';
import tasksFixture from '../public/mock/tasks.json';
import queuedFixture from '../public/mock/run-queued.json';
import completedFixture from '../public/mock/run-completed.json';
import partialFixture from '../public/mock/run-partial.json';
import benchmarkDatasetsFixture from '../public/mock/benchmark-datasets.json';
import benchmarkRunFixture from '../public/mock/benchmark-run.json';
import benchmarkCasesFixture from '../public/mock/benchmark-cases.json';

const capabilities = capabilitiesFixture as Capabilities;
const sampleTasks = tasksFixture as SampleTasks;
const queuedRun = queuedFixture as Run;
const completedRun = completedFixture as Run;
const partialRun = partialFixture as Run;
const benchmarkDatasets = benchmarkDatasetsFixture as BenchmarkDatasetsResponse;
const benchmarkRun = benchmarkRunFixture as BenchmarkRun;
const benchmarkCases = benchmarkCasesFixture as BenchmarkCasesResponse;
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
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

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
    expect(document.querySelectorAll('.answer-text').length).toBeGreaterThanOrEqual(2);
    expect(Array.from(document.querySelectorAll<HTMLElement>('.metric-card')).some((card) => card.textContent?.includes('Simulated latency'))).toBe(true);
    expect(screen.getByText(/answer quality not evaluated/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/runs\//), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('highlights searched output text and copies a complete returned answer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', new Proxy(navigator, { get: (target, key, receiver) => key === 'clipboard' ? { writeText } : Reflect.get(target, key, receiver) }));
    mockApi({ getRun: () => response(completedRun) });
    const user = userEvent.setup();
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');

    await user.type(screen.getByRole('searchbox', { name: /Find in responses/ }), 'bill');
    expect(document.querySelectorAll('mark.output-match')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Copy baseline output for classify-1' }));
    expect(writeText).toHaveBeenCalledWith('billing');
    expect(screen.getByText('Copied baseline output for classify-1.')).toHaveAttribute('role', 'status');
  });

  it('explains when the browser cannot copy an output', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied.'));
    vi.stubGlobal('navigator', new Proxy(navigator, { get: (target, key, receiver) => key === 'clipboard' ? { writeText } : Reflect.get(target, key, receiver) }));
    mockApi({ getRun: () => response(completedRun) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy baseline output for classify-1' }));
    expect(screen.getByText('Could not copy output. Select the response text and copy it manually.')).toHaveAttribute('role', 'status');
  });

  it('shows negative latency savings as an absolute slower amount', async () => {
    const slowerRun = {
      ...completedRun,
      comparison: { ...completedRun.comparison, latency_ms: { baseline: 4700, optimized: 4989, saved: -289, savings_pct: -6.1 } },
    };
    mockApi({ getRun: () => response(slowerRun) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');

    const card = Array.from(document.querySelectorAll<HTMLElement>('.metric-card')).find((element) => element.textContent?.includes('Simulated latency'));
    expect(card).not.toBeNull();
    expect(within(card!).getByText('289')).toBeInTheDocument();
    expect(within(card!).getByText('ms slower')).toBeInTheDocument();
    expect(within(card!).getByText('6.1% slower')).toBeInTheDocument();
    expect(within(card!).queryByText(/-289/)).not.toBeInTheDocument();
  });

  it('keeps unavailable latency change null and visibly unavailable', async () => {
    const unavailableRun = {
      ...completedRun,
      comparison: { ...completedRun.comparison, latency_ms: { baseline: null, optimized: null, saved: null, savings_pct: null } },
    };
    mockApi({ getRun: () => response(unavailableRun) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');
    const card = Array.from(document.querySelectorAll<HTMLElement>('.metric-card')).find((element) => element.textContent?.includes('Simulated latency'));
    expect(card).not.toBeNull();
    expect(within(card!).getAllByText('Unavailable')).toHaveLength(4);
  });

  it('does not guess an active run type when a comparison 409 omits it', async () => {
    const activeId = completedRun.id;
    const fetchMock = mockApi({
      post: () => response({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'Another run is already active.', details: { active_run_id: activeId } } }, 409),
    });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not identify the active run type/i);
    expect(new URL(window.location.href).searchParams.get('run')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(`/runs/${activeId}`))).toHaveLength(0);
  });

  it('opens a comparison run when a 409 identifies active_run_kind', async () => {
    const activeId = completedRun.id;
    const fetchMock = mockApi({
      post: () => response({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'Another run is already active.', details: { active_run_id: activeId, active_run_kind: 'comparison' } } }, 409),
      getRun: (id) => { expect(id).toBe(activeId); return response(completedRun); },
    });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByText(/Opened that run/i)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('run')).toBe(activeId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/runs/${activeId}`, expect.any(Object));
  });

  it('navigates to an identified active benchmark without resubmitting', async () => {
    vi.spyOn(benchmarkApi, 'listDatasets').mockResolvedValue(benchmarkDatasets);
    vi.spyOn(benchmarkApi, 'listRuns').mockResolvedValue({ items: [], next_cursor: null });
    vi.spyOn(benchmarkApi, 'getRun').mockResolvedValue(benchmarkRun);
    vi.spyOn(benchmarkApi, 'getCases').mockResolvedValue(benchmarkCases);
    const activeId = benchmarkRun.run_id;
    const fetchMock = mockApi({
      post: () => response({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'Another run is already active.', details: { active_run_id: activeId, active_run_kind: 'benchmark' } } }, 409),
    });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Compare policies/ }));

    expect(await screen.findByRole('heading', { name: 'Compare model configurations' })).toBeInTheDocument();
    expect(await screen.findByText('Opened the active benchmark identified by the backend.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('benchmark')).toBe(activeId);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(benchmarkApi.getRun).toHaveBeenCalledWith(activeId);
  });

  it('keeps a URL-containing prompt usable and explains that the page is not fetched', async () => {
    const liveCaps = { ...capabilities, live_enabled: true, live_disabled_reason: null };
    let posted: CreateRun | undefined;
    mockApi({ caps: liveCaps, post: (body) => { posted = body; return response({ ...queuedRun, mode: 'live', tasks: body.tasks, total_attempts: body.tasks.length * 2 }, 202); } });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Live/ }));
    const prompt = 'Summarize this pasted text and context from https://example.com/article';
    await user.type(screen.getByRole('textbox', { name: /Prompt/ }), prompt);

    expect(screen.getByText(/Paste the source text\. URLs are not fetched\./)).toBeInTheDocument();
    expect(screen.getByText(/page will not be retrieved/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Compare policies/ });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await screen.findByText('Queued');
    expect(posted?.tasks[0].prompt).toBe(prompt);
  });

  it('blocks a run when an unavailable source is selected, then preserves text-only comparison after clearing it', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    await loadApp();
    await user.selectOptions(screen.getByLabelText('Source type'), 'text');
    await user.type(screen.getByLabelText('Pasted source text'), 'Synthetic source that must not be ignored.');
    const blockedSubmit = screen.getByRole('button', { name: 'Clear source to compare' });
    await waitFor(() => expect(blockedSubmit).toBeDisabled());
    expect(screen.getByText(/comparison button is disabled/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/sources'))).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Source type'), 'none');
    const textOnlySubmit = screen.getByRole('button', { name: 'Compare policies' });
    await waitFor(() => expect(textOnlySubmit).toBeEnabled());
    await user.click(textOnlySubmit);
    expect(await screen.findByText('Queued')).toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/runs') && init?.method === 'POST');
    expect(request).toBeDefined();
    expect(String(request?.[1]?.body)).not.toContain('Synthetic source that must not be ignored.');
  });

  it('saves manual reviews per run, restores them, and resets to not reviewed', async () => {
    mockApi({ getRun: () => response(completedRun) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    const user = userEvent.setup();
    const firstView = render(<App />);
    await screen.findByText('Completed');
    const review = screen.getByLabelText(`Human review · optimized · ${completedRun.tasks[0].id}`);
    await user.selectOptions(review, 'correct');
    expect(localStorage.getItem(`ecoagent-manual-review:${completedRun.id}`)).toContain('correct');
    firstView.unmount();

    render(<App />);
    await screen.findByText('Completed');
    await waitFor(() => expect(screen.getByLabelText(`Human review · optimized · ${completedRun.tasks[0].id}`)).toHaveValue('correct'));
    await user.click(screen.getByRole('button', { name: 'Reset reviews' }));
    expect(screen.getByLabelText(`Human review · optimized · ${completedRun.tasks[0].id}`)).toHaveValue('not_reviewed');
    expect(localStorage.getItem(`ecoagent-manual-review:${completedRun.id}`)).toBeNull();
  });

  it('shows a partial run as incomplete and exposes failed attempts', async () => {
    const liveCaps = { ...capabilities, live_enabled: true, live_disabled_reason: null };
    let posted: CreateRun | undefined;
    mockApi({ caps: liveCaps, post: (body) => { posted = body; return response({ ...queuedRun, mode: 'live', measurement_source: 'provider_usage_and_client_timing', tasks: body.tasks, total_attempts: body.tasks.length * 2 }, 202); }, getRun: () => response(partialRun) });
    const user = userEvent.setup();
    await loadApp();
    await user.click(screen.getByRole('button', { name: /Live/ }));
    await user.selectOptions(screen.getByLabelText(/Task 1 type/), 'extract');
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
    expect(document.querySelector('.print-report')).toHaveTextContent(/This run is partial/);
    expect(screen.getAllByText(/PROVIDER_TIMEOUT/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });

  it('restores a run from ?run=<uuid> after reload', async () => {
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    const fetchMock = mockApi({ getRun: (id) => { expect(id).toBe(completedRun.id); return response(completedRun); } });
    await loadApp();

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(document.querySelectorAll('.answer-text')).toHaveLength(6);
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

  it('downloads the loaded JSON and CSV snapshots and offers an explicit print-to-PDF workflow', async () => {
    mockApi({ getRun: () => response(completedRun) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const filenames: string[] = [];
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(window.URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(window.URL, 'revokeObjectURL');
    const printDescriptor = Object.getOwnPropertyDescriptor(window, 'print');
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => { blobs.push(blob); return `blob:export-${blobs.length}`; } });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    Object.defineProperty(window, 'print', { configurable: true, value: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
    try {
      await loadApp();
      await screen.findByText('Completed');
      expect(document.querySelector('.print-report')).toHaveTextContent('Illustrative estimates');
      expect(document.querySelector('.print-report')).toHaveTextContent('Source references: Unavailable');
      await user.selectOptions(screen.getByLabelText(`Human review · baseline · ${completedRun.tasks[0].id}`), 'incorrect');
      await user.click(screen.getByRole('button', { name: 'Export JSON' }));
      expect(await screen.findByText(/Exported the completed snapshot/)).toBeInTheDocument();
      const json = JSON.parse(await blobs[0].text()) as { run_id: string; run_snapshot: Run; manual_review_annotations: { by_task: Record<string, { baseline: string }> } };
      expect(json.run_id).toBe(completedRun.id);
      expect(json.run_snapshot).toMatchObject({ id: completedRun.id, status: 'completed' });
      expect(json.manual_review_annotations.by_task[completedRun.tasks[0].id].baseline).toBe('incorrect');
      expect(filenames[0]).toBe(`ecoagent-run-${completedRun.id}-completed.json`);

      await user.click(screen.getByRole('button', { name: 'Export CSV' }));
      const csv = await blobs[1].text();
      expect(csv.split('\r\n')).toHaveLength(completedRun.results.length + 1);
      expect(csv).toContain('output_text');
      expect(csv).toContain('human_review');
      expect(filenames[1]).toBe(`ecoagent-run-${completedRun.id}-completed.csv`);

      await user.click(screen.getByRole('button', { name: /Print \/ Save PDF/ }));
      expect(window.print).toHaveBeenCalledOnce();
    expect(screen.getByText(/not a direct PDF download/i)).toBeInTheDocument();
    } finally {
      clickSpy.mockRestore();
      if (createObjectUrlDescriptor) Object.defineProperty(window.URL, 'createObjectURL', createObjectUrlDescriptor);
      else Reflect.deleteProperty(window.URL, 'createObjectURL');
      if (revokeObjectUrlDescriptor) Object.defineProperty(window.URL, 'revokeObjectURL', revokeObjectUrlDescriptor);
      else Reflect.deleteProperty(window.URL, 'revokeObjectURL');
      if (printDescriptor) Object.defineProperty(window, 'print', printDescriptor);
      else Reflect.deleteProperty(window, 'print');
    }
  });

  it('renders model output as text rather than interpreting HTML', async () => {
    const unsafeOutput = '<img src=x onerror=alert(1)>';
    const runWithText = { ...completedRun, results: completedRun.results.map((result, index) => index === 0 ? { ...result, output_text: unsafeOutput } : result) };
    mockApi({ getRun: () => response(runWithText) });
    window.history.replaceState({}, '', `/?run=${completedRun.id}`);
    await loadApp();
    await screen.findByText('Completed');

    expect(Array.from(document.querySelectorAll('.answer-text')).some((element) => element.textContent === unsafeOutput)).toBe(true);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
