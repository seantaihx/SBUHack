# Frontend/API integration contract

This document maps the existing frontend to the shared EcoAgent API v1. It does not add endpoints or change the request/response schema. The source of truth is [`../EcoAgent-repo-kit/contracts/openapi.json`](../EcoAgent-repo-kit/contracts/openapi.json), with behavioral rules in [`../EcoAgent-repo-kit/docs/02-api-and-data.md`](../EcoAgent-repo-kit/docs/02-api-and-data.md).

## Connection configuration

The browser client is centralized in [`../frontend/src/api/client.ts`](../frontend/src/api/client.ts). It uses `VITE_API_BASE_URL`, defaulting to `/api/v1`. The recommended value is a same-origin path ending in `/api/v1`; browser requests remain relative and avoid CORS. During development, Vite proxies `/api` to `VITE_API_PROXY_TARGET`, defaulting to `http://localhost:8000`. See [`../frontend/.env.example`](../frontend/.env.example).

An absolute `VITE_API_BASE_URL` is technically accepted by `fetch`, but cross-origin use requires backend CORS configuration and is not the documented deployment path. Do not put provider keys or other secrets in any `VITE_` variable; Vite exposes these values to browser code.

Set `VITE_USE_FRONTEND_MOCK=true` only for the explicit fixture preview. The default is false. Mock mode uses checked-in static examples, not a backend, and supports only the complete three-task sample run.

## Endpoints consumed by the frontend

All routes below are relative to `/api/v1`. JSON uses snake_case. `GET /health` is in the shared contract but is **not currently called by the frontend**.

| Frontend API method | HTTP method and path | Request body | Success response | Frontend consumers |
|---|---|---|---|---|
| `api.capabilities()` | `GET /capabilities` | None | `Capabilities` (schema below) | `App` startup: modes, safe Live disabled reason, task/prompt limits, policy label, default carbon scenario and energy coefficients in assumptions disclosure. |
| `api.sampleTasks()` | `GET /sample-tasks` | None | `SampleTasks` | `App` startup and Demo checkboxes. The request payload uses the exact selected task objects returned here. |
| `api.createRun(payload)` | `POST /runs` | `CreateRun` (schema below) | `202 Run`; `Location: /api/v1/runs/{id}` | Compare button submission state; initial run status, task list, run ID and URL restoration. The UI disables repeat submission while pending. |
| `api.getRun(id)` | `GET /runs/{run_id}` | None; `{run_id}` is a server-generated UUID path segment | `200 Run` | Initial `?run=<uuid>` restoration, polling, manual retry, and reopening an active run after a `409`. |

The client currently uses the `Run.id` body field to navigate/poll; it does not read the `Location` header. The backend should still return the contractually required header.

## Request and response shapes

These TypeScript definitions are in [`../frontend/src/api/types.ts`](../frontend/src/api/types.ts) and mirror the OpenAPI v1 schema. Backend values remain authoritative.

### `Task`

```json
{
  "id": "classify-1",
  "type": "classify",
  "prompt": "Classify this support message..."
}
```

`id` matches `^[A-Za-z0-9_-]{1,64}$`; `type` is `classify`, `extract`, or `summarize`; `prompt` is trimmed nonempty text up to the configured 2000-character limit.

### `CreateRun`

```json
{
  "mode": "demo",
  "tasks": [{ "id": "classify-1", "type": "classify", "prompt": "..." }],
  "carbon_intensity_g_per_kwh": 400
}
```

`mode` is `demo` or `live`; there must be 1–10 unique tasks; scenario carbon intensity is 0–2000 gCO2e/kWh. Demo tasks must exactly match a nonempty subset of `demo/tasks.json`. Live prompts can be edited only when `Capabilities.live_enabled` is true. Unknown request fields are rejected by the contract.

### `Capabilities`

```json
{
  "api_version": "1.0.0",
  "demo_enabled": true,
  "live_enabled": false,
  "live_disabled_reason": "Live inference is not configured. Use Demo mode.",
  "max_tasks": 10,
  "max_prompt_chars": 2000,
  "policy_version": "task-routing-v1",
  "models": [
    { "role": "small", "live_model_id": null },
    { "role": "large", "live_model_id": null }
  ],
  "energy_profile": {
    "id": "illustrative-v1",
    "basis": "hypothetical_demo_coefficients_not_measurements",
    "default_carbon_intensity_g_per_kwh": 400,
    "models": {
      "small": { "input_wh_per_token": 0.00002, "output_wh_per_token": 0.00008 },
      "large": { "input_wh_per_token": 0.0001, "output_wh_per_token": 0.0004 }
    }
  }
}
```

The backend returns the safe Live disabled reason and policy/assumptions. The UI must not infer that configured capability means a provider is reachable.

### `SampleTasks`

```json
{ "version": "sample-v1", "tasks": [/* Task[] */] }
```

The actual task array is authoritative and comes from the backend. The sample fixture contains three tasks; the contract permits a selected nonempty subset.

### `Run`

`POST /runs` and `GET /runs/{run_id}` return a complete run snapshot:

```json
{
  "id": "<uuid>",
  "status": "queued",
  "mode": "demo",
  "measurement_source": "simulated",
  "policy_version": "task-routing-v1",
  "energy_estimation_profile": "illustrative-v1",
  "carbon_intensity_g_per_kwh": 400,
  "tasks": [/* Task[] echoed for refresh restoration */],
  "created_at": "<UTC ISO 8601 timestamp>",
  "started_at": null,
  "finished_at": null,
  "total_attempts": 2,
  "completed_attempts": 0,
  "results": [],
  "comparison": {
    "successful_pairs": 0,
    "energy_pairs": 0,
    "latency_pairs": 0,
    "energy_wh": { "baseline": null, "optimized": null, "saved": null, "savings_pct": null },
    "carbon_g": { "baseline": null, "optimized": null, "saved": null, "savings_pct": null },
    "latency_ms": { "baseline": null, "optimized": null, "saved": null, "savings_pct": null }
  },
  "run_error": null
}
```

The full OpenAPI schema defines `Result`, `Comparison`, nullable metrics, and `run_error`. Run states are `queued → running → completed | partial | failed`. Results are ordered by requested task, baseline first. Each result contains the backend-selected model role/ID, route reason, output or attempt error, nullable latency/tokens, and nullable illustrative estimates. A failed result has null output and numeric fields; missing values are displayed as **Unavailable**, never zero.

The backend computes routing and all aggregates. Energy/carbon totals use only complete paired usage; latency totals use only successful pairs. Provide cohort counts. Partial and running comparisons are incomplete; a completed run is not a quality evaluation.

## Error responses and UI behavior

Errors use `{ "error": { "code": "...", "message": "safe readable text", "details": {} } }`.

| HTTP | Contract cases | Frontend behavior |
|---|---|---|
| `404` | `RUN_NOT_FOUND` | URL restore/retry shows the backend message; no fabricated run. |
| `409` | `RUN_ALREADY_ACTIVE`, `details.active_run_id` | Fetch and reopen the existing run when the ID is present; otherwise show the error. |
| `422` | `VALIDATION_ERROR`, `INVALID_DEMO_TASK`, `DUPLICATE_TASK_ID` | Show the safe message; do not change mode or alter the payload silently. |
| `503` | `LIVE_UNAVAILABLE` | Show the backend message; never fall back to Demo. |
| `500` | `INTERNAL_ERROR` | Show the safe message. |
| network/other | No usable envelope or connection | Keep the last run snapshot during polling, offer retry, and do not automatically repeat `POST /runs`. Submission uncertainty is stated to the user. |

Attempt-level provider failures are fields on a successful `GET /runs/{run_id}` snapshot and are rendered next to the corresponding attempt. They are not expected as an HTTP failure from the polling endpoint.

## Contract endpoints not currently consumed

| Endpoint | Contract response | Status |
|---|---|---|
| `GET /health` | `Health`: `{ "status": "ok", "api_version": "1.0.0" }` | Defined in OpenAPI; unused by current UI. API readiness indication is based on successful capabilities and sample-task fetches. |

No other routes (run list, cancellation, auth, provider configuration, or quality scoring) are defined or assumed.

## Proposed endpoint or schema changes

**None.** If implementation reveals a mismatch, coordinate it with Sean first and update OpenAPI, examples, docs, and client together. Do not add frontend-only aliases or response fallbacks that hide a contract mismatch.
