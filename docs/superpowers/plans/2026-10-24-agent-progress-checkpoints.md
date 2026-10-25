# Agent Progress Checkpoints Implementation Plan

> Execute inline using the executing-plans and test-driven-development skills. User authorized the previously discussed workflow controls and periodic checks. Preserve local work and existing per-action approvals.

**Goal:** Support longer bounded workflows with periodic evidence-based progress review, persistent continuation and explicit budget extension.
**Architecture:** Add backward-compatible fields to stored AgentRun JSON. A deterministic progress module assesses completed approved tool observations every N model calls without paid judge calls. Agent service enforces limits and acknowledgment; React exposes checkpoints, task checklist, usage and final human verification.
**Tech stack:** Existing FastAPI/Pydantic/SQLite and React/TypeScript; no new dependencies.
**Spec:** User's approved workflow controls in this chat plus defaults below.

## Defaults and boundaries
- Review every 5 model calls, configurable 1-20. Initial model budget 12, extend explicitly to a server ceiling default 100. Existing request/spend caps still apply independently.
- Every extension remains the same run; counters, actions, observations and reservations never reset. Time budget default 3600 seconds including paused time; no background work when paused.
- Completed distinct file-version reads count as new evidence; changed approved writes count as activity, not semantic correctness. Repeated outcomes returning to a known state or windows without new evidence/changes pause for operator guidance.
- No-op writes blocked. Reread allowed after content changes. Repeated unchanged read blocked. Duplicate identity includes approved file state, not just operation/path.
- No model-based certainty claims. Checkpoints say observed_progress, stalled or uncertain. Final model claim requires operator review; exhausted budget is paused, never completed.
- Task checklist is user-defined and user-reviewed, never model-attested correctness. File content retained only within existing approved scope; proposed changes have a unified diff and retained before/after history.
- No automatic retry loops; explicit Continue is bounded recovery and includes guidance after stalls. No shell/network tools, arbitrary tests, new provider calls during verification, secret/config changes or push.

## Tasks
- [ ] 1. Add failing backend tests for periodic checks, same-run extension, changed-file rereads, no-op/cyclic writes, completion review and persisted checkpoints.
- [ ] 2. Add agent_progress.py and additive schemas/settings; implement progress snapshots, usage totals, time/step pause, bounded extensions and human final verification. Keep approval checks and stop races safe.
- [ ] 3. Add UI tests; implement review interval, checklist, checkpoint report, guidance/extension/finish controls, cost/time totals and write diff. Update client types/contracts.
- [ ] 4. Regenerate agent OpenAPI components; document semantics and limitations. Run backend/frontend suites, typecheck/build, whitespace and focused review.

## Review focus
Stale/concurrent continuation; stopped run overwritten by an in-flight response; read-only productive work; changed-file rereads; false completion at budget exhaustion; persisted old runs; price-unknown totals; stop during progress review; scope expansion through checkpoint APIs.

## Verification record
Pending. Baseline known failure: agent test assumes CRLF on macOS; make fixture bytes explicit rather than changing production newline behavior.
