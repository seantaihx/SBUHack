# Backend milestone handoff

## Milestone 1 — backend ready; actual frontend gate pending

Branch: Sean_branch. Find the milestone commit with `git log --oneline --grep='persisted demo API'`.

Available: exact health/capabilities/sample-tasks responses; queued POST with Location; background one-task demo returning baseline/optimized billing outputs; SQLite persistence and GET after application restart. All returned snapshots validated against the shared JSON schema.

Changed files: adopted kit moved to root without contract/fixture edits; root README, .gitignore, .env.example; backend/app modules; backend/tests/{conftest,test_api,smoke_http}.py; pinned backend/requirements.txt; implementation plan and this handoff. Original untracked kit configuration files remain in place.

Checks run: `.venv/bin/python -m pytest -q` (4 passed); `UV_CACHE_DIR=/tmp/ecoagent-uv-cache uv pip check --python .venv/bin/python` (compatible); `.venv/bin/python backend/tests/smoke_http.py` (real local HTTP and restart persistence passed). Initial missing-app failures confirmed tests were exercised before implementation. The default sandbox denied loopback binding; the authorized local smoke succeeded with that restriction lifted.

Launch from repository root:

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Frontend action: fetch `/api/v1/sample-tasks`, POST `{mode: "demo", tasks: [samples.tasks[0]]}` to `/api/v1/runs`, then poll Location and render both outputs. Use Vite `/api` proxy to port 8000. The exact curl request is in README.

Limitations: fixture inference only, not a fake HTTP provider or real provider integration. Live disabled. No frontend yet, no browser walkthrough or built-frontend serving. Full recovery and failure acceptance are the next backend milestone.

## Milestone 2 — core demo execution verified

The core demo now includes all three tasks, matched-cohort arithmetic, an atomic active-run gate, safe attempt/job errors, hard total attempt deadlines, graceful interruption and startup recovery. Completed runs remain immutable. Validation and generated response schemas follow the shared contract.

Verification: 57 tests passed; dependency check passed (31 installed packages); real Uvicorn HTTP smoke passed metadata, one-task completion, SQLite persistence, abrupt-process interruption, RUN_INTERRUPTED recovery, preserved results, and a new run after recovery. Failure tests use injected in-process provider doubles, not a real provider or fake HTTP server.

The independent reviewer reported no confirmed material defect during its initial pass, but hit its usage limit before delivering a final verdict. Independent review is incomplete and must not be represented as approved.

The subsequent user request authorizes integrating main's benchmark frontend and implementing its proposed API, followed by Groq support. This supersedes the earlier optional-work gate; the existing demo remains supported.

## Benchmark/Groq integration handoff — October 24, 2026

### Git recovery and synchronization

Verified Sean_branch. The previously uncommitted core demo work was saved as `0501553` after `8f4b877`. Fetched origin/main `a7e3767`, reviewed its contract/client/datasets, and merged it into Sean_branch as `c671ea0`. The sole merge conflict was .gitignore; both sets of secret/build/database exclusions were retained. Original untracked EcoAgent-repo-kit/.env.example and .gitignore and the ignored .DS_Store were preserved. Main, Muffin_branch and remote branches were not modified; nothing was force-pushed or reset.

### Accepted contract and behavior

The existing frontend consumes all five new benchmark endpoints unchanged. OpenAPI and benchmark examples now describe them, with exact semantics in docs/API_CONTRACT.md. Starter dataset only; no agent/firewall scope. Existing comparison APIs and fixtures remain intact.

Implemented: catalog, validation, baseline/fixed-candidate/eco-auto selection, progress, per-case results/evaluation, history and scoped cursors, shared atomic active gate, failure/null semantics, immutable terminal snapshots and SQLite recovery/migration. Benchmarks default to server-side simulation, independently of frontend transport mode. `cancelled` is reserved and never emitted; no auth/cancel endpoints were added.

The Groq HTTPX adapter uses the two requested model IDs and configured base path, Bearer credentials only server-side, exact shared generation settings, observed usage/timing, token-priced estimates, sanitized failures, no retries/fallback, and persistent request/spending limits. Ordinary tests never call Groq. Missing usage remains null, and undispatched locally limited requests are not counted as sent HTTP requests.

### Changed backend and shared files

- backend/app/benchmarks/{schemas,catalog,pagination,routes,service}.py
- backend/app/providers/live.py and providers/base.py; pricing.py; errors.py
- backend/app/{main,runner,settings,store}.py
- backend/tests/{test_benchmarks,test_live,test_static,test_contract_examples}.py plus existing schema tests and smoke scripts
- .env.example, README.md, START-HERE.md; contracts/openapi.json and benchmark examples
- docs/API_CONTRACT.md, BENCHMARK_INTEGRATION.md, FRONTEND_QA.md, implementation plan and this handoff

Frontend source, package files, and benchmark dataset inputs are unchanged from origin/main a7e3767. The merge brought them into Sean_branch; no collaborator-owned frontend edits were made.

### Verification and boundaries

- Python suite covers original comparison semantics, benchmark lifecycle/pagination/concurrency/recovery, legacy database migration, objective evaluators, live HTTP adapter parsing/errors/timeouts/usage/cost, persistent request/budget limits and static serving/API precedence. All contract examples validate with format checks.
- A fresh temporary Python 3.14.6 environment installed all 31 exact requirements offline from cache, then passed dependency checks and the suite; the final suite passed **127 tests** (18.80 seconds).
- Real Uvicorn smoke scripts passed original comparison and benchmark HTTP cycles, abrupt-process interruption, preserved results, restart recovery, and new runs after recovery. Both force LIVE_ENABLED=false and benchmark simulation.
- Node 24: npm ci passed with no reported vulnerabilities; typecheck passed; 18 frontend tests passed; production build passed with frontend mocks false. Node 25 was unsupported by pinned Vitest, so a temporary Node 24 was used without modifying dependencies.
- Actual browser walkthrough through Vite: original comparison completed with expected arithmetic and restored on refresh; benchmark catalog/submission/polling/cases/history worked; provenance remained SIMULATED. Stopping only our temporary backend produced visible HTTP 502, not frontend fixture fallback.
- Actual built frontend served from FastAPI's origin loaded catalog/history and submitted a benchmark. Unknown API paths remain JSON 404; static path traversal/symlink escapes are covered by tests.
- Self-review found malformed-but-decodable history cursors and locally blocked request counting needed tightening; regression tests reproduced both and passed after fixes. Independent review did not finish because the reviewer hit its usage limit; no independent approval is claimed.

### Exact launch and frontend action

From repository root:

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

The built frontend is then at http://127.0.0.1:8000. For development use the README's Vite proxy command with VITE_USE_FRONTEND_MOCK=false. The running verification instance uses DATABASE_PATH=/tmp/ecoagent-integration.sqlite3, LIVE_ENABLED=false and BENCHMARK_INFERENCE_MODE=simulated so normal project data remains untouched.

Copyable request:

```sh
curl -i http://127.0.0.1:8000/api/v1/benchmarks/runs \
  -H 'Content-Type: application/json' \
  --data-binary @contracts/examples/benchmark-start.json
```

Muffin: use the current client unchanged, load Benchmarks, run the starter dataset and inspect history/cases. Keep frontend mocks false. Coordinate one frontend improvement: the comparison view cannot reopen an active benchmark from a cross-view 409; active_run_kind-aware navigation would address it. No schema change is required.

### Remaining blockers and limitations

No .env, api.env or GROQ_API_KEY was present when checked. Groq is implemented and fake-provider tested, but not configured or verified against real Groq. A live smoke needs a privately configured key and explicit billable-inference authorization. Root .env is the supported secret file; api.env is not loaded. No GPU is needed.

Simulated answers equal the dataset's expected answers by construction. Required-facts checks are lexical; they are not semantic quality validation. Cost guards use conservative full-context reservations and can block early; actual billing is not measured. A storage outage requires restoring storage and restarting to recover the last durable snapshot. Full responsive/accessibility review remains teammate follow-up. Changes remain local on Sean_branch for review; no push, PR merge or public deployment was performed.


Final verified runtime versions: CPython 3.14.6; uv 0.11.26; FastAPI 0.162.0; Pydantic 2.14.1; Uvicorn 0.54.0; Starlette 1.9.0; HTTPX 0.28.1; HTTPX2 2.16.0 (Starlette test client); pytest 9.1.1; jsonschema 4.26.0; python-dotenv 1.2.4; Node 24.22.1. All 31 resolved Python packages are exactly pinned. Frontend versions remain in the teammate's lockfile.

Commands actually run included `UV_CACHE_DIR=/tmp/ecoagent-uv-cache uv pip install --offline --python /tmp/ecoagent-pinned-check/bin/python -r backend/requirements.txt`, `uv pip check --python /tmp/ecoagent-pinned-check/bin/python`, `/tmp/ecoagent-pinned-check/bin/python -m pytest -q` (127 passed), both `.venv/bin/python backend/tests/smoke_*.py` scripts (passed), and the README npm commands with the temporary Node 24 PATH (typecheck, 18 tests, build passed). `git diff --check` passed; original comparison schema/fixtures and frontend/dataset sources were verified unchanged. Credential-pattern and ignore-rule checks passed without printing secret values.

## Milestone 3 — source import and expanded benchmark UI (Muffin_branch, October 24, 2026)

The current source and benchmark integration supersedes the earlier “Muffin unchanged” handoff above. The user approved the source proposal and authorized this additive implementation. Backend/API and dataset changes are in local commit `18b03b1`; frontend and handoff changes are in a separate local commit on `Muffin_branch`. Nothing was pushed, merged, or deployed.

- Added PDF/CSV/text/public-webpage preview and storage endpoints, explicit source attachment confirmation, same-source inputs to both policies, bound-source retention, URL destination protections, and immutable run source metadata. OCR, answer citations, and not-found-in-source evaluation are not implemented.
- Added `starter-v2` (24 synthetic cases) while preserving `starter-v1`, dynamic effective run caps, Qwen Preview metadata/pricing, incomplete-output handling, and the JSON benchmark analysis export. Request/spend limits remain active; the effective maximum may be below ten for a costly model pair.
- Frontend now connects source preview and benchmark analysis controls to those routes. Older statements in the first benchmark handoff about five cases only, source routes being unavailable, or active-run-kind navigation being a future task are historical.
- Verification on Windows: backend suite **139 passed**; frontend typecheck passed, **45 frontend tests passed**, production build passed; all 33 shared/mock/dataset JSON files parsed; `git diff --check` passed. A local HTTP walkthrough with a temporary SQLite DB and simulated inference verified source POST/GET/DELETE, catalog and v2 definition, one-case benchmark completion, and an export containing all 24 authored definitions marked `partial`.
- No actual browser visual/keyboard walkthrough was possible because a browser automation surface was unavailable. No live Groq request or billable inference was made. See [`handoffs/muffin-progress.md`](handoffs/muffin-progress.md) for changed areas, commands, limitations, and handoff detail.
