# Product and architecture

## Product decision

EcoAgent is a comparison tool for a developer or company considering whether simple AI requests can use a smaller model while more involved requests retain the larger model. It shows what each policy chose, the resulting text, observed latency and token usage where available, and explicitly modeled energy/carbon estimates.

One demo story: choose the sample workload, choose Demo or Live, click Compare, watch completed requests appear, then compare baseline and optimized outputs side by side and explain the assumptions behind the impact numbers.

The MVP does not measure a provider's electricity consumption. It must never call an estimate a measurement, infer quality equivalence from successful HTTP responses, or promise savings for every workload.

## Scope and decision boundaries

- One local/single-user workspace, one comparison job active at a time.
- Up to 10 tasks per comparison; each runs once with baseline and once with optimized routing.
- Three declared task types: `classify`, `extract`, `summarize`.
- Versioned policy `task-routing-v1`: baseline always uses logical model `large`; optimized uses `small` for classify/extract and `large` for summarize. The user or dataset supplies task type; this MVP does not automatically infer complexity.
- No response cache, retries, prompt compression, batching, or external routing LLM in v1. Those would confound attribution or expand scope.
- All requests use the same system message and generation settings. Only the selected model changes. Routes choosing the same model may still yield different text or latency; disclose this.
- Shared generation settings: temperature 0, non-streaming, and a backend-configured completion cap. `INFERENCE_MAX_COMPLETION_TOKENS` defaults to 65,536 (allowed range 1–65,536) and is sent as `max_completion_tokens`; baseline and optimized attempts use the same setting, clamped to known model ceilings. Current Groq ceilings are 65,536 for GPT-OSS and 16,384 for Qwen 3.8 27B. A provider may still stop at a hard output or context limit. Do not treat a `finish_reason=length` response as complete or retry automatically because that can duplicate provider charges.
- No automatic claims about accuracy. A result panel allows human comparison; no numeric quality score in v1.
- Demonstrate policy routing and integration first. Energy estimates are a transparent secondary illustration.

## Build choices

Use React/TypeScript/Vite and FastAPI/Pydantic v2, with SQLite via Python's standard library. Use HTTPX for the provider adapter. Keep styling simple; a component library and chart package are optional only if they save time without changing the contract. Use CSS bars/tables for comparison; no chart dependency is required.

Target desktop presentation with responsive layout down to a phone-width viewport. Keyboard access, labels, focus visibility, adequate contrast, and status text are required.

## Components and responsibilities

Browser → same-origin `/api/v1` API → run service → policy → demo adapter or live adapter → metric calculator → SQLite → browser polling.

Backend modules to implement: `main.py`, `schemas.py`, `settings.py`, `store.py`, `runner.py`, `policy.py`, `providers/demo.py`, `providers/live.py`, `metrics.py`. Builders may split further without changing the API. Backend owns all calculations, routing, timestamps, and persisted state. Frontend never independently calculates savings.

Frontend components: mode/workload controls, task preview/editor for live mode, start button, progress, metric cards, comparison table, two-output detail view, assumptions disclosure, error/retry panel. A single screen is enough; no login or complex navigation.

## Company-hosted inference

An administrator/operator configures the backend with an accessible base URL and model IDs. The adapter posts to `<base_url>/chat/completions`; a base URL normally includes `/v1`. Preserve the supplied path when joining; do not accidentally remove `/v1`.

Company inference fits if the company provides a compatible API, network access, permission, and model identifiers. GitHub or Lovable does not automatically grant access. A service exposing only one model cannot demonstrate smaller-versus-larger routing; keep Live disabled if the configured IDs are identical. Company APIs with different request formats need a future adapter, not a misleading claim of existing support.

Do not send sensitive company prompts during the hackathon. Use synthetic samples. Keys and endpoint configuration stay on the backend. The browser sends logical `small`/`large` roles only indirectly through policy; it cannot supply a destination URL or secret.

## Execution and persistence

Implement one in-process background worker with a single atomic active-run gate. Store runs and completed results in SQLite. Claim the active slot and insert the queued run atomically before responding 202; a simultaneous second POST gets 409. Run Uvicorn with one worker only.

For each task, execute baseline then optimized serially. Persist a result after each attempt. A failed provider call becomes a result with `status=failed`; continue the other attempts. Each call has a hard overall 30-second deadline, including connect/read phases; retries are disabled. Maximum live comparison is 20 attempts (roughly 10 minutes at the timeout ceiling); use three tasks for the demo.

Progress counts finished attempts including failures. `completed` means all attempts succeeded; `partial` means attempts finished but at least one failed. `failed` means a job-level problem prevented completion, including application restart. On startup, convert leftover queued/running records to failed with `RUN_INTERRUPTED`. Keep completed results for inspection. No cancellation, automatic resume, or multi-process scheduling in v1.

SQLite stores the full run snapshot as JSON plus ID, status, created_at columns; each update is one transaction. Use fresh connections per operation and an application lock around read-modify-write. Never hold database locks across inference calls.

## Local and demo deployment

Local development: backend localhost:8000, frontend localhost:5173, Vite proxies `/api` to localhost:8000. Frontend calls relative URLs only.

Build frontend to `frontend/dist`. Backend serves `/api` first, then static assets and the SPA fallback for non-API routes only. Unknown API routes must return JSON 404 rather than index.html. One host/process serves the presentation build.

A public deployment is optional and needs provider abuse controls before enabling Live. For the judged demo, prefer a local backend or disable Live on an unauthenticated public deployment. CORS is unnecessary with the proxy/same origin. Do not add wildcard CORS as a substitute for configuration.

## Energy methodology

The checked-in profile `illustrative-v1` is a hypothetical model, not calibrated hardware data:

- small: input token 0.00002 Wh, output token 0.00008 Wh.
- large: input token 0.00010 Wh, output token 0.00040 Wh.
- scenario carbon intensity default 400 gCO2e/kWh, adjustable 0–2000.

For each successful result with both token counts: estimated_energy_wh = input_tokens × input_wh_per_token + output_tokens × output_wh_per_token. estimated_carbon_g = estimated_energy_wh / 1000 × carbon_intensity_g_per_kwh.

These coefficients are chosen solely for demonstration. They omit idle power, batching, utilization, cooling, network overhead, regional/time variation, and provider-specific hardware. Model size alone does not establish those coefficients. Label the panel “Illustrative energy/carbon estimate”; show the coefficients and scenario intensity. Do not label intensity as live grid data.

Demo tokens and latency are simulated. Live latency is measured around each HTTP operation with a monotonic timer. Live tokens come from provider usage; if absent, store null and leave energy/carbon null. Do not estimate missing live tokens by string length. Usage does not equal electrical telemetry.

No aggregation may treat missing or failed measurements as zero. Exact aggregation rules are in the API document.
