# Frontend/API integration contract

This document maps the frontend to EcoAgent API v1, including the implemented source preview and expanded benchmark routes. The source of truth is [`../contracts/openapi.json`](../contracts/openapi.json). Backend values and responses remain authoritative.

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
| `sourceApi.createText(text)` | `POST /sources/text` | `{"name":"Pasted text","text":"..."}` | `201 {source: SourceSnapshot}` | Explicit Preview source action. |
| `sourceApi.createFile(file)` | `POST /sources/files` | One `file` in multipart/form-data | `201 {source: SourceSnapshot}` | Explicit Parse and preview action for PDF or CSV. Browser sets the multipart boundary. |
| `sourceApi.createWebpage(url)` | `POST /sources/webpage` | `{"url":"https://example.org/page"}` | `201 {source: SourceSnapshot}` | Explicit Fetch and preview action for public HTTP(S) pages. |
| `sourceApi.get(id)` | `GET /sources/{source_id}` | None; UUID path segment | `200 {source: SourceSnapshot}` | Refresh restoration of the exact source preview attached to a run. |
| `sourceApi.remove(id)` | `DELETE /sources/{source_id}` | None; UUID path segment | `204` | Remove an unbound preview; an attached source returns `409 SOURCE_IN_USE`. |

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

To attach a parsed source, include `source_snapshot_id: "<uuid>"` and `confirm_source_submission: true`. Source-backed runs require Live mode. The task prompt remains the user's instruction; the backend appends the same extracted source text to both policies as untrusted data. The frontend requires explicit confirmation before submission. Failed parsing or retrieval creates no snapshot and cannot fall back to fixture content.

### Source parsing, safety, and retention

`SourceSnapshot` contains the full extracted text, SHA-256 of that exact UTF-8 text, source kind/name/media type, character/unit counts, parse duration, and references. PDF references identify pages; CSV references identify data cells; webpage references cover extracted visible text. These references locate source text but are not validated citations for model claims. The model does not currently return answer-grounding citations or an explicit `not_found_in_source` state.

Backend limits: 10 MiB per file; text PDF up to 100 pages; CSV up to 10,000 data rows and 200 columns; 100,000 extracted characters; webpage response up to 5 MiB, 10 seconds and three redirects. CSV must be UTF-8/UTF-8 BOM and comma-delimited. Formula-like CSV cells stay plain text. Encrypted/scanned PDFs, OCR, authenticated pages, scripts and non-HTML/plain-text responses are unsupported. URL retrieval permits public destinations only on HTTP 80 or HTTPS 443; every redirect is revalidated and sockets are pinned to checked IP addresses. Query strings are used to fetch pages but omitted from stored/displayed URL provenance.

Unbound previews expire after 30 minutes. A source attached to a run has no expiry and the exact source text is retained in SQLite with its run; this prototype has no run deletion or source cleanup endpoint. Bound source text remains in that local database until the operator removes the database. Do not submit confidential or regulated data. `GET /sources/{id}` returns the retained snapshot; run responses/export metadata do not duplicate the source text.

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

The full OpenAPI schema defines `Result`, `Comparison`, nullable metrics, and `run_error`. Run states are `queued → running → completed | partial | failed`. Results are ordered by requested task, baseline first. Each result contains the backend-selected model role/ID, route reason, output or attempt error, nullable latency/tokens, provider finish reason and output completeness, and nullable illustrative estimates. A failed result has null output and numeric fields; missing values are displayed as **Unavailable**, never zero. Run snapshots include `source_snapshot` (metadata or null) and `source_submission_confirmed`. A null output-completeness value means the provider did not provide enough information to verify completeness.

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
| `400/413/415/422/502/504` | `SOURCE_*` | Keep input selected, show the safe backend reason, and never infer from failed/partial source content. |
| `409` | `SOURCE_ALREADY_BOUND`, `SOURCE_IN_USE` | Explain that a bound snapshot stays with its run; use a fresh preview to create a new source-backed run. |
| network/other | No usable envelope or connection | Keep the last run snapshot during polling, offer retry, and do not automatically repeat `POST /runs`. Submission uncertainty is stated to the user. |

Attempt-level provider failures are fields on a successful `GET /runs/{run_id}` snapshot and are rendered next to the corresponding attempt. They are not expected as an HTTP failure from the polling endpoint.

## Contract endpoints not currently consumed

| Endpoint | Contract response | Status |
|---|---|---|
| `GET /health` | `Health`: `{ "status": "ok", "api_version": "1.0.0" }` | Defined in OpenAPI; unused by current UI. API readiness indication is based on successful capabilities and sample-task fetches. |

The source-preview routes below are additive. Cancellation, authentication and browser provider-configuration routes remain absent.

## Initial benchmark contract (historical)

The following describes the initial five-route `starter-v1` integration. It is retained as historical context; the current implemented source and benchmark contract appears below and supersedes the original five-route/case/model limits.

| Method and route | Input | Success schema |
|---|---|---|
| GET /api/v1/benchmarks/datasets | None | 200 BenchmarkDatasetsResponse |
| GET /api/v1/benchmarks/runs | limit=20 (1–100), optional cursor | 200 BenchmarkRunsResponse |
| POST /api/v1/benchmarks/runs | StartBenchmarkRequest | 202 StartBenchmarkResponse and Location |
| GET /api/v1/benchmarks/runs/{run_id} | UUID | 200 BenchmarkRun |
| GET /api/v1/benchmarks/runs/{run_id}/cases | UUID; limit=50 (1–100), optional cursor | 200 BenchmarkCasesResponse |

Copyable request:

```json
{"dataset_id":"starter-v1","baseline":{"model_id":"openai/gpt-oss-120b","optimization_enabled":false},"candidate":{"model_id":"eco-auto","optimization_enabled":true},"max_cases":5}
```

Checked-in `contracts/examples/benchmark-*.json` show acknowledgements, catalog, completed/partial runs, cases/history and errors. These examples are simulated and are not Groq performance evidence.

## Accepted execution semantics

- Prefix `/api/v1/benchmarks`; success codes are 200 for GET and 202 for POST with Location. Server run IDs are UUID strings. No frontend-managed authentication for this loopback/local demo; no public Live deployment is authorized.
- Request fields are unchanged. `baseline.optimization_enabled` must be false. Candidate `eco-auto` requires optimization true; explicit candidate model requires false. The configured two Groq model IDs are supported; `eco-auto` is never sent to Groq.
- Only `starter-v1` is executable. The agent/firewall proposal files remain excluded. `max_cases` selects the first N cases in file order, bounded by the dataset, BENCHMARK_MAX_CASES (default 5), and half INFERENCE_MAX_REQUESTS_PER_RUN (default 20 requests).
- The existing request has no mode field. `BENCHMARK_INFERENCE_MODE=simulated` (default) or `groq` is an explicit backend setting, snapshotted as `measurement_source=simulated|observed`. Groq mode additionally requires LIVE_ENABLED and usable configuration. There is no fallback. `observed` denotes the live adapter, including queued or failed live runs; metrics remain null until actually available. No claim of audited cost or measured electricity follows from it.
- Simulated attempts return the dataset's authored expected answer, fixed 60 input/20 output tokens, and 500 ms for the configured small model or 1200 ms for large, after a 150 ms execution delay. All of these are fabricated fixtures. Matching the answer key by construction is not evidence about Groq accuracy.
- `eco-auto` sends classification/extraction/arithmetic to small and summarization/reasoning to large. Fixed routes use `fixed_baseline`/`fixed_candidate`; auto routes use `simple_task_small`/`complex_task_large`. No cache, retry, external judge or tool execution.
- Baseline then candidate execute serially per case. One atomic active slot is shared with `/runs`. A conflict is 409 RUN_ALREADY_ACTIVE with active_run_id and, on benchmark responses, active_run_kind. Case snapshots persist after each attempt. Progress counts cases with both attempts finished, including failures.
- `completed` means all provider attempts finished without provider errors, even if objective checks failed; `partial` means all attempts finished with one or more errors; job-level interruption/internal failure is `failed`. `cancelled` is reserved but never emitted; there is no cancellation endpoint. Restart converts queued/running jobs to failed/RUN_INTERRUPTED, preserving saved sides and metrics. Terminal snapshots never change.
- Case status is `error` if either attempted side has a provider error; otherwise `passed` if both deterministic checks pass, else `failed`. An incomplete case on an interrupted run remains `skipped` with a pending-attempt explanation and nullable sides. Expected JSON objects are serialized as JSON text for the frontend's string field.
- Evaluators: exact_match trims edges and obeys case_sensitive; json_schema_and_values requires the exact authored keys/values and rejects booleans as numeric answers. required_facts accepts the canonical expected answer or all authored literal phrases after case/whitespace normalization. This is a lexical check, not semantic judgment; paraphrases can fail and misleading text can pass. No claim of answer-quality equivalence.
- Per-side `total_cases` counts finished attempts (including attempts blocked by local limits); `total_requests` counts dispatched HTTP attempts (or simulated adapter calls), excluding requests blocked before dispatch by server limits. passed_cases counts successful checks, failed_cases counts incorrect answers, error_count counts attempt failures. pass_rate = passed_cases / total_cases, including errors in the denominator. Metrics are null before any side attempt exists. total_cost_usd/input_tokens/output_tokens/mean_latency_ms are null if any included attempt lacks that metric; no partial sum silently treats missing values as zero. Latency is the arithmetic mean over that side's attempts only when all are available. Cost is a token-based USD estimate from the documented standard Groq rates, not a bill.
- History is newest-first by (created_at, run_id), with opaque keyset cursors; inserting newer runs does not shift older pages. Case pages are ordered by dataset index with cursors scoped to the run. Limits 1–100, defaults 20 history/50 cases. Invalid, wrong-kind or wrong-run cursors return 422. next_cursor=null means the end of the current snapshot; repeat polling to discover later case attempts.
- Existing error envelope is retained. 404 DATASET_NOT_FOUND/RUN_NOT_FOUND; 409 RUN_ALREADY_ACTIVE; 422 VALIDATION_ERROR/UNSUPPORTED_MODEL; 429 RATE_LIMITED for submission admission; 503 PROVIDER_UNAVAILABLE when live is not configured; safe 500 INTERNAL_ERROR. Malformed UUID paths are 422. Provider timeouts/rate limits/auth/bad responses appear in stored case errors while GET remains 200, not HTTP 504/503 polling failures.
- Default server limits: 10 accepted benchmark runs/minute; 20 inference attempts/run; 60 provider requests/minute; $0.50/run and $1.00/UTC day; overall HTTP deadline 30 seconds. Limits are configurable server-side only. Admission and budget state persist across restart.
- Before every live request the server reserves the price of 131072 input tokens plus 256 output tokens, a conservative full-context bound. Known usage reconciles this to estimated actual cost; absent usage, failed calls and process crashes retain the reservation. This is a spending guard, not fabricated token telemetry. It can conservatively block calls before the nominal dollar limit is consumed. Budget reservations also cover original comparison Live calls. Provider billing remains authoritative, and changing rates/configuration requires reviewing these bounds.

## Frontend coordination notes

No wire-schema change is required. `VITE_USE_FRONTEND_MOCK=false` (the existing default) selects real backend transport; BENCHMARK_INFERENCE_MODE selects the server adapter independently. The current UI does not expose server mode before the first run (it says SOURCE PENDING), but each returned snapshot prominently shows SIMULATED/OBSERVED. History/case Load more controls already exist in the actual code despite older integration notes.

The active-run navigation limitation noted during initial integration has since been fixed: both run types return `active_run_kind` and the frontend opens the identified run without resubmission.

## Current implemented source and benchmark contract

All routes are under `/api/v1`; the generated, machine-readable source of truth is [`../contracts/openapi.json`](../contracts/openapi.json).

### Source import and preview

| Route | Request | Response |
|---|---|---|
| `POST /sources/text` | `{"name":"Pasted text","text":"..."}` | `201 {"source": SourceSnapshot}` |
| `POST /sources/files` | One multipart `file` (PDF or CSV) | `201 {"source": SourceSnapshot}` |
| `POST /sources/webpage` | `{"url":"https://example.org/page"}` | `201 {"source": SourceSnapshot}` |
| `GET /sources/{source_id}` | UUID | `200 {"source": SourceSnapshot}` |
| `DELETE /sources/{source_id}` | UUID | `204`; `409 SOURCE_IN_USE` if bound to a run |

`SourceSnapshot` includes the complete extracted text, its SHA-256, source kind/name/media type, URLs and retrieval timestamp when applicable, parse duration, character/unit counts, expiry and input references. References point to PDF pages, CSV data cells, or webpage-text offsets. They do not validate generated answer claims. The inference model does not currently return validated citations or a `not_found_in_source` result.

Limits are 10 MiB per file; 100 PDF pages; 10,000 CSV data rows; 200 columns; 100,000 extracted characters; webpage responses up to 5 MiB and 10 seconds; and at most three redirects. CSV must be UTF-8/UTF-8 BOM and comma-delimited; cells, including formulas, remain text. Scanned/encrypted PDFs and OCR are unsupported. Webpage retrieval accepts public HTTP port 80 or HTTPS port 443, checks all resolved addresses and redirects, pins the socket to a checked public IP, and permits HTML/plain text only. URL query strings are used for retrieval but omitted from stored/displayed provenance.

Unbound previews expire after 30 minutes. `POST /runs` can include `source_snapshot_id` with `confirm_source_submission:true`; attached sources are Live-only. The same source text is appended to both policies as untrusted content, and the run stores source metadata plus a confirmation flag. The exact text is retained in SQLite with a bound run and has no cleanup endpoint in this prototype. Avoid confidential/regulated data. Source text is not duplicated in the run response/export; retrieve it via `GET /sources/{id}`.

### Expanded benchmark catalog and full JSON export

Current routes include `GET /benchmarks/datasets`, `GET /benchmarks/datasets/{dataset_id}`, history/start/run/case routes, and `GET /benchmarks/runs/{run_id}/export`. The export includes the complete authored dataset, exact inputs/expected values/evaluator definitions, persisted outputs/outcomes, run provenance and model pricing assumptions. `data_completeness` is `partial` when a run covers only a bounded dataset subset or has not finished persisting every selected case.

`starter-v1` remains the five-case baseline. `starter-v2` has 24 synthetic cases across classification, arithmetic, extraction, summarization, reasoning, formatting and fact retrieval. `max_cases_per_run` is returned by the dataset catalog and defaults to 10 under the existing maximum of 20 paired inference requests. No request/spending guard is raised to fit the full dataset; use explicit bounded runs for additional cases.

The model catalog includes configured GPT-OSS small/large models and the priced `qwen/qwen3.8-27b` Groq Preview option. The UI marks Qwen as Preview; provider account availability is not probed. See the [Groq supported-model page](https://console.groq.com/docs/models) for published model status/rates. `eco-auto` is a routing policy, not a provider model ID.

Benchmark evaluators are deterministic authored checks (exact match, exact JSON values/keys, or literal required facts), not semantic quality judges. Truncated outputs, and outputs with unknown completion status, are marked `incomplete` and excluded from the evaluated-case pass-rate denominator. Metrics distinguish total/evaluated/passed/failed/incomplete/error counts. Simulated answers and timings are fixtures, not evidence of model quality. Estimated token costs are not provider billing.

Comparison and benchmark duplicate-run responses include `active_run_id` and `active_run_kind`, so the frontend routes to the existing run without repeating a submission.
