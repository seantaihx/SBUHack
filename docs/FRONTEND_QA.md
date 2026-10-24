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

On October 24, 2026, all 34 Vitest tests passed, TypeScript typechecking passed, and the production build passed with frontend mock mode disabled. The tests cover comparison submission and polling states, duplicate-submit prevention, errors, latency direction for negative/positive/zero/null values, review state and unavailable storage, export contents, URL warnings, benchmark state restoration, and typed 409 navigation.

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

- A browser UI surface was not available to the automation tool, so no visual browser walkthrough or screenshots were captured.
- Desktop, tablet, and phone viewport review remains outstanding. Keep provenance and simulation labels visible at each size.
- Keyboard-only and screen-reader behavior still needs a manual browser pass. Automated DOM tests do not measure contrast or confirm announcements in real assistive technology.
- No GitHub issues were filed from this checkout.

## Outstanding issues

### Functional

1. Run the UI in a real browser and walk through Demo/Live labels, comparison submission, URL refresh restoration, export, manual review persistence/reset, network retry, benchmark dataset/history/cases, and narrow-screen behavior.
2. Exercise a provider failure only in an explicitly authorized Live environment; this session sent no Live requests.
3. Confirm the production frontend is served by the backend at the expected same-origin path.

### API coordination

The shared active-run gate can reject a comparison submission while a benchmark is active. Benchmark 409 responses include `details.active_run_id` and `details.active_run_kind`; comparison 409 responses currently include only `details.active_run_id`. The comparison client therefore cannot safely know whether to restore a comparison or navigate to Benchmarks. Proposal for Sean: add `active_run_kind: "comparison" | "benchmark"` to comparison 409 details, matching the benchmark response. No backend or shared contract was changed here.

### Visual and accessibility review

1. Capture and inspect screenshots at desktop, tablet, and phone widths with Demo/Live and provenance labels visible.
2. Walk the page with keyboard-only navigation and a screen reader; verify focus order and announcements for loading, errors, and run status.

GitHub issue links: none filed.
