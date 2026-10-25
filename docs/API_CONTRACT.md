# Frontend/API integration contract

This document maps the frontend to EcoAgent API v1.1, including source preview, benchmark, task-quality and bounded fallback fields. The source of truth is [`../contracts/openapi.json`](../contracts/openapi.json). Backend values and responses remain authoritative.

## Connection configuration

The browser client is centralized in [`../frontend/src/api/client.ts`](../frontend/src/api/client.ts). It uses `VITE_API_BASE_URL`, defaulting to `/api/v1`. The recommended value is a same-origin path ending in `/api/v1`; browser requests remain relative and avoid CORS. During development, Vite proxies `/api` to `VITE_API_PROXY_TARGET`, defaulting to `http://localhost:8000`. See [`../frontend/.env.example`](../frontend/.env.example).

An absolute `VITE_API_BASE_URL` is technically accepted by `fetch`, but cross-origin use requires backend CORS configuration and is not the documented deployment path. Do not put provider keys or other secrets in any `VITE_` variable; Vite exposes these values to browser code.

Set `VITE_USE_FRONTEND_MOCK=true` only for the explicit fixture preview. The default is false. Mock mode uses checked-in static examples, not a backend, and supports only the complete three-task sample run.

The provider setup dialog is a local-development convenience. The key exists briefly in the password input/browser request and backend request memory, then is written only into root `.env`; the UI does not save it to browser storage, a URL, or the frontend build, and the API never returns it. Same-origin/loopback checks are not authentication; do not expose this endpoint through a public deployment. Saving requires a backend restart because settings load at process startup. A provider key set in the backend process environment overrides `.env`; the dialog refuses to write that provider key when an override is present. Saving does not enable `LIVE_ENABLED`, validate provider access, or authorize charges. Use a managed secret store in deployments.

The model catalog supports Groq, OpenAI, Google Gemini, Anthropic Claude, and **local** Ollama. Hosted keys are saved with `PUT /local-settings/provider-keys/{provider}`, where provider is `groq`, `openai`, `gemini`, or `anthropic`; request body is `{"api_key":"…"}` and the response contains only provider status booleans. Ollama has no key field: it calls the loopback server configured by `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434/v1`) and cannot be pointed at a remote host. Model IDs use the `provider::model-id` form, while legacy Groq IDs remain accepted. `GET /capabilities` returns `supported_models`; Live `POST /runs` may include distinct `small_model_id` and `large_model_id` values from that list. These assign provider models to backend-selected logical roles; the browser does not choose per-task routes. Benchmark model selection uses the same catalog. Set `BENCHMARK_INFERENCE_MODE=live` to send paired requests to the selected providers; `groq` remains a legacy live-mode alias, and `simulated` uses fixtures. Provider keys and Live enablement are checked by the backend before a run is accepted. Provider token prices are estimates and guarded by configured spend limits. Ollama's provider API fee is $0; its electricity and total local cost are **not measured or included**.

Catalog entries currently selectable for agent roles are: Groq `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, and `qwen/qwen3.8-27b`; OpenAI `gpt-6-luna` and `gpt-6.1-sol`; Gemini `gemini-3.8-flash`; Anthropic `claude-haiku-5-5` and `claude-sonnet-5-5`; local Ollama `qwen3:8b` and `gpt-oss:20b`. Provider access is account/region dependent and is not probed when assigning models. The backend catalog's per-million-token rates are snapshots and may change; the estimation code uses the catalog rate, and spend limits can conservatively block a call. The agent provider catalog is separate from the existing comparison and benchmark model settings.

## Endpoints consumed by the frontend

All routes below are relative to `/api/v1`. JSON uses snake_case. `GET /health` is in the shared contract but is **not currently called by the frontend**. The local workspace-agent routes are consumed by `AgentDashboard` and defined in the “Workspace agent API” section below.

| Frontend API method | HTTP method and path | Request body | Success response | Frontend consumers |
|---|---|---|---|---|
| `api.capabilities()` | `GET /capabilities` | None | `Capabilities` (schema below) | `App` startup: modes, safe Live disabled reason, task/prompt limits, policy label, default carbon scenario and energy coefficients in assumptions disclosure. |
| `api.sampleTasks()` | `GET /sample-tasks` | None | `SampleTasks` | `App` startup and Demo checkboxes. The request payload uses the exact selected task objects returned here. |
| `api.localProviderSettings()` | `GET /local-settings/provider` | None; loopback caller and local Host required; if the browser sends `Origin`, it must match | `LocalProviderSettings` booleans only | Provider setup dialog: reports whether a key is configured, saved in root `.env`, and whether restart is required. This read-only route returns no key material. |
| `api.saveLocalProviderKey(key)` | `PUT /local-settings/provider-key` | `{"api_key":"…"}`; password field, 1–512 characters | `LocalProviderSettings` booleans only | Provider setup dialog: sends a key to the same-computer backend, which atomically writes `GROQ_API_KEY` to ignored root `.env`. Requires loopback and matching same-origin `Origin`; not a public-deployment credential manager. |
| `api.saveProviderKey(provider,key)` | `PUT /local-settings/provider-keys/{provider}` | `{"api_key":"…"}`; provider is groq/openai/gemini/anthropic | `LocalProviderSettings`, including key-free status by provider | Provider setup dialog: atomically saves a selected hosted-provider key in ignored root `.env`. Loopback and matching same-origin `Origin` required. Ollama is local and has no key-save operation. |
| `api.agentModelSettings()` | `GET /local-settings/agent-models` | None; loopback caller and local Host required; if the browser sends `Origin`, it must match | `AgentRoleModelSettings`: available model IDs/options, active/saved role assignments, restart and environment-override flags | Provider setup dialog: shows Manager/Writer/Coder/Reviewer model assignments. Returns model identifiers and labels only, never credentials. |
| `api.saveAgentModelSettings(assignments)` | `PUT /local-settings/agent-models` | `AgentRoleModelAssignments`: exact `manager`, `writer`, `coder`, `reviewer` provider-qualified model IDs | `AgentRoleModelSettings` | Provider setup dialog: validates IDs against backend catalog and atomically writes `ECOAGENT_AGENT_MODEL_*` assignments to ignored root `.env`. Requires loopback and matching same-origin `Origin`; environment overrides are rejected. Restart activates saved assignments. |
| `api.createRun(payload)` | `POST /runs` | `CreateRun` (schema below), including optional Live-only `quality_fallback`, `small_model_id`, and `large_model_id` | `202 Run`; `Location: /api/v1/runs/{id}` | Compare submission; Live model selectors assign provider models to logical routing roles. The backend still determines each task's route. |
| `api.getRun(id)` | `GET /runs/{run_id}` | None; `{run_id}` is a server-generated UUID path segment | `200 Run` | Initial `?run=<uuid>` restoration, polling, manual retry, and reopening an active run after a `409`. |
| `api.activeRun()` | `GET /active-run` | None | `200 ActiveRunInfo` or `null` | Safe recovery when a conflict response omits active run metadata; identifies the active comparison, benchmark, or agent without repeating submission. |
| `api.stopActiveRun(id?)` | `POST /active-run/stop` | Optional `{"run_id":"<uuid>"}`; when provided, ID must match the currently active run | `200 ActiveRunInfo` | Stop controls for active comparisons/benchmarks and recovery from conflicts. Without an ID, the backend stops whichever run is active when the request is handled; with an ID, a changed/completed run is never stopped by a stale ID. |
| `sourceApi.createText(text)` | `POST /sources/text` | `{"name":"Pasted text","text":"..."}` | `201 {source: SourceSnapshot}` | Explicit Preview source action. |
| `sourceApi.createFile(file)` | `POST /sources/files` | One `file` in multipart/form-data | `201 {source: SourceSnapshot}` | Explicit Parse and preview action for PDF or CSV. Browser sets the multipart boundary. |
| `sourceApi.createWebpage(url)` | `POST /sources/webpage` | `{"url":"https://example.org/page"}` | `201 {source: SourceSnapshot}` | Explicit Fetch and preview action for public HTTP(S) pages. |
| `sourceApi.get(id)` | `GET /sources/{source_id}` | None; UUID path segment | `200 {source: SourceSnapshot}` | Refresh restoration of the exact source preview attached to a run. |
| `sourceApi.remove(id)` | `DELETE /sources/{source_id}` | None; UUID path segment | `204` | Remove an unbound preview; an attached source returns `409 SOURCE_IN_USE`. |
| `agentApi.capabilities()` | `GET /agent/capabilities` | None | `200 AgentCapabilities` | Agent page: safe local availability and explicit operation limits. |
| `agentApi.start(payload)` | `POST /agent-runs` | `AgentStartRequest`; includes literal `confirm_provider_submission: true` | `202 AgentRun`; Location | Agent page: submits one local task; conflicts route to active agent run. |
| `agentApi.startWorkflow(payload)` | `POST /agent-workflows` | `AgentWorkflowStartRequest`; includes literal `confirm_provider_submission: true` | `202 AgentRun`; Location | Agent page: requests a bounded manager plan and specialist workflow. |
| `agentApi.get(id)` | `GET /agent-runs/{run_id}` | None | `200 AgentRun` | Refresh restoration and polling while planning. |
| `agentApi.events(id,cursor,limit)` | `GET /agent-runs/{run_id}/events` | Query `cursor` and `limit` | `200 AgentEventsResponse` | Human-readable action history. |
| `agentApi.approvePlan(id,hash,approved)` | `POST /agent-runs/{run_id}/plan-approvals` | `{plan_hash, approved}` | `200 AgentRun` | Approve or decline the exact manager plan hash before specialist work. |
| `agentApi.approve(id,action)` | `POST /agent-runs/{run_id}/approvals` | `{action_id,action_hash,approved}` | `200 AgentRun` | Approve/deny exactly one pending file operation. |
| `agentApi.continue(id)` | `POST /agent-runs/{run_id}/continue` | Empty | `200 AgentRun` | Explicitly request one further planning call. |
| `agentApi.stop(id)` | `POST /agent-runs/{run_id}/stop` | Empty | `200 AgentRun` | Stop an active/paused local task. |

The client currently uses the `Run.id` body field to navigate/poll; it does not read the `Location` header. The backend should still return the contractually required header.

## Request and response shapes

These TypeScript definitions are in [`../frontend/src/api/types.ts`](../frontend/src/api/types.ts) and mirror the OpenAPI v1.1 schema. Backend values remain authoritative.

### `Task`

```json
{
  "id": "classify-1",
  "type": "classify",
  "prompt": "Classify this support message...",
  "constraints": { "allowed_labels": ["billing", "technical", "general"], "required_json_fields": null }
}
```

`id` matches `^[A-Za-z0-9_-]{1,64}$`; `type` is `classify`, `extract`, `summarize`, `write`, or `code`; `prompt` is trimmed nonempty text up to the configured 2000-character limit. Optional `constraints.allowed_labels` enables exact-label validation for classification; `constraints.required_json_fields` enables JSON-object and required-key validation for extraction.

### `CreateRun`

```json
{
  "mode": "demo",
  "tasks": [{ "id": "classify-1", "type": "classify", "prompt": "..." }],
  "carbon_intensity_g_per_kwh": 400,
  "quality_fallback": false
}
```

`mode` is `demo` or `live`; there must be 1–10 unique tasks; scenario carbon intensity is 0–2000 gCO2e/kWh. Demo tasks must exactly match a nonempty subset of `demo/tasks.json`. Live prompts can be edited only when `Capabilities.live_enabled` is true. Omit model overrides to use backend defaults. Unknown request fields are rejected by the contract.

`small_model_id` and `large_model_id` are optional Live-only overrides selected from `Capabilities.supported_models`. They are stored in the Run response, validated against the backend's priced catalog and provider readiness, and map to the backend's small/large logical roles. The router continues to choose which role a task uses. `quality_fallback` defaults false. When enabled in Live mode, one optimized classify/extract request may escalate to the large model after deterministic validation fails. Provider errors and truncation do not retry. The fallback adds a provider call and is counted by request/spending safeguards; its outputs and nullable metrics are returned for review. A run uses `task-routing-v2-fallback`; otherwise it uses `task-routing-v1`.

Live provider selection example (only send after enabling Live and configuring both selected providers):

```json
{"mode":"live","tasks":[{"id":"classify-1","type":"classify","prompt":"Classify this request"}],"small_model_id":"openai::gpt-6-luna","large_model_id":"anthropic::claude-haiku-5-5"}
```

To attach a parsed source, include `source_snapshot_id: "<uuid>"` and `confirm_source_submission: true`. Source-backed runs require Live mode. The task prompt remains the user's instruction; the backend appends the same extracted source text to both policies as untrusted data. The frontend requires explicit confirmation before submission. Failed parsing or retrieval creates no snapshot and cannot fall back to fixture content.

### Source parsing, safety, and retention

`SourceSnapshot` contains the full extracted text, SHA-256 of that exact UTF-8 text, source kind/name/media type, character/unit counts, parse duration, and references. PDF references identify pages; CSV references identify data cells; webpage references cover extracted visible text. These references locate source text but are not validated citations for model claims. The model does not currently return answer-grounding citations or an explicit `not_found_in_source` state.

Backend limits: 10 MiB per file; text PDF up to 100 pages; CSV up to 10,000 data rows and 200 columns; 100,000 extracted characters; webpage response up to 5 MiB, 10 seconds and three redirects. CSV must be UTF-8/UTF-8 BOM and comma-delimited. Formula-like CSV cells stay plain text. Encrypted/scanned PDFs, OCR, authenticated pages, scripts and non-HTML/plain-text responses are unsupported. URL retrieval permits public destinations only on HTTP 80 or HTTPS 443; every redirect is revalidated and sockets are pinned to checked IP addresses. Query strings are used to fetch pages but omitted from stored/displayed URL provenance.

Unbound previews expire after 30 minutes. A source attached to a run has no expiry and the exact source text is retained in SQLite with its run; this prototype has no run deletion or source cleanup endpoint. Bound source text remains in that local database until the operator removes the database. Do not submit confidential or regulated data. `GET /sources/{id}` returns the retained snapshot; run responses/export metadata do not duplicate the source text.

### `Capabilities`

```json
{
  "api_version": "1.1.0",
  "demo_enabled": true,
  "live_enabled": false,
  "live_disabled_reason": "Live inference is not configured. Use Demo mode.",
  "max_tasks": 10,
  "max_prompt_chars": 2000,
  "policy_version": "task-routing-v1",
  "task_profile_version": "task-instructions-v1",
  "supported_task_types": ["classify", "extract", "summarize", "write", "code"],
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
  "task_profile_version": "task-instructions-v1",
  "quality_fallback": false,
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

The full OpenAPI schema defines `Result`, `Comparison`, nullable metrics, and `run_error`. Run states are `queued → running → completed | partial | failed | cancelled`. Results are ordered by requested task, baseline first. Each result contains the backend-selected model role/ID, route reason, output or attempt error, nullable latency/tokens, Ollama-reported generation speed when available, provider finish reason, output completeness, deterministic validation status, nullable illustrative estimates, and optional local NVIDIA device-window telemetry. GPU device, utilization, average power and integrated energy describe the whole GPU during the call window; they are not attributed to a process or user. A failed result has null output and numeric fields; missing values are displayed as **Unavailable**, never zero. Run snapshots include `source_snapshot` (metadata or null) and `source_submission_confirmed`.

Live runs use server-owned `task-instructions-v1` profiles; validation checks format and explicitly supplied constraints, not semantic truth. `quality_fallback` is an explicit Live-only opt-in. One optimized classify/extract response can escalate once after deterministic validation failure. Provider errors and truncation are not retried. When escalation runs, both attempt outputs/errors and nullable usage/cost/estimates are returned. `total_attempts` counts actual provider calls and can increase when escalation starts; `completed_attempts` counts provider calls, while `results` still has one row per task/policy. Code generation is returned as text and is not executed.

The backend computes routing and all aggregates. Token-coefficient energy/carbon totals use only complete paired usage; latency totals use only successful pairs. The separate measured-GPU-energy metric is available only for local Ollama requests on NVIDIA systems where `nvidia-smi` can provide readings. Before each local comparison call, the backend samples whole-device power/utilization for `GPU_IDLE_BASELINE_SECONDS` (default 3 seconds, configurable from 0 to 10), then measures the call window. Result fields include pre-call baseline power/utilization/sample count/duration and call-window power/utilization/energy; `gpu_power_delta_w` is call average power minus pre-call average power. The baseline sample is not guaranteed to be idle: unrelated GPU work may already be running. The baseline wait is excluded from provider latency but included in total task time. These are whole-device readings, include unrelated GPU activity, and exclude CPU/system power. The paired summary requires readings for both attempts in a pair; individual local-call readings remain available when only one side uses Ollama. Cloud-provider electricity is not available to EcoAgent; carbon intensity remains a user-selected scenario. Provide cohort counts. Partial and running comparisons are incomplete; a completed run is not a quality evaluation.

## Error responses and UI behavior

Errors use `{ "error": { "code": "...", "message": "safe readable text", "details": {} } }`.

| HTTP | Contract cases | Frontend behavior |
|---|---|---|
| `404` | `RUN_NOT_FOUND` | URL restore/retry shows the backend message; no fabricated run. |
| `409` | `RUN_ALREADY_ACTIVE`, optionally `details.active_run_id` and `details.active_run_kind` | Fetch `/active-run` if metadata is missing, reopen the identified run without resubmission, and offer a guarded Stop action. |
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
| `GET /health` | `Health`: `{ "status": "ok", "api_version": "1.1.0" }` | Defined in OpenAPI; unused by current UI. API readiness indication is based on successful capabilities and sample-task fetches. |

The source-preview routes below are additive. `GET /active-run` identifies the globally active run. `POST /active-run/stop` may accept `{"run_id":"<uuid>"}` to require an exact active-run match, or `{}` to stop whichever run is active when handled. It returns the stopped run's ID, kind, and status. Comparison and benchmark cancellation preserve already completed attempts. Local provider/model setup is loopback-only and must not be exposed publicly.

## Workspace agent API (local opt-in)

These routes are served by the same API but are strictly limited to a loopback Host and direct loopback client. Configure backend-only `AGENT_ENABLED=true` and `AGENT_WORKSPACE_ROOT`; Live inference must also be configured. The browser requires explicit provider-submission confirmation at start. Never expose these unauthenticated routes publicly. `GET /agent/capabilities` reports only the workspace's display name and safe disabled reason, never the root path. It also advertises the manager workflow task, call, runtime, and token limits.

`AgentStartRequest` requires `task_type: write|code`, `instruction` (1–5000 chars), `confirm_provider_submission: true`, one or more exact relative `read_paths`/`write_paths` (up to 20 each), and `max_steps` (1–20, default 8; effective max is also bounded by `INFERENCE_MAX_REQUESTS_PER_RUN`). Optional `completion_checks` (up to 10) support `file_exists`, `file_changed`, `contains_text`, and `valid_json`, and must target exact permitted write paths. Literal checks require user-provided text up to 500 characters. It returns `202 AgentRun` and Location.

`POST /agent-workflows` accepts `AgentWorkflowStartRequest`: `instruction` (1–5000 chars), `confirm_provider_submission: true`, exact workspace-relative read/write path arrays (up to 20 each, with at least one output path), `max_steps` (4–20 shared across manager and specialists), `max_tasks` (1–8), `max_task_calls` (1–8 per role/task), `max_runtime_seconds` (60–7200, including time awaiting human approval), and optional completion checks targeting only allowed outputs. It returns `202 AgentRun` with a Location header. Before any specialist action, the manager returns a plan with named Writer, Coder, or Reviewer roles, explicit dependencies, task scopes, and success criteria. Every task receives one or more operator-approved exact paths; writing tasks cannot claim the same resolved output path. The backend canonicalizes paths using host filesystem rules, so case aliases on Windows are treated as the same file. Reviewers are read-only. `POST /agent-runs/{id}/plan-approvals` accepts `{"plan_hash":"<sha256>","approved":true}` and only approves that exact plan version; stale hashes fail with 409. Declining cancels the workflow.

This prototype runs one manager/specialist call at a time and has no independent worker processes or parallel execution. Provider Settings assigns Manager, Writer, Coder, and Reviewer prompts to separate model IDs from the backend catalog. Supported providers are Groq, OpenAI, Gemini, Anthropic Claude, and local Ollama. Hosted keys are separate and stored server-side in ignored root `.env`; Ollama is local-only. Model IDs are saved as `ECOAGENT_AGENT_MODEL_MANAGER`, `..._WRITER`, `..._CODER`, and `..._REVIEWER`; restart the backend to activate changes. Process environment overrides cannot be changed from the UI. Provider access is not probed before use. Each run snapshots its role assignments; task and event responses record the selected model ID, and usage-based cost estimates use that model's configured price. Ollama's token fee is zero, but local electricity and total cost are not estimated. There is no Researcher role because no approved research tool exists. The manager's final semantic review uses the Manager model and is not independent proof of correctness; only configured deterministic file/format checks are independent checks, and these do not prove semantic correctness. Every read and write still requires approval for its exact action hash. The worker cannot execute generated code.

The backend enforces a provider-call limit per workflow and task, runtime deadline, per-workflow and per-task token ceilings (`AGENT_MAX_TOKENS_PER_RUN`, default 48,000; `AGENT_MAX_TOKENS_PER_TASK`, default 12,000), per-run and per-agent estimated-spend ceilings (`INFERENCE_MAX_RUN_COST_USD`, default $0.50; `AGENT_MAX_TASK_COST_USD`, default $0.25), provider request-rate limits, and a daily spend ceiling. The Live adapter caps each response's `max_completion_tokens` to the remaining token allowance. A successful response without output usage retains its requested output-token cap as reserved; provider-reported usage replaces that reservation. A provider error has no usage response, so token usage remains unavailable and its output-token hold is released for an explicit call-bounded retry; the backend keeps its conservative spend reservation. Input token usage is counted when the provider reports it. Reported usage and estimated costs are not provider invoices; agent carbon is `null`/Unavailable.

`AgentCapabilities` advertises the effective call limit, token ceilings, maximum task count/runtime and only `read_file` and `write_file`; each operation requires its own approval tied to an action UUID and hash. Stale approvals fail with 409. `GET /agent-runs/{id}` returns status, task/role state, pending action, deadline, budgets, checkpoint sequence/time, handoff and optional deterministic completion-check outcomes. `GET /agent-runs/{id}/events?cursor=0&limit=50` returns the event page and next cursor. `POST /agent-runs/{id}/approvals` accepts `{"action_id":"<uuid>","action_hash":"<sha256>","approved":true}`. `POST /agent-runs/{id}/continue` explicitly requests one more manager or specialist call; `POST /stop` cancels the local run. Start conflicts return 409 with `active_run_id` and `active_run_kind`; the Workspace Agent UI reopens an active agent run from that response so the user can reach its Continue and Stop controls.

Configured completion checks inspect bounded UTF-8 file state only; they do not evaluate semantic correctness or run code. Passing every check yields `verification_status=verified`. Failed/unverifiable checks keep the run paused for review (`COMPLETION_CHECKS_FAILED`). With no checks, completion is explicitly `not_requested` and not independently verified. Exhausting the configured call limit before finish is a failed run (`STEP_LIMIT_REACHED`). Action fingerprints include observed file state, so unchanged repeats are blocked while changed-file rereads are allowed; no-op writes pause with `NO_PROGRESS_LOOP`. A provider or structured-response failure pauses for explicit review; three consecutive identical failures stop the run as `REPEATED_PROVIDER_FAILURE`. Checkpoints are durable snapshots; restart pauses and requires explicit continuation, never automatic replay.

There is no shell, network, delete, file execution, git, deployment, or permission-change tool. Path scope is exact; path traversal, sensitive credential/config paths, symlink escapes, duplicate operations, oversized/non-UTF-8 files, and detected credential-like text are rejected. Credential-like text detected in agent instructions, paths, completion checks, generated output, or event labels is rejected/redacted; filters are defense-in-depth and cannot recognize every secret format. The backend caps each file at 50,000 characters and model planning calls at 20, additionally bounded by `INFERENCE_MAX_REQUESTS_PER_RUN`. Each proposed read or write pauses for human approval, and a run never auto-continues after a tool action. Approved file content may be sent to the configured provider after the operator explicitly continues. Code is generated as text and never run. Active runs are paused at server restart. Three consecutive failures with the same provider/structured-response fingerprint stop the run; each retry requires an explicit Continue, retry counts are retained in the run and handoff, and total calls remain bounded by the workflow/task call limits. Failures with different fingerprints are still bounded by those call limits. Team and single-agent runs both retain a durable handoff. Team handoffs retain sanitized task-intent summaries, per-task permitted read/write paths, role/model assignments, criteria, outcome summaries, retry and reported usage figures; single-agent handoffs retain the safe task summary, actions, read/changed paths, model/call counts, available usage, stop reason and next steps. Handoffs exclude full model output and private file contents.

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
- Request fields are unchanged. `baseline.optimization_enabled` must be false. Candidate `eco-auto` requires optimization true; explicit candidate model requires false. `eco-auto` is never sent to a provider as a model ID.
- `starter-v1` and `starter-v2` are executable. `max_cases` selects the first N cases in file order, bounded by the dataset, BENCHMARK_MAX_CASES (default 20), and the request cap. Auto-route uses up to three provider requests per case (baseline, router, selected candidate); a fixed-model pair uses two.
- The existing request has no mode field. `BENCHMARK_INFERENCE_MODE=simulated` (default) or `groq` is an explicit backend setting, snapshotted as `measurement_source=simulated|observed`. Groq mode additionally requires LIVE_ENABLED and usable configuration. There is no fallback. `observed` denotes the live adapter, including queued or failed live runs; metrics remain null until actually available. No claim of audited cost or measured electricity follows from it.
- Simulated attempts return the dataset's authored expected answer, fixed 60 input/20 output tokens, and 500 ms for the configured small model or 1200 ms for large, after a 150 ms execution delay. All of these are fabricated fixtures. Matching the answer key by construction is not evidence about Groq accuracy.
- `eco-auto` is the stable API ID for EcoAgent AI auto-route, not a provider model ID. In live mode the configured small model receives the task category and task text, then must return JSON choosing only `small` or `large` with a reason. Ollama receives a native JSON Schema constraint for the route object; supported Groq models receive the provider's structured-output format. The backend maps that choice to its configured model IDs; malformed or truncated router output fails the candidate attempt without policy fallback. In simulated mode a deterministic, clearly labeled fixture chooses a route; it is not an AI call. Fixed routes use `fixed_baseline`/`fixed_candidate`. No cache, retry, external judge or tool execution. Auto candidate latency, tokens, cost and request count include the router call.
- Baseline then candidate execute serially per case. One atomic active slot is shared with `/runs`. A conflict is 409 RUN_ALREADY_ACTIVE with active_run_id and, on benchmark responses, active_run_kind. Case snapshots persist after each attempt. Progress counts cases with both attempts finished, including failures.
- `completed` means all provider attempts finished without provider errors, even if objective checks failed; `partial` means all attempts finished with one or more errors; job-level interruption/internal failure is `failed`; a user stop is `cancelled`. Stop persists the terminal state before cancelling worker execution, preserving saved sides and metrics. Restart converts queued/running jobs to failed/RUN_INTERRUPTED, preserving saved sides and metrics. Terminal snapshots never change.
- Case status is `error` if either attempted side has a provider error; otherwise `passed` if both deterministic checks pass, else `failed`. An incomplete case on an interrupted run remains `skipped` with a pending-attempt explanation and nullable sides. Expected JSON objects are serialized as JSON text for the frontend's string field.
- Evaluators: exact_match trims edges and obeys case_sensitive; json_schema_and_values requires the exact authored keys/values and rejects booleans as numeric answers. required_facts accepts the canonical expected answer or all authored literal phrases after case/whitespace normalization. This is a lexical check, not semantic judgment; paraphrases can fail and misleading text can pass. No claim of answer-quality equivalence.
- Per-side `total_cases` counts finished attempts (including attempts blocked by local limits); `total_requests` counts dispatched HTTP attempts (or simulated adapter calls), excluding requests blocked before dispatch by server limits. passed_cases counts successful checks, failed_cases counts incorrect answers, error_count counts attempt failures. pass_rate = passed_cases / total_cases, including errors in the denominator. Metrics are null before any side attempt exists. total_cost_usd/input_tokens/output_tokens/mean_latency_ms are null if any included attempt lacks that metric; no partial sum silently treats missing values as zero. Latency is the arithmetic mean over that side's attempts only when all are available. Cost is a token-based USD estimate from the documented standard Groq rates, not a bill.
- History is newest-first by (created_at, run_id), with opaque keyset cursors; inserting newer runs does not shift older pages. Case pages are ordered by dataset index with cursors scoped to the run. Limits 1–100, defaults 20 history/50 cases. Invalid, wrong-kind or wrong-run cursors return 422. next_cursor=null means the end of the current snapshot; repeat polling to discover later case attempts.
- Existing error envelope is retained. 404 DATASET_NOT_FOUND/RUN_NOT_FOUND; 409 RUN_ALREADY_ACTIVE; 422 VALIDATION_ERROR/UNSUPPORTED_MODEL; 429 RATE_LIMITED for submission admission; 503 PROVIDER_UNAVAILABLE when live is not configured; safe 500 INTERNAL_ERROR. Malformed UUID paths are 422. Provider timeouts/rate limits/auth/bad responses appear in stored case errors while GET remains 200, not HTTP 504/503 polling failures.
- Default server limits: 10 accepted benchmark runs/minute; 60 inference requests/run; 60 provider requests/minute; $0.50/run and $1.00/UTC day; overall HTTP deadline 30 seconds. Benchmark admission allows at most 20 cases and reserves bounded request/spend budgets; a live run can advertise fewer cases based on the selected models and remaining budget. Limits are configurable server-side only. Admission and budget state persist across restart.
- Before each benchmark request, the server reserves up to 8192 input tokens plus a bounded completion cap (1024 for task inference, 128 for routing). Known usage reconciles estimated cost; absent usage, failed calls and process crashes retain the reservation. Comparison Live calls retain their own reservation rules. Provider billing remains authoritative, and changing rates/configuration requires reviewing these bounds.

## Frontend coordination notes

No wire-schema change is required. `VITE_USE_FRONTEND_MOCK=false` (the existing default) selects real backend transport; BENCHMARK_INFERENCE_MODE selects the server adapter independently. The current UI does not expose server mode before the first run (it says SOURCE PENDING), but each returned snapshot prominently shows SIMULATED/OBSERVED. History/case Load more controls already exist in the actual code despite older integration notes.

The active-run navigation limitation noted during initial integration has since been fixed: both run types return `active_run_kind` and the frontend opens the identified run without resubmission.

## Current implemented source and benchmark contract

All routes are under `/api/v1`; the generated, machine-readable source of truth is [`../contracts/openapi.json`](../contracts/openapi.json).

### Live completion length

The backend defaults `INFERENCE_MAX_COMPLETION_TOKENS` to 65536, configurable from 1 to 65536. Comparison Live calls use the configured, provider-bounded value. Benchmark task inference caps output at 1024 tokens, and the AI router at 128, so longer benchmark answers may be marked incomplete. Benchmark reservations use a bounded 8192-input-token ceiling plus those output caps. No automatic retry is performed. If the provider returns `finish_reason=length`, the output remains visible but marked incomplete and excluded from benchmark correctness scoring; a provider/context hard limit can still be reached.

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

`starter-v1` remains the five-case baseline. `starter-v2` version 2.2.0 has 40 synthetic cases across classification, arithmetic, extraction, summarization, reasoning, formatting, fact retrieval, writing and code generation; its first 20 cases cover every category. Writing/code cases use deterministic lexical checks only; code is not executed and fixtures do not establish semantic quality. The catalog reports a hard default maximum of 20 cases per run, subject to the server request and spend budgets. Auto-route cases use a router call plus paired baseline/candidate inference.

The model catalog includes configured GPT-OSS small/large models and the priced `qwen/qwen3.8-27b` Groq Preview option. The UI marks Qwen as Preview; provider account availability is not probed. See the [Groq supported-model page](https://console.groq.com/docs/models) for published model status/rates. `eco-auto` remains the compatible API identifier for the AI router and is not sent as a provider model ID.

Benchmark evaluators are deterministic authored checks (exact match, exact JSON values/keys, or literal required facts), not semantic quality judges. Truncated outputs, and outputs with unknown completion status, are marked `incomplete` and excluded from the evaluated-case pass-rate denominator. Metrics distinguish total/evaluated/passed/failed/incomplete/error counts. Simulated answers and timings are fixtures, not evidence of model quality. Estimated token costs are not provider billing.

Comparison and benchmark duplicate-run responses include `active_run_id` and `active_run_kind` when available. If the kind is missing, the frontend calls `GET /active-run` and routes to the identified run without repeating a submission; the Stop action sends the identified ID to `POST /active-run/stop`.
