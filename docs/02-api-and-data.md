# API and data contract v1.1

Machine-readable source: `contracts/openapi.json`. Root prefix: `/api/v1`. JSON keys are snake_case. Times are UTC ISO 8601 with Z; UI formats them for the user. UUID run IDs are server-generated. Logical model names are `small` and `large`. No credentials occur in API responses.

## Endpoints

| Method/path | Purpose | Success |
|---|---|---|
| GET /health | Process readiness and contract version | 200 Health |
| GET /capabilities | Modes, logical models, limits, policy, estimation assumptions | 200 Capabilities |
| GET /sample-tasks | Exact versioned workload used for demo | 200 SampleTasks |
| POST /runs | Validate, reserve worker, persist, start comparison | 202 Run |
| GET /runs/{run_id} | Full snapshot: progress, results, aggregates | 200 Run |

### Local workspace agent (opt-in, loopback only)

The workspace agent is a separate, explicitly enabled local prototype. It requires `AGENT_ENABLED=true`, a backend-only `AGENT_WORKSPACE_ROOT`, and configured Live inference. Requests are accepted only when both the Host is localhost/127.0.0.1/::1 and the direct client peer is loopback. Do not expose or reverse-proxy these unauthenticated routes publicly. The operator must explicitly confirm that task instructions and approved file contents may be sent to the configured inference provider.

| Method/path | Request | Success | Behavior |
|---|---|---|---|
| GET /agent/capabilities | None | 200 AgentCapabilities | Reports safe enablement reason and supported operations; never exposes the workspace path. |
| POST /agent-runs | AgentStartRequest | 202 AgentRun; Location | Starts one bounded write/code task; only exact relative read/write paths are in scope. Conflicts return 409 with active run ID/kind. |
| GET /agent-runs/{run_id} | UUID path | 200 AgentRun | Current status, pending operation, and human-readable event log. |
| GET /agent-runs/{run_id}/events?cursor=0&limit=50 | Cursor/limit | 200 AgentEventsResponse | Bounded event page; limit 1–100. |
| POST /agent-runs/{run_id}/approvals | `{action_id, action_hash, approved}` | 200 AgentRun | Approves/denies exactly the displayed action; stale hashes return 409. Approval never authorizes a later action. |
| POST /agent-runs/{run_id}/continue | Empty | 200 AgentRun | Explicitly allows one more model planning call after pause/approval. No automatic continuation. |
| POST /agent-runs/{run_id}/stop | Empty | 200 AgentRun | Stops the run; already approved file operation is atomic and cannot be rolled back. |

`AgentStartRequest` requires `task_type` (`write` or `code`), nonempty `instruction` (≤5000 chars), `confirm_provider_submission: true`, at least one of `read_paths`/`write_paths` (each exact relative paths, max 20), and `max_steps` (1–12 model calls, default 8). No wildcard scope. `AgentCapabilities` hard-codes shell and network tools as disabled and requires approval for every file operation. Reads/writes are limited to UTF-8 text up to 50,000 characters; there is no delete, command, execution, git, deployment, or permission-changing operation. Generated code is text only and is not run. Each proposed operation is displayed in a pending action before approval. Identical operations are rejected; model-call limits and manual continuation prevent unattended loops. Restart pauses active agent runs and does not auto-resume them.

Example start body:

```json
{"task_type":"write","instruction":"Draft a short README section","confirm_provider_submission":true,"read_paths":["README.md"],"write_paths":["docs/draft.md"],"max_steps":4}
```

The `AgentRun.events` list explains actor, operation, target, decision and summary in plain language; approved read content may appear as tool details and is sent to the configured provider on the next explicitly continued step. Review workspace contents before approving a read. The prototype's credential filters are defense-in-depth, not a guarantee that all secrets are recognized. Capabilities/agent routes never silently enable Live or Demo fallback.

No GET list-runs, authentication, user CRUD, model CRUD, or cancellation endpoint in v1. Refresh the run screen using a run ID stored in URL query `?run=<uuid>`. Do not put prompts in the URL. Resetting the UI does not cancel a backend run.

## Request validation

CreateRun fields: `mode` (`demo` or `live`), `tasks` (1–10 Task objects), `carbon_intensity_g_per_kwh` (number, default 400, inclusive range 0–2000).

Task: `id` (1–64 letters/digits/underscore/hyphen), `type` (`classify`, `extract`, `summarize`, `write`, or `code`), `prompt` (trimmed nonempty text, maximum 2000 characters), and optional `constraints`. `allowed_labels` applies only to classify; `required_json_fields` applies only to extract. Constraint lists must be unique and contain 1–30 bounded nonempty strings. IDs must be unique in a run. Unknown request fields are rejected. Whitespace-only prompts fail. Validation errors use the common error envelope.

Demo accepts a nonempty subset of `demo/tasks.json` only, in any order. Each ID/type/prompt must match the fixture exactly, after trimming prompt edges. This makes fixture answers honest and deterministic. Modified/custom tasks require Live. The demo UI therefore offers checkbox selection rather than an editable prompt field.

Live requires LIVE_ENABLED=true, a base URL, and two nonempty distinct model IDs. An API key is optional for a trusted local endpoint. Configuration readiness is not a connectivity guarantee; provider errors occur per attempt. Do not probe an external provider in GET /capabilities.

`quality_fallback` defaults false and is Live-only. When true, one optimized classify/extract attempt that fails deterministic validation may be escalated once to the large model. It does not retry provider errors, truncated output, or arbitrary semantic concerns. The additional provider call counts toward request/spend guards. The run policy version becomes `task-routing-v2-fallback`; otherwise it remains `task-routing-v1`. `write` and `code` currently route optimized work to large; generated code is text and is never executed by comparison runs.

`POST /runs` returns 202 and a `Location: /api/v1/runs/<uuid>` header. No idempotency guarantee: disable duplicate UI submissions. On an uncertain network failure, do not automatically repeat POST; explain it may have started. A 409 includes `details.active_run_id` so the UI can reopen the active run.

## State and polling

`queued → running → completed | partial | failed`. Terminal states never transition. Without fallback `total_attempts=2*len(tasks)`; if fallback is used, `total_attempts` increases before the extra provider call. `completed_attempts` counts provider calls, while `results` remains one row per task/policy pair. A queued response may have zero results. Running snapshots can grow over time. Poll every 1000 ms, wait for each fetch to settle before scheduling the next, and stop on terminal status or unmount. On connection failure retain the last snapshot and offer retry; never invent a failed run locally.

Every task/policy pair has at most one result. Stable result ordering is request task order, with baseline before optimized. The response echoes tasks so reloaded pages work. `run_error` is null except for job-level failure. `finished_at` is null until terminal.

## Results and provenance

Result includes `task_id`, `policy`, `model_role`, `model_id`, `routing_reason`, `status`, `output_text`, `latency_ms`, `input_tokens`, `output_tokens`, `estimated_energy_wh`, `estimated_carbon_g`, `error`.

A failed result has null output and all numeric metrics null; its error is present. A successful result has non-null output and latency; provider usage and derived estimates may be null. `model_id` identifies the configured deployment in Live or `demo-small`/`demo-large` in Demo. Never echo URLs or keys as model IDs.

`routing_reason` includes `baseline_large`, `simple_task_small`, `summary_large`, `writing_large`, `coding_large`, and `validation_fallback_large`. `output_validation` is `passed`, `failed`, or `not_configured`; it records deterministic format/constraint checks, not semantic correctness. `initial_attempt` and `fallback_attempt` preserve both outputs, errors, usage and estimates if escalation ran. Top-level latency, token and estimate values include both calls only when all needed values are available; otherwise they are null. `cost_usd` is nullable and provider-priced only for Live. Run-level `measurement_source`: `simulated` for demo, `provider_usage_and_client_timing` for live. Run-level `energy_estimation_profile=illustrative-v1` always. Show mode and estimate labels even on screenshots.

Server-owned instructions are versioned as `task-instructions-v1` and apply consistently to baseline and optimized. They request label-only classification, JSON extraction with null for missing fields, evidence-grounded summaries, reviewed writing, and unexecuted code generation. A classification is deterministically checked only when allowed labels are supplied. Extraction is checked for JSON object structure and configured required fields. Writing and code have no automatic semantic validator.

## Aggregation (backend only)

`comparison` always exists, including empty/partial runs. `successful_pairs` counts tasks for which both attempts succeeded. `energy_pairs` counts successful pairs with complete token usage for both attempts. `latency_pairs` counts successful pairs (successful latency is always present).

Energy and carbon totals use ONLY the same `energy_pairs` on both sides; never sum unmatched results. Latency totals use ONLY the same `latency_pairs` on both sides. Display cohort counts so users see that the sets can differ. No qualifying pairs means the relevant totals, savings and percentages are null. Zero is a valid value when a qualifying cohort exists.

`saved = baseline_total - optimized_total`. `savings_pct = saved / baseline_total * 100` only when baseline_total > 0; otherwise null. Negative savings remain negative and are displayed as an increase. Do not clamp. For carbon intensity 0, carbon totals/saved are 0 when energy pairs exist, but carbon percentage is null.

Use raw precision internally. Display Wh to 6 decimals, grams CO2e to 6 decimals, milliseconds to nearest integer, percentages to 1 decimal; show '<0.000001' for tiny positive impact rather than implying zero. For running and partial jobs, explicitly label the comparison incomplete. Terminal completed does not imply validated answer quality.

Example demo with all three tasks: baseline energy 0.0434 Wh, optimized 0.02644 Wh; saved 0.01696 Wh (~39.1%). Carbon at 400 is 0.01736 g versus 0.010576 g. These are arithmetic consequences of fabricated fixture usage and illustrative coefficients, not research findings or measured environmental savings.

## Errors

Envelope: `{ "error": { "code": "...", "message": "safe readable text", "details": {} } }`.

- 422 VALIDATION_ERROR, INVALID_DEMO_TASK, DUPLICATE_TASK_ID.
- 404 RUN_NOT_FOUND; malformed UUID is 422.
- 409 RUN_ALREADY_ACTIVE, with active_run_id.
- 503 LIVE_UNAVAILABLE when configuration does not permit Live.
- 500 INTERNAL_ERROR, with sanitized message.

Attempt errors use PROVIDER_TIMEOUT, PROVIDER_AUTH_ERROR, PROVIDER_RATE_LIMITED, PROVIDER_UNAVAILABLE, PROVIDER_BAD_RESPONSE. Job failure uses RUN_INTERRUPTED or INTERNAL_ERROR. Redact provider bodies, auth headers and secrets. A provider timeout does not change GET /runs to HTTP 500; it appears in the stored result.

## Provider wire format

POST configured base URL + `/chat/completions`:
`{"model":"<configured model id>","messages":[{"role":"system","content":"Follow the user's task. Be concise. Return only the requested answer."},{"role":"user","content":"<task prompt>"}],"temperature":0,"max_completion_tokens":65536,"stream":false}`.

`max_completion_tokens` comes from the backend-only `INFERENCE_MAX_COMPLETION_TOKENS` setting (default 65536; allowed 1–65536), not from browser input. Known Groq model ceilings clamp this setting (65,536 for GPT-OSS, 16,384 for Qwen 3.8 27B). Both comparison policies share the same configured setting. A provider `finish_reason=length` remains explicitly incomplete; there is no automatic second request. The token cap must fit the selected model and the backend's request/spending limits.

Read `choices[0].message.content` as a string. Missing/invalid choices or content gives PROVIDER_BAD_RESPONSE. Read optional `usage.prompt_tokens` and `usage.completion_tokens` as nonnegative integers; absent/invalid usage yields null for that field and no energy estimate. Do not fail otherwise valid text solely because usage is missing. Authorization: Bearer key only when configured. Verify HTTPS normally; never disable TLS verification. HTTP is acceptable only for operator-configured local/trusted inference.
