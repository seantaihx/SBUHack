import { describe, expect, it } from 'vitest';
import type { ComparisonMetric, Run } from './api/types';
import completedFixture from '../public/mock/run-completed.json';
import {
  clearTaskReviews,
  createRunExport,
  latencyChange,
  promptContainsUrl,
  readTaskReviews,
  writeTaskReviews,
  type ReviewStorage,
} from './comparisonUtils';

const metric = (saved: number | null, savings_pct: number | null): ComparisonMetric => ({ baseline: 100, optimized: saved === null ? null : 100 - saved, saved, savings_pct });

function memoryStorage(): ReviewStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('comparison helpers', () => {
  it('formats negative, positive, zero, and null latency savings without changing backend metrics', () => {
    expect(latencyChange(metric(-289, -6.1))).toEqual({ magnitude: 289, direction: 'slower', percentage: 6.1 });
    expect(latencyChange(metric(289, 6.1))).toEqual({ magnitude: 289, direction: 'saved', percentage: 6.1 });
    expect(latencyChange(metric(0, 0))).toEqual({ magnitude: 0, direction: 'no change', percentage: 0 });
    expect(latencyChange(metric(null, null))).toEqual({ magnitude: null, direction: null, percentage: null });
  });

  it('recognizes URLs without requiring them to be the entire prompt', () => {
    expect(promptContainsUrl('Summarize https://example.com after reading this pasted text.')).toBe(true);
    expect(promptContainsUrl('Use https://example.com/path?x=1')).toBe(true);
    expect(promptContainsUrl('Use www.example.com along with the supplied text.')).toBe(true);
    expect(promptContainsUrl('No page address in this prompt.')).toBe(false);
  });

  it('persists per-run human review state and clears only that run', () => {
    const storage = memoryStorage();
    const reviews = { 'classify-1': { baseline: 'unsure' as const, optimized: 'correct' as const } };
    expect(writeTaskReviews('run-a', reviews, storage)).toBe(true);
    expect(readTaskReviews('run-a', storage)).toEqual({ reviews, storageAvailable: true });
    expect(readTaskReviews('run-b', storage)).toEqual({ reviews: {}, storageAvailable: true });
    expect(clearTaskReviews('run-a', storage)).toBe(true);
    expect(readTaskReviews('run-a', storage)).toEqual({ reviews: {}, storageAvailable: true });
  });

  it('handles unavailable browser storage without failing the result view', () => {
    const unavailable: ReviewStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(readTaskReviews('run-a', unavailable)).toEqual({ reviews: {}, storageAvailable: false });
    expect(writeTaskReviews('run-a', {}, unavailable)).toBe(false);
    expect(clearTaskReviews('run-a', unavailable)).toBe(false);
  });

  it('ignores malformed task ids in stored review data', () => {
    const storage = memoryStorage();
    storage.setItem('ecoagent-manual-review:run-a', JSON.stringify({
      '__proto__': { baseline: 'correct', optimized: 'incorrect' },
      'bad task id': { baseline: 'correct', optimized: 'incorrect' },
      'classify-1': { baseline: 'correct', optimized: 'unsure' },
    }));
    expect(readTaskReviews('run-a', storage)).toEqual({
      reviews: { 'classify-1': { baseline: 'correct', optimized: 'unsure' } },
      storageAvailable: true,
    });
  });

  it('exports a snapshot and local judgments separately with status and timestamp', () => {
    const run = { ...completedFixture, status: 'running' } as Run;
    const reviews = { 'classify-1': { baseline: 'not_reviewed' as const, optimized: 'incorrect' as const } };
    const exported = createRunExport(run, reviews, new Date('2026-10-24T15:00:00.000Z'));

    expect(exported).toEqual({
      export_format: 'ecoagent-run-snapshot',
      export_version: 1,
      exported_at: '2026-10-24T15:00:00.000Z',
      snapshot_status: 'running',
      snapshot_is_terminal: false,
      run_snapshot: run,
      manual_review_annotations: {
        scope: 'local browser only',
        interpretation: 'Human judgments, not automated quality scores.',
        by_task: reviews,
      },
    });
    expect(exported.run_snapshot).toBe(run);
    expect(Object.keys(exported)).not.toContain('authorization');
    expect(JSON.stringify(exported)).not.toContain('GROQ_API_KEY');
  });
});
