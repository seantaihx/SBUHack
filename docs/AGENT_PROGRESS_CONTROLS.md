# Longer workflows and periodic progress review

The workspace agent reviews observable progress every **5 model calls** by default. Configure the interval from 1 to 20 when starting a run. A model call is one planning step, not a completed business task or a tool action.

## Workflow

1. Enter exact read/write paths and a checklist of completion criteria. Each checklist item is a task or result you can independently review.
2. Select an initial call budget (default 12), review interval and elapsed-time budget (default 3,600 seconds, including pauses).
3. Approve each exact action. Writes show a unified diff and retain before/after content for inspection and a separately approved recovery. No command execution or automatic restore is added.
4. After the configured number of calls resolves, a checkpoint records new file-version reads, changed approved writes and failed/denied actions. A pending action resolves when approved or denied, so an unexecuted write never counts as progress.
5. Continue one step at a time. A stalled/uncertain checkpoint requires review notes guiding the next approach. The model receives the checkpoint and operator guidance. No extra paid judge call is used.
6. At the call budget, the run pauses with `STEP_LIMIT_REACHED`, not success. Approve more calls on the same run with a reason, then separately Continue. Usage, history and spending reservations are retained.
7. When the model proposes completion, review the output and checklist. Acceptance requires all criteria checked and an operator note; the backend verifies that observed files still match their latest recorded hashes. This establishes file consistency plus human review, not automatic semantic correctness.

## What detects loops

- Unchanged rereads are blocked after a completed read of that version; changed files may be read again.
- No-op writes are blocked. Writes returning to a previously observed file state are flagged as possible cycles; they are not automatically executed.
- A review window without new reads/changed writes is stalled if failures/denials occurred, otherwise uncertain. Both require guidance before another call.
- Step, elapsed-time, request and spending limits remain separate backstops.
- There are no automatic retry loops. Operator-directed recovery is bounded by the same cumulative limits.

These are conservative heuristics. An intentional revert can be flagged; different edits that accomplish nothing may still look like activity. Large conceptual reasoning tasks may provide no file evidence and need human review. The UI does not label the checkpoint as a proof of correctness or a universal infinite-loop detector.

## Budget and persistence semantics

`AGENT_MAX_STEPS` is the server ceiling (default 100; supported 12-1000). An individual run requests a budget within it. Existing `INFERENCE_MAX_REQUESTS_PER_RUN`, run/day spending limits and provider deadlines still apply; increasing the step ceiling alone does not authorize more provider spending. The default request cap may stop the run sooner than its step ceiling.

Extensions do not dispatch calls or expand path permissions. Elapsed time cannot be extended. Expired runs remain paused for inspection or Stop, and cannot execute pending writes. A paused run retains the existing active-job slot until stopped/completed.

Checkpoints, observations, checklist state, file revisions and usage totals persist in SQLite run snapshots. Restart clears pending approvals, pauses work and retains completion-review or exhausted-budget state. Old snapshots load with additive defaults; missing historical usage stays unavailable. Costs remain estimates from the existing float-based pricing system, not invoice totals or the future decimal pricing engine.

Retained revisions contain approved file content and are private to the existing local database. They have the same retention limitations as other local run snapshots. No new multi-user security or deletion policy is claimed.

## API additions

All operations retain loopback checks and existing approval rules.

- Start: optional `review_interval` (default 5), `max_elapsed_seconds` (default 3600), `checklist` (up to 30 nonempty items); `max_steps` defaults to 12 and is bounded by the server ceiling.
- `POST /api/v1/agent-runs/{id}/continue`: optional `{ "guidance": "..." }`. Guidance is required after a stalled/uncertain review or to reject model-proposed completion and continue.
- `POST /api/v1/agent-runs/{id}/extend`: `{ "additional_steps": 10, "reason": "Remaining files need work" }`. Paused runs only; never resets counters or starts a call.
- `POST /api/v1/agent-runs/{id}/review`: `{ "completed_items": [0, 1], "accept_completion": false, "note": "Checked both results" }`. Indices are zero-based. Set acceptance true only for a model-proposed finish with the entire checklist reviewed.
- Run responses add `checkpoints`, `observations`, `revisions`, `review_required`, checklist review state, nullable token/cost/provider-time totals and configured review/time limits.
- Pending writes include `diff`; existing before/after previews remain available.

State changes are deliberate: a model `finish` now proposes completion and pauses; reaching the step limit no longer means completed. Older clients should be updated together with this backend to expose extension and completion review.

## Verification scenarios

Automated regressions cover: a productive 14-call workflow; repeated unchanged reads; rereading changed files; reading a version just written; no-op/cyclic writes; denied actions in review windows; stalled guidance requirement; same-run extensions and ceiling rejection; elapsed-time checks before writes; unknown usage; restart persistence/invalidation; model completion and changed-artifact rejection; existing path/approval safeguards. Frontend tests cover interval configuration, checkpoint evidence, extension without automatic continuation, and disabled completion until review.

No real provider calls are needed. The broader proposed firewall dataset is still a separate, non-executable proposal; these are actual agent-service tests, not a claim that it has been implemented as a benchmark dashboard dataset.
