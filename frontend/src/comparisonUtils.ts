import type { ComparisonMetric, Run, RunStatus } from './api/types';

export type ReviewChoice = 'not_reviewed' | 'correct' | 'incorrect' | 'unsure';
export type ReviewSide = 'baseline' | 'optimized';
export type TaskReviews = Record<string, { baseline: ReviewChoice; optimized: ReviewChoice }>;
export type ReviewStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const reviewChoices: ReviewChoice[] = ['not_reviewed', 'correct', 'incorrect', 'unsure'];

const terminalStatuses: RunStatus[] = ['completed', 'partial', 'failed'];
const storageKey = (runId: string) => `ecoagent-manual-review:${runId}`;

export function safeReviewStorage(): ReviewStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isReviewChoice(value: unknown): value is ReviewChoice {
  return typeof value === 'string' && reviewChoices.includes(value as ReviewChoice);
}

function parseTaskReviews(value: unknown): TaskReviews {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const reviews: TaskReviews = {};
  for (const [taskId, sides] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) continue;
    if (!sides || typeof sides !== 'object' || Array.isArray(sides)) continue;
    const pair = sides as Record<string, unknown>;
    const baseline = isReviewChoice(pair.baseline) ? pair.baseline : 'not_reviewed';
    const optimized = isReviewChoice(pair.optimized) ? pair.optimized : 'not_reviewed';
    reviews[taskId] = { baseline, optimized };
  }
  return reviews;
}

export function readTaskReviews(runId: string, storage = safeReviewStorage()): { reviews: TaskReviews; storageAvailable: boolean } {
  if (!storage) return { reviews: {}, storageAvailable: false };
  try {
    const serialized = storage.getItem(storageKey(runId));
    return { reviews: serialized ? parseTaskReviews(JSON.parse(serialized)) : {}, storageAvailable: true };
  } catch {
    return { reviews: {}, storageAvailable: false };
  }
}

export function writeTaskReviews(runId: string, reviews: TaskReviews, storage = safeReviewStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(storageKey(runId), JSON.stringify(reviews));
    return true;
  } catch {
    return false;
  }
}

export function clearTaskReviews(runId: string, storage = safeReviewStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(storageKey(runId));
    return true;
  } catch {
    return false;
  }
}

export function taskReview(reviews: TaskReviews, taskId: string) {
  return reviews[taskId] ?? { baseline: 'not_reviewed' as const, optimized: 'not_reviewed' as const };
}

export function latencyChange(metric: ComparisonMetric) {
  if (metric.saved === null) return { magnitude: null, direction: null, percentage: null };
  const direction = metric.saved < 0 ? 'slower' : metric.saved > 0 ? 'saved' : 'no change';
  return {
    magnitude: Math.abs(metric.saved),
    direction,
    percentage: metric.savings_pct === null ? null : Math.abs(metric.savings_pct),
  };
}

export function promptContainsUrl(prompt: string): boolean {
  return /\b(?:https?:\/\/|www\.)[^\s<>"']+/i.test(prompt);
}

export function createRunExport(run: Run, reviews: TaskReviews, exportedAt = new Date()) {
  return {
    export_format: 'ecoagent-run-snapshot',
    export_version: 1,
    exported_at: exportedAt.toISOString(),
    run_id: run.id,
    snapshot_status: run.status,
    snapshot_is_terminal: terminalStatuses.includes(run.status),
    run_snapshot: run,
    manual_review_annotations: {
      scope: 'local browser only',
      interpretation: 'Human judgments, not automated quality scores.',
      by_task: reviews,
    },
  };
}

const csvColumns = [
  'export_version', 'exported_at', 'run_id', 'run_status', 'snapshot_is_terminal', 'mode', 'measurement_source',
  'created_at', 'policy_version', 'energy_estimation_profile', 'carbon_intensity_g_per_kwh', 'task_id', 'task_type',
  'policy', 'model_role', 'model_id', 'routing_reason', 'attempt_status', 'output_text', 'latency_ms', 'input_tokens',
  'output_tokens', 'cost_usd', 'estimated_energy_wh', 'estimated_carbon_g', 'human_review',
  'attempt_error_code', 'attempt_error_message', 'run_error_code', 'run_error_message',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** One row per backend result/attempt; null metrics are blank cells, never numeric zero. */
export function createRunCsv(run: Run, reviews: TaskReviews, exportedAt = new Date()): string {
  const tasks = new Map(run.tasks.map((task) => [task.id, task]));
  const rows = run.results.map((result) => {
    const task = tasks.get(result.task_id);
    const review = task ? taskReview(reviews, task.id)[result.policy] : 'not_reviewed';
    const values: Record<(typeof csvColumns)[number], unknown> = {
      export_version: 1,
      exported_at: exportedAt.toISOString(),
      run_id: run.id,
      run_status: run.status,
      snapshot_is_terminal: terminalStatuses.includes(run.status),
      mode: run.mode,
      measurement_source: run.measurement_source,
      created_at: run.created_at,
      policy_version: run.policy_version,
      energy_estimation_profile: run.energy_estimation_profile,
      carbon_intensity_g_per_kwh: run.carbon_intensity_g_per_kwh,
      task_id: result.task_id,
      task_type: task?.type ?? null,
      policy: result.policy,
      model_role: result.model_role,
      model_id: result.model_id,
      routing_reason: result.routing_reason,
      attempt_status: result.status,
      output_text: result.output_text,
      latency_ms: result.latency_ms,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: null,
      estimated_energy_wh: result.estimated_energy_wh,
      estimated_carbon_g: result.estimated_carbon_g,
      human_review: review,
      attempt_error_code: result.error?.code ?? null,
      attempt_error_message: result.error?.message ?? null,
      run_error_code: run.run_error?.code ?? null,
      run_error_message: run.run_error?.message ?? null,
    };
    return csvColumns.map((column) => csvCell(values[column])).join(',');
  });
  return [csvColumns.join(','), ...rows].join('\r\n');
}
