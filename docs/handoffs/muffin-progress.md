# Muffin progress checkpoint

**Checkpoint: WIP — 2026-10-24 (source selection shell added; no real parsing)**

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
- Added JSON export metadata, one-row-per-attempt CSV with text-cell formula protection, and an explicitly labeled browser Print/Save as PDF report.
- Added 36-test coverage for exports, CSV quote/newline/Unicode handling, formula safety, null preservation, partial-run warnings, and UI download/print actions.
- Fetched real persisted simulated run `0aab1070-143a-4a37-96b0-4893c2dd12d0`; generated/reopened JSON and parsed six CSV attempt rows with 30 fields in `%TEMP%`.
- Added source selection UI for pasted text, PDF, CSV, and URL. API mode clearly reports source routes unavailable, does not upload/fetch, and disables comparison while a source is selected. Explicit fixture mode can load labeled synthetic PDF/CSV examples unrelated to any user file.

## Files / tests

- `docs/proposals/source-import-export.md` — proposed source routes, schemas, limits, errors, URL safety, run/source references, retention questions, and exact Sean decisions.
- `docs/handoffs/muffin-progress.md` — this checkpoint.
- `frontend/src/App.tsx`, `frontend/src/comparisonUtils.ts`, `frontend/src/styles.css` — export actions/report.
- `frontend/src/App.test.tsx`, `frontend/src/comparisonUtils.test.ts` — UI/format tests.
- `frontend/src/SourceInput.tsx`, `frontend/src/SourceInput.test.tsx`, `frontend/public/mock/source-preview.json` — guarded source UI and fixtures.
- `frontend/README.md`, `docs/FRONTEND_QA.md`, `docs/MOCK_DATA_INVENTORY.md` — format, source UI, and fixture verification notes.
- Commands run with `VITE_USE_FRONTEND_MOCK=false`: `npm.cmd run test` (42 passed), `npm.cmd run typecheck` (passed), and `npm.cmd run build` (passed).
- PDF output remains unverified; the implemented browser print flow is not a direct PDF download.
- Proposal checkpoint commit `d2d0e1b` was pushed to `origin/Muffin_branch`.
- Export milestone commit `46b367c` was pushed to `origin/Muffin_branch`; branch was clean after push before this handoff edit.

## Unfinished work

1. Commit and push this clearly labeled WIP source-selection shell; keep `main` unchanged.
2. Open/reopen a browser-generated print report and visually check pagination when browser UI automation is available.
3. Continue not calling proposed source routes or changing backend/OpenAPI until Sean confirms the proposal.
4. After agreement, implement actual PDF/CSV parsing and source-backed API integration in a separate milestone.

## Contract status and blockers

- Existing text-only comparison v1 remains authoritative.
- Source import, URL retrieval, source snapshots/references, and source-grounded answer behavior are proposed only.
- Browser UI/print-dialog automation availability is not yet established for this checkpoint.
- No billable provider requests are authorized or planned.

## Exact next action

Commit the source-selection shell as WIP, then wait for Sean's contract decisions before implementing any source parsing or retrieval request.
