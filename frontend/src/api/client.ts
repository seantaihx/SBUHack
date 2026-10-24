import type { Capabilities, CreateRun, Run, SampleTasks } from './types';

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
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
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
