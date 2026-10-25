import type { AgentCapabilities, AgentEventsResponse, AgentRun, AgentStartRequest, BenchmarkCasesResponse, BenchmarkDatasetsResponse, BenchmarkExport, BenchmarkRun, BenchmarkRunsResponse, Capabilities, CreateRun, LocalProviderSettings, Run, SampleTasks, SourceSnapshot, StartBenchmarkRequest, StartBenchmarkResponse } from './types';

const mockMode = import.meta.env.VITE_USE_FRONTEND_MOCK === 'true';
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
const fixture = <T,>(name: string): Promise<T> => fetch(`/mock/${name}.json`).then(async (response) => {
  if (!response.ok) throw new Error(`Frontend mock ${name} could not be loaded.`);
  return response.json() as Promise<T>;
});

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: Record<string, unknown>) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body as { error?: { message?: string; code?: string; details?: Record<string, unknown> } } | null;
    throw new ApiError(envelope?.error?.message ?? `Request failed (${response.status}).`, response.status, envelope?.error?.code, envelope?.error?.details);
  }
  return body as T;
}

export const api = {
  isMock: mockMode,
  baseUrl: apiBaseUrl,
  capabilities: () => mockMode ? fixture<Capabilities>('capabilities') : request<Capabilities>('/capabilities'),
  localProviderSettings: () => mockMode ? Promise.reject(new ApiError('Provider setup requires the local backend; fixture mode does not store credentials.', 503, 'LOCAL_SETUP_MOCK')) : request<LocalProviderSettings>('/local-settings/provider'),
  saveLocalProviderKey: (apiKey: string) => mockMode ? Promise.reject(new ApiError('Provider setup requires the local backend; fixture mode does not store credentials.', 503, 'LOCAL_SETUP_MOCK')) : request<LocalProviderSettings>('/local-settings/provider-key', { method: 'PUT', body: JSON.stringify({ api_key: apiKey }) }),
  sampleTasks: () => mockMode ? fixture<SampleTasks>('tasks') : request<SampleTasks>('/sample-tasks'),
  createRun: async (payload: CreateRun) => {
    if (!mockMode) return request<Run>('/runs', { method: 'POST', body: JSON.stringify(payload) });
    return fixture<Run>('run-queued');
  },
  getRun: async (id: string, signal?: AbortSignal) => {
    if (!mockMode) return request<Run>(`/runs/${encodeURIComponent(id)}`, { signal });
    const status = sessionStorage.getItem(`ecoagent-mock-${id}`) ?? 'run-completed';
    return fixture<Run>(status);
  },
  advanceMock: (id: string) => sessionStorage.setItem(`ecoagent-mock-${id}`, 'run-completed'),
};

function requireSourceApi() {
  if (mockMode) throw new ApiError('Source APIs are unavailable in frontend fixture mode.', 503, 'SOURCE_API_MOCK');
}

export const sourceApi = {
  createText: async (text: string, name = 'Pasted text') => {
    requireSourceApi();
    return request<{ source: SourceSnapshot }>('/sources/text', { method: 'POST', body: JSON.stringify({ text, name }) });
  },
  createFile: async (file: File) => {
    requireSourceApi();
    const body = new FormData(); body.append('file', file);
    return request<{ source: SourceSnapshot }>('/sources/files', { method: 'POST', body });
  },
  createWebpage: async (url: string) => {
    requireSourceApi();
    return request<{ source: SourceSnapshot }>('/sources/webpage', { method: 'POST', body: JSON.stringify({ url }) });
  },
  get: async (id: string, signal?: AbortSignal) => mockMode ? Promise.reject(new ApiError('Source restoration is unavailable in fixture mode.', 503, 'SOURCE_API_MOCK')) : request<{ source: SourceSnapshot }>(`/sources/${encodeURIComponent(id)}`, { signal }),
  remove: async (id: string) => {
    requireSourceApi();
    await request<null>(`/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

function requireAgentApi() {
  if (mockMode) throw new ApiError('Workspace agent APIs require the real backend; fixture mode cannot execute workspace actions.', 503, 'AGENT_API_MOCK');
}

export const agentApi = {
  capabilities: () => request<AgentCapabilities>('/agent/capabilities'),
  start: (payload: AgentStartRequest) => { requireAgentApi(); return request<AgentRun>('/agent-runs', { method: 'POST', body: JSON.stringify(payload) }); },
  get: (id: string, signal?: AbortSignal) => { requireAgentApi(); return request<AgentRun>(`/agent-runs/${encodeURIComponent(id)}`, { signal }); },
  events: (id: string, cursor = 0, signal?: AbortSignal) => { requireAgentApi(); return request<AgentEventsResponse>(`/agent-runs/${encodeURIComponent(id)}/events?cursor=${cursor}`, { signal }); },
  approve: (id: string, actionId: string, actionHash: string, approved: boolean) => {
    requireAgentApi(); return request<AgentRun>(`/agent-runs/${encodeURIComponent(id)}/approvals`, {
      method: 'POST', body: JSON.stringify({ action_id: actionId, action_hash: actionHash, approved }),
    });
  },
  continue: (id: string) => { requireAgentApi(); return request<AgentRun>(`/agent-runs/${encodeURIComponent(id)}/continue`, { method: 'POST' }); },
  stop: (id: string) => { requireAgentApi(); return request<AgentRun>(`/agent-runs/${encodeURIComponent(id)}/stop`, { method: 'POST' }); },
};

const mockBenchmarks = new Map<string, { run: BenchmarkRun; polls: number }>();
const mockJson = async <T,>(name: string): Promise<T> => {
  const response = await fetch(`/mock/${name}.json`);
  if (!response.ok) throw new Error(`Benchmark mock ${name} could not be loaded.`);
  return response.json() as Promise<T>;
};

async function startMockBenchmark(payload: StartBenchmarkRequest): Promise<StartBenchmarkResponse> {
  const fixture = await mockJson<BenchmarkRun>('benchmark-run');
  const runId = `mock-${Date.now()}`;
  const run: BenchmarkRun = {
    ...fixture, run_id: runId, status: 'queued', dataset_id: payload.dataset_id,
    baseline: payload.baseline, candidate: payload.candidate, max_cases: payload.max_cases,
    progress: { completed: 0, total: payload.max_cases }, baseline_metrics: null, candidate_metrics: null,
    started_at: null, finished_at: null,
  };
  mockBenchmarks.set(runId, { run, polls: 0 });
  return { run_id: runId, status: 'queued' };
}

async function getMockBenchmark(runId: string): Promise<BenchmarkRun> {
  const local = mockBenchmarks.get(runId);
  if (local) {
    local.polls += 1;
    const fixture = await mockJson<BenchmarkRun>('benchmark-run');
    if (local.polls === 1) {
      local.run = {
        ...local.run, status: 'running',
        progress: { completed: Math.max(1, Math.floor(local.run.max_cases / 2)), total: local.run.max_cases },
        started_at: fixture.started_at,
      };
    } else {
      const scale = local.run.max_cases / 5;
      const scaledMetrics = (metrics: NonNullable<BenchmarkRun['baseline_metrics']>) => {
        const passed = Math.min(local.run.max_cases, Math.round((metrics.passed_cases ?? 0) * scale));
        return {
          ...metrics, total_cases: local.run.max_cases, passed_cases: passed,
          pass_rate: local.run.max_cases ? passed / local.run.max_cases : null,
          failed_cases: local.run.max_cases - passed,
          total_cost_usd: metrics.total_cost_usd === null ? null : metrics.total_cost_usd * scale,
          input_tokens: metrics.input_tokens === null ? null : Math.round(metrics.input_tokens * scale),
          output_tokens: metrics.output_tokens === null ? null : Math.round(metrics.output_tokens * scale),
          total_requests: local.run.max_cases,
        };
      };
      local.run = {
        ...fixture, run_id: runId, dataset_id: local.run.dataset_id,
        baseline: local.run.baseline, candidate: local.run.candidate, max_cases: local.run.max_cases,
        progress: { completed: local.run.max_cases, total: local.run.max_cases },
        baseline_metrics: fixture.baseline_metrics ? scaledMetrics(fixture.baseline_metrics) : null,
        candidate_metrics: fixture.candidate_metrics ? scaledMetrics(fixture.candidate_metrics) : null,
      };
    }
    return local.run;
  }
  const fixture = await mockJson<BenchmarkRun>('benchmark-run');
  return { ...fixture, run_id: runId };
}

async function listMockBenchmarks(): Promise<BenchmarkRunsResponse> {
  const fixture = await mockJson<BenchmarkRunsResponse>('benchmark-runs');
  const localRuns = Array.from(mockBenchmarks.values()).map(({ run }) => run);
  return { ...fixture, items: [...localRuns, ...fixture.items].slice(0, 20) };
}

async function getMockBenchmarkCases(runId: string): Promise<BenchmarkCasesResponse> {
  const fixture = await mockJson<BenchmarkCasesResponse>('benchmark-cases');
  const localRun = mockBenchmarks.get(runId)?.run;
  return localRun ? { ...fixture, items: fixture.items.slice(0, localRun.max_cases) } : fixture;
}

export const benchmarkApi = {
  listDatasets: () => mockMode ? mockJson<BenchmarkDatasetsResponse>('benchmark-datasets') : request<BenchmarkDatasetsResponse>('/benchmarks/datasets'),
  listRuns: (limit = 20, cursor?: string) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return mockMode ? listMockBenchmarks() : request<BenchmarkRunsResponse>(`/benchmarks/runs?${query}`);
  },
  startRun: (payload: StartBenchmarkRequest) => mockMode ? startMockBenchmark(payload) : request<StartBenchmarkResponse>('/benchmarks/runs', { method: 'POST', body: JSON.stringify(payload) }),
  getRun: (runId: string, signal?: AbortSignal) => mockMode ? getMockBenchmark(runId) : request<BenchmarkRun>(`/benchmarks/runs/${encodeURIComponent(runId)}`, { signal }),
  getCases: (runId: string, limit = 50, cursor?: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return mockMode ? getMockBenchmarkCases(runId) : request<BenchmarkCasesResponse>(`/benchmarks/runs/${encodeURIComponent(runId)}/cases?${query}`, { signal });
  },
  exportRun: (runId: string) => mockMode ? mockJson<BenchmarkExport>('benchmark-export') : request<BenchmarkExport>(`/benchmarks/runs/${encodeURIComponent(runId)}/export`),
  isMock: mockMode,
};
