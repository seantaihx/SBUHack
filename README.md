# EcoAgent

SBUHacks inference comparison and benchmark prototype. Deterministic simulation stays available without credentials. Energy/carbon coefficients are illustrative, and token-priced API costs are estimates, not provider bills or measured emissions.

## Implemented and verified

- Existing `/api/v1` comparison API: exact schemas, deterministic demo, SQLite snapshots, paired aggregates, one-worker gate, safe failures and restart recovery.
- Five benchmark routes: datasets, history, start, progress snapshot, case results; stable pagination; deterministic evaluation; baseline/candidate routing; persistent limits.
- Groq-compatible HTTP adapter for `openai/gpt-oss-20b` and `openai/gpt-oss-120b`, including usage/timing, estimated cost, hard timeout and sanitized errors. Tested with mocked HTTP responses; **real Groq inference has not been tested and no credentials are configured in this checkout**.
- Teammate's unchanged React frontend integrated from main `a7e3767`; real HTTP browser walkthrough passed using simulated backend inference, through both Vite and the production frontend served by FastAPI.

Shared specification: [original architecture](docs/01-product-and-architecture.md), [comparison semantics](docs/02-api-and-data.md), [accepted benchmark contract](docs/API_CONTRACT.md), [OpenAPI](contracts/openapi.json), [handoff and verification](docs/backend-handoff.md). Original v1 schemas/fixtures are preserved; benchmark schemas/examples are additive. The proposed agent/firewall datasets are not executable.

## Setup and launch on macOS

Python 3.11+ is required; verified with CPython 3.14.6 and uv 0.11.26. Frontend tools require a supported Node version; verified with Node 24. The installed Node 25 is outside the pinned Vitest engine range. Backend dependencies are fully pinned in `backend/requirements.txt`; frontend uses the teammate's unchanged package-lock.json.

From the repository root, using a Python 3.11+ executable:

```sh
uv venv .venv --python /opt/homebrew/bin/python3
uv pip install --python .venv/bin/python -r backend/requirements.txt
```

`/opt/homebrew/bin/python3` is this Mac's verified interpreter; use your equivalent absolute path on another machine. Installed dependencies allow the simulated demo to run offline.

Build the frontend with Node 24 on PATH, then start one backend process:

```sh
npm ci --prefix frontend
VITE_USE_FRONTEND_MOCK=false npm run build --prefix frontend
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Open [EcoAgent](http://127.0.0.1:8000). The backend serves `frontend/dist`; `/api` routes take priority, unknown API routes return JSON 404, and SPA navigation falls back only outside `/api`. Use exactly one worker. Do not expose this unauthenticated hackathon service publicly with Live enabled.

For frontend development, keep the backend command above running and in another terminal:

```sh
cd frontend
VITE_USE_FRONTEND_MOCK=false VITE_API_PROXY_TARGET=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The verification session used `PATH=/tmp/ecoagent-node24/node_modules/node/bin:$PATH` before npm commands, a temporary Node 24 installation that left frontend package files unchanged. Another pre-existing server on IPv6 localhost:5173 was left untouched; use the explicit `127.0.0.1` URL for this session.

## Configuration and secrets

The backend loads **root `.env`**, with process environment taking precedence. `api.env` is not loaded; `api.env.example` from the teammate is reference-only. `.env.example` is the authoritative template. All secret files and databases are ignored by Git. Never paste keys into chat, React, `VITE_*`, URLs, or source files.

Defaults are safe and explicit:

```dotenv
LIVE_ENABLED=false
BENCHMARK_INFERENCE_MODE=simulated
DATABASE_PATH=backend/data/ecoagent.sqlite3
```

Original comparison requests select `mode: demo|live`. The existing benchmark request has no mode field, so `BENCHMARK_INFERENCE_MODE=simulated|groq` selects its server adapter. `VITE_USE_FRONTEND_MOCK=false` selects real HTTP transport; it does **not** enable paid inference. Every backend run reports its provenance. Neither adapter silently substitutes simulated answers for live failures.

To configure Groq later, privately add `GROQ_API_KEY` to root `.env`, set `LIVE_ENABLED=true`, and set `BENCHMARK_INFERENCE_MODE=groq` only when you intend benchmark submissions to consume provider quota. Restart the backend. Defaults are:

```dotenv
GROQ_MODEL_SMALL=openai/gpt-oss-20b
GROQ_MODEL_LARGE=openai/gpt-oss-120b
INFERENCE_BASE_URL=https://api.groq.com/openai/v1
```

Legacy INFERENCE_API_KEY/SMALL_MODEL_ID/LARGE_MODEL_ID are fallback names when the corresponding GROQ_* variable is absent. Keys stay server-side. Capabilities only checks configuration; it never probes or proves provider connectivity. A billable smoke test still requires credentials and authorization.

Default limits: 20 requests/run, 60 provider requests/minute, 10 benchmark starts/minute, $0.50/run, $1.00/UTC day and a hard 30-second deadline per HTTP request. All knobs are in `.env.example`. Limits and conservative spending reservations persist in SQLite across restart. A request reserves full-context maximum input plus 256 output tokens; known usage reconciles the reservation. Unknown usage/failure retains it, so limits may block conservatively. Missing usage stays null in displayed metrics. Costs use the [Groq standard token rates](https://console.groq.com/docs/models) checked October 24, 2026; no external tools, retries or caching are requested. The adapter preserves the original shared `max_tokens: 256` wire setting, still documented as a deprecated compatible alias in [Groq's API reference](https://console.groq.com/docs/api-reference).

## Copyable frontend/backend handoff

Available comparison endpoints: GET health/capabilities/sample-tasks; POST runs; GET runs/{UUID}, all under `/api/v1`.

Available benchmark endpoints:

- `GET /api/v1/benchmarks/datasets`
- `GET /api/v1/benchmarks/runs?limit=20`
- `POST /api/v1/benchmarks/runs`
- `GET /api/v1/benchmarks/runs/{UUID}`
- `GET /api/v1/benchmarks/runs/{UUID}/cases?limit=50`

From the repository root, with the backend running:

```sh
curl -i http://127.0.0.1:8000/api/v1/benchmarks/runs \
  -H 'Content-Type: application/json' \
  --data-binary @contracts/examples/benchmark-start.json
```

Poll the returned Location until terminal, then GET `Location/cases`. The default run is explicitly simulated. Muffin's existing client works unchanged: keep frontend mocks false, open Benchmarks, submit, and inspect history/cases. One cross-view limitation remains: the comparison UI cannot reopen an active benchmark from a 409; switch to Benchmarks/history. Coordinate an `active_run_kind` navigation improvement with Muffin before editing frontend source.

For the original comparison:

```sh
curl -i http://127.0.0.1:8000/api/v1/runs \
  -H 'Content-Type: application/json' \
  --data-binary @contracts/examples/create-run.json
```

## Checks

```sh
.venv/bin/python -m pytest -q
uv pip check --python .venv/bin/python
.venv/bin/python backend/tests/smoke_http.py
.venv/bin/python backend/tests/smoke_benchmarks.py
npm run typecheck --prefix frontend
npm test --prefix frontend
VITE_USE_FRONTEND_MOCK=false npm run build --prefix frontend
```

The HTTP smoke scripts create temporary loopback servers/databases, force simulated mode, abruptly stop only their own subprocesses, and verify persisted results/recovery. They require loopback bind permission. Automated provider tests use HTTPX MockTransport; they do not spend Groq credits. Normal application shutdown marks active jobs interrupted; abrupt termination is recovered on next startup. A disk/database outage can prevent a terminal snapshot until storage is restored and the service restarted.

The team deadline is October 25, 2026 at **9 AM Eastern**. Keep the verified simulated walkthrough available while validating any optional real-provider run.
