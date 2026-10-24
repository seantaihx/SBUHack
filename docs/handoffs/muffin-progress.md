# Muffin progress checkpoint

**Checkpoint: WIP — 2026-10-24**

## Current branch and safety

- Working tree began clean on `Muffin_branch` at `339408f` (`Prepare frontend comparison integration and review`).
- Fetched `origin`; `origin/main` is `c2768c3` and was not modified. `origin/Sean_branch` has advanced through `625e293`; no merge or checkout of Sean's work was performed.
- No API keys, `.env` files, private documents, or uploaded content were read into this handoff.

## Completed before this checkpoint

- Previous comparison/benchmark integration and manual JSON run snapshot export are present on the branch.
- JSON currently includes the loaded run snapshot and separates local human annotations; it still needs explicit top-level run ID/version metadata.

## This task's completed work

- Read the attached expansion requirements and inspected README, frontend setup, accepted API contract, OpenAPI/fixtures inventory, current source files, current main and remote branch heads.
- Drafted `docs/proposals/source-import-export.md`. It is **PROPOSED, not accepted**; no shared contract or backend file changed.

## This task's files / tests

- `docs/proposals/source-import-export.md` — proposed source routes, schemas, limits, errors, URL safety, run/source references, retention questions, and exact Sean decisions.
- `docs/handoffs/muffin-progress.md` — this checkpoint.
- No tests for the new export formats have run yet.

## Unfinished work

1. Complete Milestone 1 exports from real loaded run snapshots: JSON metadata, safe CSV, and a clearly labeled print-to-PDF interim report.
2. Add focused tests for format/null preservation, CSV quoting/formula safety, partial runs, review annotations, and report content.
3. Run frontend tests/typecheck/build and verify downloads from a real persisted Demo run; reopen/round-trip JSON and CSV and inspect print report layout where available.
4. Update QA docs and this checkpoint with actual verification.
5. Do not implement source ingestion UI or call proposed routes until Sean confirms the proposal; do not change backend or accepted OpenAPI.

## Contract status and blockers

- Existing text-only comparison v1 remains authoritative.
- Source import, URL retrieval, source snapshots/references, and source-grounded answer behavior are proposed only.
- Browser UI/print-dialog automation availability is not yet established for this checkpoint.
- No billable provider requests are authorized or planned.

## Exact next action

Implement JSON/CSV exports and a print-optimized report using the currently loaded `Run` and local review annotations, then test their output structure before integrating any source feature.
