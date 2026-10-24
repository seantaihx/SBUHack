import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BenchmarkDashboard from './BenchmarkDashboard';
import { ApiError, benchmarkApi } from './api/client';
import type { BenchmarkCasesResponse, BenchmarkDatasetsResponse, BenchmarkRun, BenchmarkRunsResponse, StartBenchmarkRequest } from './api/types';
import datasetsFixture from '../public/mock/benchmark-datasets.json';
import runFixture from '../public/mock/benchmark-run.json';
import casesFixture from '../public/mock/benchmark-cases.json';

const datasets = datasetsFixture as BenchmarkDatasetsResponse;
const completed = runFixture as BenchmarkRun;
const cases = casesFixture as BenchmarkCasesResponse;

describe('BenchmarkDashboard', () => {
  beforeEach(() => {
    vi.spyOn(benchmarkApi, 'listDatasets').mockResolvedValue(datasets);
    vi.spyOn(benchmarkApi, 'listRuns').mockResolvedValue({ items: [], next_cursor: null } satisfies BenchmarkRunsResponse);
    vi.spyOn(benchmarkApi, 'startRun').mockResolvedValue({ run_id: completed.run_id, status: 'queued' });
    vi.spyOn(benchmarkApi, 'getRun').mockResolvedValue(completed);
    vi.spyOn(benchmarkApi, 'getCases').mockResolvedValue(cases);
  });

  afterEach(() => vi.restoreAllMocks());

  it('loads dataset options and shows an empty history state', async () => {
    render(<BenchmarkDashboard />);
    expect(await screen.findByRole('heading', { name: 'Compare model configurations' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Dataset/ })).toHaveValue('starter-v1');
    expect(screen.getByText('No previous runs returned by the backend.')).toBeInTheDocument();
  });

  it('submits the selected workload and renders backend metrics and case outcomes', async () => {
    const user = userEvent.setup();
    let request: StartBenchmarkRequest | undefined;
    vi.mocked(benchmarkApi.startRun).mockImplementation(async (body) => { request = body; return { run_id: completed.run_id, status: 'queued' }; });
    render(<BenchmarkDashboard />);
    await screen.findByRole('combobox', { name: /Dataset/ });
    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));

    await screen.findByRole('heading', { name: 'Completed' });
    expect(request).toEqual({
      dataset_id: 'starter-v1',
      baseline: { model_id: 'openai/gpt-oss-120b', optimization_enabled: false },
      candidate: { model_id: 'eco-auto', optimization_enabled: true },
      max_cases: 5,
    });
    expect(screen.getByText('Simulated fixture results; not measured model performance. Evaluation: exact_match_or_deterministic_check.')).toBeInTheDocument();
    expect(screen.getByText('$0.0150')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(benchmarkApi.getCases).toHaveBeenCalledWith(completed.run_id, 50, undefined, expect.any(AbortSignal));
  });

  it('preserves unavailable metric values instead of showing zero', async () => {
    const runWithNulls = { ...completed, baseline_metrics: { ...completed.baseline_metrics!, total_cost_usd: null } };
    vi.mocked(benchmarkApi.getRun).mockResolvedValue(runWithNulls);
    const user = userEvent.setup();
    render(<BenchmarkDashboard />);
    await screen.findByRole('combobox', { name: /Dataset/ });
    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));
    await screen.findByRole('heading', { name: 'Completed' });
    const costCard = screen.getByText('Estimated total cost').closest('article');
    expect(costCard).not.toBeNull();
    expect(within(costCard!).getByText('Unavailable')).toBeInTheDocument();
  });

  it('shows a provider rate-limit error and does not switch to fixture mode or repeat the POST', async () => {
    const user = userEvent.setup();
    vi.mocked(benchmarkApi.startRun).mockRejectedValue(new ApiError('Provider rate limit reached.', 429, 'RATE_LIMITED'));
    render(<BenchmarkDashboard />);
    await screen.findByRole('combobox', { name: /Dataset/ });
    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider rate limit reached.');
    expect(benchmarkApi.startRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/SIMULATED BENCHMARK FIXTURES/)).not.toBeInTheDocument();
  });

  it('shows dataset loading failure without silently substituting fixture data', async () => {
    vi.mocked(benchmarkApi.listDatasets).mockRejectedValue(new Error('API unavailable'));
    render(<BenchmarkDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');
    expect(screen.queryByLabelText('Dataset')).not.toBeInTheDocument();
  });

  it('follows backend queued, running, and completed snapshots and stops at completion', async () => {
    const queued = { ...completed, status: 'queued' as const, progress: { completed: 0, total: 5 }, baseline_metrics: null, candidate_metrics: null };
    const running = { ...queued, status: 'running' as const, progress: { completed: 2, total: 5 } };
    vi.mocked(benchmarkApi.getRun).mockResolvedValueOnce(queued).mockResolvedValueOnce(running).mockResolvedValueOnce(completed);
    const user = userEvent.setup();
    render(<BenchmarkDashboard />);
    await screen.findByRole('combobox', { name: /Dataset/ });
    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));
    expect(await screen.findByRole('heading', { name: 'Queued' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Running' }, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Completed' }, { timeout: 5000 })).toBeInTheDocument();
    expect(benchmarkApi.getRun).toHaveBeenCalledTimes(3);
  });

  it('prevents duplicate submission while the start request is pending', async () => {
    let resolveStart!: (value: { run_id: string; status: 'queued' }) => void;
    vi.mocked(benchmarkApi.startRun).mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));
    const user = userEvent.setup();
    render(<BenchmarkDashboard />);
    await screen.findByRole('combobox', { name: /Dataset/ });
    const button = screen.getByRole('button', { name: 'Run benchmark' });
    await user.click(button);
    expect(button).toBeDisabled();
    resolveStart({ run_id: completed.run_id, status: 'queued' });
    await waitFor(() => expect(benchmarkApi.startRun).toHaveBeenCalledTimes(1));
  });
});
