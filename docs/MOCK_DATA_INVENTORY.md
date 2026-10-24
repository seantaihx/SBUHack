# Frontend mock-data inventory

This inventory covers fixture files used or packaged by the current frontend. Runtime mock transport is centralized in [`../frontend/src/api/client.ts`](../frontend/src/api/client.ts). Mock mode is opt-in with `VITE_USE_FRONTEND_MOCK=true`; the UI shows a **FRONTEND MOCK ACTIVE** banner. Default mode is the real relative `/api/v1` client.

## Runtime mock files

| File | Consumed by | Content and behavior |
|---|---|---|
| [`../frontend/public/mock/capabilities.json`](../frontend/public/mock/capabilities.json) | `api.capabilities()` | Static API v1 capabilities; Demo enabled, Live disabled with a fixture reason, `task-routing-v1`, task limits, and hypothetical `illustrative-v1` coefficients. |
| [`../frontend/public/mock/tasks.json`](../frontend/public/mock/tasks.json) | `api.sampleTasks()` | The `sample-v1` classification, extraction, and summarization task prompts. These become the visible Demo checkboxes. |
| [`../frontend/public/mock/run-queued.json`](../frontend/public/mock/run-queued.json) | `api.createRun()` | Static queued Run response. It ignores request data and uses the fixture's fixed UUID and complete three-task list. The UI therefore prevents submitting a subset while mock mode is active. |
| [`../frontend/public/mock/run-completed.json`](../frontend/public/mock/run-completed.json) | `api.getRun()` by default in mock mode | Static completed response with synthetic outputs, token counts, latency, estimates, and aggregates. It does not calculate results from the request. |
| [`../frontend/public/mock/run-partial.json`](../frontend/public/mock/run-partial.json) | Available through the mock client's status lookup if session storage is set to `run-partial` | Static hypothetical partial Live run containing a provider timeout and unmatched attempt. The current UI has no control that selects this fixture; it is packaged for development/manual inspection only. |

The mock polling path waits 650 ms, stores `run-completed` in `sessionStorage` under `ecoagent-mock-<id>`, and then loads that static completed response. It does not call the backend. URL restoration in mock mode reads the requested ID from the fixture files; it does not validate UUIDs or maintain multiple independent mock runs.

## Contract and demo fixtures not loaded by the browser mock client

These shared files remain the source/examples for the backend and contract review; they are **not runtime imports** of the frontend:

| File | Purpose |
|---|---|
| `EcoAgent-repo-kit/contracts/examples/create-run.json` | Example POST body. |
| `EcoAgent-repo-kit/contracts/examples/error-active.json` | Example 409 active-run envelope. |
| `EcoAgent-repo-kit/contracts/examples/health.json` | Example health response; current UI does not call `/health`. |
| `EcoAgent-repo-kit/contracts/examples/run-queued.json` | Shared queued response example, copied into the frontend public fixtures. |
| `EcoAgent-repo-kit/contracts/examples/run-completed.json` | Shared completed response example, copied into the frontend public fixtures. |
| `EcoAgent-repo-kit/contracts/examples/run-partial.json` | Shared hypothetical partial response example, copied into the frontend public fixtures. |
| `EcoAgent-repo-kit/contracts/examples/capabilities.json` | Shared capability example, copied into the frontend public fixtures. |
| `EcoAgent-repo-kit/demo/tasks.json` | Authoritative sample task source, copied into the frontend public fixtures. |
| `EcoAgent-repo-kit/demo/results.json` | Synthetic demo attempt data; packaged for reference and not loaded directly by the frontend client. |
| `EcoAgent-repo-kit/demo/estimation-profile.json` | Illustrative coefficient reference; the UI reads coefficient values from capabilities, not this file. |

Copies under `frontend/public/mock` are deliberate static browser fixtures and can drift from shared examples. When Sean changes the contract or fixture content, update the corresponding copies and this inventory in the same frontend change. No mock should silently become the production default.

## Other fixed frontend values

- Type labels (`classify`, `extract`, `summarize`) and result policy/status enums are TypeScript representations of the shared schema.
- The default carbon scenario comes from `Capabilities.energy_profile.default_carbon_intensity_g_per_kwh`; the display value in a run comes from the Run snapshot.
- Policy label, limits, disabled reason, and energy coefficients are read from capabilities. UI-only wording, display precision, and loading/retry delay are presentation behavior.
- The development proxy defaults to `http://localhost:8000`; it can be configured with `VITE_API_PROXY_TARGET`. Browser API paths default to `/api/v1` and are configurable with `VITE_API_BASE_URL`.
- There is no chart package or chart interaction. The “impact overview” uses backend-supplied metric cards and does not perform client calculations.
