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

## Proposed benchmark API (not yet agreed or implemented)

The current OpenAPI v1 contract contains no benchmark endpoints. The frontend attachment requested paths under `/api/benchmarks`, while the existing API client and shared spec use `/api/v1`. To preserve the existing versioning convention, this frontend proposal uses `/api/v1/benchmarks/...` (client suffixes shown below). **Sean must confirm or revise the prefix, schemas, statuses, pagination, and auth behavior before backend implementation.** These are not live routes today.

| Method and proposed route | Request | Response | UI consumer |
|---|---|---|---|
| `GET /api/v1/benchmarks/datasets` | None | `BenchmarkDatasetsResponse` | Dataset selector and supported model choices. |
| `GET /api/v1/benchmarks/runs?limit=20&cursor=...` | Optional `limit` (1–100, default 20) and opaque cursor | `BenchmarkRunsResponse` | Previous-run list and pagination. |
| `POST /api/v1/benchmarks/runs` | `StartBenchmarkRequest` below | `202 StartBenchmarkResponse`, plus `Location: /api/v1/benchmarks/runs/{run_id}` | Run button; disables duplicate submission while request is pending. |
| `GET /api/v1/benchmarks/runs/{run_id}` | None | `BenchmarkRun` snapshot | Progress poll, reopening selected history item. |
| `GET /api/v1/benchmarks/runs/{run_id}/cases?limit=50&cursor=...` | Optional `limit` (1–100, default 50) and opaque cursor | `BenchmarkCasesResponse` | Individual outcomes with pagination. |

### Dataset catalog

Proposed `BenchmarkDatasetsResponse`:

```json
{
  "datasets": [{
    "dataset_id": "starter-v1",
    "name": "EcoAgent Starter",
    "version": "1.0.0",
    "description": "Objective-check synthetic workload.",
    "case_count": 5,
    "categories": ["classification", "arithmetic"],
    "supported_models": ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
    "provenance": "synthetic"
  }]
}
```

`supported_models` comes from backend configuration. `eco-auto` is a frontend policy identifier and must not be interpreted as a Groq model. Proposed provenance values are `curated` and `synthetic`; confirm allowed values with the backend owner.

### Start request and acknowledgement

The attachment's request is retained, with JSON field names typed as follows:

```json
{
  "dataset_id": "starter-v1",
  "baseline": { "model_id": "openai/gpt-oss-120b", "optimization_enabled": false },
  "candidate": { "model_id": "eco-auto", "optimization_enabled": true },
  "max_cases": 5
}
```

Proposed validation: `dataset_id` must exist; each model must be supported by the selected dataset except the agreed `eco-auto` policy ID; baseline must keep optimization disabled; `max_cases` must be 1 through `min(dataset.case_count, backend_limit)`. The backend must enforce workload and budget limits. The browser sends this request only to EcoAgent; Groq credentials and provider requests stay on the backend.

```json
{ "run_id": "bench_001", "status": "queued" }
```

### Run snapshot and metrics

`GET /benchmarks/runs/{run_id}` returns the same `BenchmarkRun` shape while queued/running and after terminal state; metrics may be null until available. Proposed statuses: `queued`, `running`, `completed`, `partial`, `failed`, `cancelled`. The attachment names queued/running/completed/failed and makes cancellation conditional; partial is included to represent mixed case outcomes. Confirm status set and cancellation semantics with Sean.

```json
{
  "run_id": "bench_001",
  "status": "completed",
  "dataset_id": "starter-v1",
  "progress": { "completed": 5, "total": 5 },
  "baseline": { "model_id": "openai/gpt-oss-120b", "optimization_enabled": false },
  "candidate": { "model_id": "eco-auto", "optimization_enabled": true },
  "max_cases": 5,
  "measurement_source": "observed",
  "evaluation_method": "exact_match_or_deterministic_check",
  "baseline_metrics": {
    "total_cases": 5, "passed_cases": 4, "pass_rate": 0.8, "failed_cases": 1,
    "total_cost_usd": 0.015, "mean_latency_ms": 1250,
    "input_tokens": 3000, "output_tokens": 900, "total_requests": 5, "error_count": 0
  },
  "candidate_metrics": {
    "total_cases": 5, "passed_cases": 4, "pass_rate": 0.8, "failed_cases": 1,
    "total_cost_usd": 0.008, "mean_latency_ms": 820,
    "input_tokens": 2900, "output_tokens": 850, "total_requests": 5, "error_count": 0
  },
  "created_at": "2026-10-24T12:00:00Z",
  "started_at": "2026-10-24T12:00:01Z",
  "finished_at": "2026-10-24T12:00:15Z",
  "error": null
}
```

This sample is **illustrative fixture data only**, not performance evidence. `measurement_source` is proposed as `simulated` or `observed`; observed means provider usage and client timing were returned, not independently audited billing or power measurements. Metric definitions/units: costs in USD estimates, latency in milliseconds (proposed arithmetic mean), token counts as integer totals, pass rate as a fraction 0–1, request and error counts as integers. Every metric field is nullable; UI shows null as **Unavailable**. Confirm metric inclusion and denominators with Sean. No routing/duplicate-call/cache/tool-block counts are included until backend support is agreed.

### Individual case results

`GET /benchmarks/runs/{run_id}/cases` returns a cursor page:

```json
{
  "items": [{
    "case_id": "classify-support-001",
    "category": "classification",
    "status": "passed",
    "evaluation_method": "exact_match",
    "expected": "billing",
    "baseline": {
      "model_id": "openai/gpt-oss-120b", "routing_reason": "fixed_baseline", "output": "billing", "latency_ms": 1120,
      "input_tokens": 55, "output_tokens": 2, "cost_usd": 0.001, "error": null
    },
    "candidate": {
      "model_id": "openai/gpt-oss-20b", "routing_reason": "simple_task_small", "output": "billing", "latency_ms": 510,
      "input_tokens": 55, "output_tokens": 2, "cost_usd": 0.0004, "error": null
    },
    "evaluation_details": "Exact label match."
  }],
  "next_cursor": null
}
```

Proposed case states are `passed`, `failed`, `skipped`, and `error`. Each side and each metric may be null; failed provider errors must be sanitized. Each side includes a nullable `routing_reason` so an `eco-auto` decision can be inspected per case. Outputs are rendered as plain text. The UI must not run an LLM judge or infer quality beyond the backend's declared objective evaluator.

### Benchmark errors and open coordination points

Proposal: use the existing `{ "error": { "code", "message", "details" } }` envelope for `404 DATASET_NOT_FOUND`/`RUN_NOT_FOUND`, `409 RUN_ALREADY_ACTIVE`, `422 VALIDATION_ERROR`/`UNSUPPORTED_MODEL`, `429 RATE_LIMITED`, `503 PROVIDER_UNAVAILABLE`, `504 PROVIDER_TIMEOUT`, and sanitized `500 INTERNAL_ERROR`. Keep prior results visible on polling errors, allow a user-driven retry, never automatically repeat `POST`, and never fall back from API mode to fixtures. Status and exact codes need Sean's agreement. Auth is not defined; proposal assumes no frontend-managed auth in the local hackathon environment and same-origin backend deployment. Confirm whether the API is private, requires auth, or uses a different session mechanism before customer use.

Coordination checklist: versioned or unversioned route prefix; schemas above; model catalog and `eco-auto` semantics; status/cancel semantics; error envelope/codes; `limit` and opaque cursor pagination; authentication; dataset JSON format and evaluator rules; cost/latency definitions and nullability; provenance; backend-enforced per-run and budget limits. No benchmark route has been added to the shared OpenAPI spec yet.

## Proposed endpoint or schema changes

**None.** If implementation reveals a mismatch, coordinate it with Sean first and update OpenAPI, examples, docs, and client together. Do not add frontend-only aliases or response fallbacks that hide a contract mismatch.
