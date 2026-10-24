# Benchmark and Groq Integration Plan

> **For agentic workers:** Use superpowers:executing-plans. Preserve completed demo work and work inline on Sean_branch.

**Goal:** Adopt main's typed benchmark frontend, implement its server API, then verify Groq adapter behavior without billable calls.
**Architecture:** Extend the existing SQLite snapshot store with a run kind, retaining one atomic active-run gate across comparison and benchmark routes. Reuse inference results, safe provider errors, timestamps, settings and startup recovery. Benchmark snapshots hold ordered per-case sides and deterministic evaluation state. A Groq-compatible HTTPX adapter shares persistent conservative budget reservations and rate limits.
**Tech Stack:** Existing FastAPI/Pydantic/SQLite/HTTPX/pytest and teammate's React/Vite frontend, unchanged client wire schema.
**Spec:** User's continuation request; docs/API_CONTRACT.md benchmark proposal; benchmarks/starter-v1.json; existing shared v1 contract.

## Global Constraints
- No existing demo endpoints removed or schema changed; no secrets printed, returned, committed, or sent to frontend.
- No main modifications, force push, PR merge, or billable smoke without explicit authorization.
- Benchmark request has no mode field: explicit BENCHMARK_INFERENCE_MODE=simulated|groq controls server adapter; snapshot provenance is authoritative. Default simulated.
- Dataset proposals about agents/firewalls are non-executable and excluded.
- cancelled is reserved, not emitted; no cancellation API.
- Adopt frontend shapes unchanged; document exact evaluation, metric, cursor, limit and error semantics in shared contract and examples.

## Review Focus
- Cross-endpoint concurrent submissions and old SQLite database migration.
- Cursor boundaries while new history is inserted; reject wrong-kind/wrong-run cursors.
- Missing usage, provider failure, conservative spend reservations across restart.
- Safe HTTP failures and provider response parsing; no retries or demo fallback.
- Real browser transport with frontend mock disabled, including production same-origin routing.

### Task 1: Recover and merge
- [x] Preserve 57-test demo work in commit 0501553.
- [x] Fetch and inspect main a7e3767; merge into Sean_branch as c671ea0, combining .gitignore exclusions.
- [x] Read contract, client, dashboard and all dataset inputs; accept schemas with documented semantics.

### Task 2: Benchmark API
Files: backend/app/benchmarks/{schemas,catalog,service,routes}.py; backend/app/store.py; backend/tests/test_benchmarks.py; contracts/openapi.json/examples; docs/API_CONTRACT.md.
Interfaces: BenchmarkService.submit(StartBenchmarkRequest)->StartBenchmarkResponse; Store.create_benchmark(record), get_benchmark(id), save_benchmark(record), list_benchmarks(limit,cursor); shared active gate.
- [x] Write and run failing API tests for catalog, creation, progress, all cases, pagination, concurrency, safe failures, persistence and old-schema migration.
- [x] Implement deterministic adapter/evaluators and exact response models, then run all backend tests.
- [x] Update shared OpenAPI, examples and adopted contract semantics together. Preserve original v1 paths.

### Task 3: Groq adapter and limits
Files: backend/app/providers/live.py; backend/app/settings.py; runner.py; store.py; backend/tests/test_live.py; .env.example; root docs.
Interfaces: LiveProvider.infer(prompt,model_id,run_id)->InferenceResult; reserve before HTTP, reconcile observed cost afterward; unknown usage remains null and retains conservative budget reservation.
- [x] Tests first: exact URL/body/auth, content/usage parsing, hard timeout, auth/rate-limit/provider errors, cost math, request limits and persistent budget limits. Use HTTPX MockTransport only, never real Groq.
- [x] Implement configured Groq models and per-run/per-day spending plus per-minute requests. Default LIVE_ENABLED=false.
- [x] Retain demo adapter and explicit benchmark simulated mode; never fallback from live.

### Task 4: Integrated verification and handoff
Files: backend/app/main.py; backend/tests/test_static.py; README.md; docs/backend-handoff.md; root setup docs.
- [x] Test static serving/API precedence then implement serving existing frontend/dist.
- [x] npm ci, typecheck, frontend tests, production build; run backend suite and real HTTP restart smoke.
- [x] Browser walkthrough against real backend with VITE_USE_FRONTEND_MOCK=false, original comparison and benchmark datasets/submission/history/cases/errors/provenance.
- [x] Report precise credentials/configuration availability without secret values. Live billable smoke pending authorization and credentials.
- [x] Commit validated changes on Sean_branch and document remaining blockers; no push implied.

Verification: 127 backend tests; 18 frontend tests; typecheck/build and both HTTP restart smokes passed. Real Groq smoke remains explicitly unrun (no credentials or billable authorization). Final independent review unavailable after reviewer usage limit; self-review and regression tests performed.
