# Frontend QA and outstanding work

## Checks run

Run from `frontend/` in PowerShell:

```powershell
npm.cmd ci
$env:VITE_USE_FRONTEND_MOCK = "false"
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
```

On October 24, 2026, all 42 Vitest tests passed. TypeScript typechecking also passed with the current source UI; the final production build is pending. Tests cover comparison submission/polling and duplicate prevention, errors, latency direction for negative/positive/zero/null values, local review persistence/storage failures, JSON/CSV export structure, CSV quoting/formula protection/Unicode/nulls, download/print actions, URL warnings, benchmark restoration, typed 409 navigation, local source previews, and safe blocking of unsupported source submissions.

## Results export milestone

- JSON includes export format/version, export timestamp, run ID and status/terminal state, the complete loaded run snapshot (keeping nulls as JSON `null`), and local manual-review annotations in a separate object.
- CSV is one row per available attempt, with run status/provenance, task/policy/model/routing, output, timing/tokens, cost/energy/carbon fields, human review, and attempt/run failures. Fields are quoted with embedded quotes doubled. Text cells that could be spreadsheet formulas get an apostrophe prefix. Unavailable fields are empty cells, not zero. For comparison API v1, per-attempt cost and source references are unavailable.
- `Print / Save PDF` opens the browser print dialog and tells the user to choose Save as PDF. This is an **interim print workflow, not a direct PDF download**. Print styling includes workload, routing, separate observed/simulated latency and illustrative estimate sections, attempt outputs, review labels, methodology and limitations; long content is configured to wrap and flow across pages.
- A real persisted Demo run (`0aab1070-143a-4a37-96b0-4893c2dd12d0`, completed/simulated) was fetched from `GET /api/v1/runs/{id}`. The export helpers generated JSON and CSV in `%TEMP%`; JSON reopened with the same run ID and all six attempts, and CSV parsed as six attempt rows with 30 columns. Files: `%TEMP%\ecoagent-export-smoke.json` and `%TEMP%\ecoagent-export-smoke.csv`.
- UI tests exercised the JSON/CSV download handlers and print action against loaded fixture snapshots. Browser print output was not generated/reopened or visually inspected in this environment; do not treat PDF pagination/readability as verified.

## HTTP verification

The local backend on port 8000 reported `GET /api/v1/health` as healthy, and capabilities reported `live_enabled: true`. No Live run or provider-backed inference request was sent.

The frontend dev server started with `VITE_USE_FRONTEND_MOCK=false` on port 5174 because port 5173 was already occupied. Requests through its Vite `/api` proxy succeeded:

- `GET /api/v1/health` → `200`, API version `1.0.0`.
- `GET /api/v1/sample-tasks` → `200`, three tasks.
- `GET /api/v1/capabilities` → `200`; illustrative energy profile and model IDs were returned by the backend.
- `POST /api/v1/runs` with `contracts/examples/create-run.json` → `202`; `GET /api/v1/runs/{id}` reached `completed`, `mode: demo`, `measurement_source: simulated`, with both policy outputs and backend comparison metrics.
- `GET /api/v1/benchmarks/datasets` → `200`, synthetic `starter-v1` dataset.
- `POST /api/v1/benchmarks/runs` with dataset `starter-v1`, baseline `openai/gpt-oss-120b`, candidate `eco-auto`, and `max_cases: 5` → `202`; `GET /api/v1/benchmarks/runs/{id}` reached `completed`, `measurement_source: simulated`, 5/5 cases.

Benchmark mode was not specified in the private root `.env`; backend settings default `BENCHMARK_INFERENCE_MODE` to `simulated`. The capabilities response and completed snapshots were checked without reading or printing any provider credential. No real quality claim follows from the synthetic benchmark.

## Verification boundaries

- A browser UI surface was not available to the automation tool, so no visual browser walkthrough/screenshots or browser-generated PDF were captured.
- Source UI is deliberately incomplete: pasted text can be previewed locally; file selection only reports filename/size; PDF/CSV parser fixtures are synthetic and unrelated to selected files; URL input never fetches. Source-enabled comparisons stay disabled because accepted API v1 has no source routes. No source file was uploaded.
- Desktop, tablet, and phone viewport review remains outstanding. Keep provenance and simulation labels visible at each size.
- Keyboard-only and screen-reader behavior still needs a manual browser pass. Automated DOM tests do not measure contrast or confirm announcements in real assistive technology.
- No GitHub issues were filed from this checkout.

## Outstanding issues

### Functional

1. Complete this final test/typecheck/build pass after the source UI changes.
2. In a real browser, save the print report to PDF, reopen it, and inspect page breaks, long/wide content, and Unicode; decide whether to keep this print workflow or add a true PDF file generator.
3. Walk through Demo/Live labels, URL restoration, JSON/CSV downloads, review persistence/reset, network retry, benchmark dataset/history/cases, and narrow-screen behavior.
4. After Sean accepts and implements the proposal, add actual PDF/CSV parsing, safe URL retrieval, source references, explicit submission confirmation, and end-to-end source-run verification.
5. Exercise a provider failure only in an explicitly authorized Live environment; this session sent no Live requests. Confirm the production frontend is served by the backend at the expected same-origin path.

### API coordination

The shared active-run gate can reject a comparison submission while a benchmark is active. Benchmark 409 responses include `details.active_run_id` and `details.active_run_kind`; comparison 409 responses currently include only `details.active_run_id`. The comparison client therefore cannot safely know whether to restore a comparison or navigate to Benchmarks. Proposal for Sean: add `active_run_kind: "comparison" | "benchmark"` to comparison 409 details, matching the benchmark response. No backend or shared contract was changed here.

Source import/export API proposal: [`proposals/source-import-export.md`](proposals/source-import-export.md). It is pending Sean's review; only the frontend's guarded source-selection/preview shell exists. No parser, source routes, backend code, or accepted OpenAPI changes were added. Exact open decisions are listed in that proposal.

### Visual and accessibility review

1. Capture and inspect screenshots at desktop, tablet, and phone widths with Demo/Live and provenance labels visible.
2. Walk the page with keyboard-only navigation and a screen reader; verify focus order and announcements for loading, errors, and run status.

GitHub issue links: none filed.
