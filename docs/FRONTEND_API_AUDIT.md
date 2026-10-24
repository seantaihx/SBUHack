# Frontend API and mock audit

## Comparison workflow

The existing comparison UI uses the typed `api` in `frontend/src/api/client.ts` for `GET /api/v1/capabilities`, `GET /api/v1/sample-tasks`, `POST /api/v1/runs`, and `GET /api/v1/runs/{id}`. Its checked-in demo fixtures are enumerated in [`MOCK_DATA_INVENTORY.md`](MOCK_DATA_INVENTORY.md). Live inference remains backend-owned.

## Benchmark workflow

Before this work, the repository had no benchmark page, benchmark API service, benchmark data types, or benchmark runtime fixtures. No benchmark button or chart was disconnected because those controls did not exist. The new Benchmark view now uses `benchmarkApi` and explicit fixture files. Its endpoint set and fields are proposals only; they are not in shared OpenAPI and have not been exercised against FastAPI.

| Item | Source/behavior | Readiness |
|---|---|---|
| Dataset menu and supported model values | `benchmark-datasets.json` fixture or proposed backend dataset response | Implemented UI; backend schema requires agreement. |
| Run history | `benchmark-runs.json` empty fixture or proposed cursor page | First page, run opening, and load-more cursor interaction are implemented. |
| Start benchmark | `POST /benchmarks/runs` in API mode; mock service in fixture mode | Typed proposal; no backend route available. |
| Progress | Poll run snapshots; fixture status advances from fixture response on poll calls | Cleanup and terminal handling implemented; live behavior unverified. |
| Metric comparison | Reads nullable baseline/candidate metrics; computes only displayed cost delta percentage from returned costs | Mock values explicitly simulated; no metric claims. |
| Case outcomes | Cases endpoint; two synthetic fixture rows | Text-safe display includes backend-returned model IDs; load-more cursor interaction is implemented. |
| Cost, request counts, optimization events | Backend response fields or null | No hardcoded live values; unsupported routing/cache/tool metrics stay absent. |

## Secret and transport audit

- No Groq key is referenced by frontend source, fixtures, or Vite environment examples.
- Frontend API traffic uses the configured EcoAgent base path; there is no direct `api.groq.com` URL.
- `VITE_` values are browser-visible. Keep them free of credentials.
- Root `api.env` is a local ignored placeholder created earlier; it is not the backend's secret-loading implementation and should not be used by frontend code. Sean should configure `GROQ_API_KEY` in the backend's private local environment.
- Never expose a real key in chat, Git, screenshots, benchmark fixtures, or issue text. Rotate a credential if it was exposed.

## Remaining functional verification

- Agree the proposal with Sean and update OpenAPI/examples/client as one coordinated contract change.
- Verify actual dataset loading, run creation, polling, rate limit/error display, run history, and case pagination against the backend.
- Confirm server cursor behavior against the implemented history/case “load more” controls.
- Browser-test mobile/desktop layout, keyboard navigation, and screen-reader labels.
- The fixture cost/latency/token values are made-up examples for UI development; do not report them as benchmark evidence.
