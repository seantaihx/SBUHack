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
