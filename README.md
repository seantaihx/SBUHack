# EcoAgent

SBUHacks inference comparison and benchmark prototype. Deterministic simulation stays available without credentials. Energy/carbon coefficients are illustrative, and token-priced API costs are estimates, not provider bills or measured emissions.

## Implemented and verified

- Existing `/api/v1` comparison API: exact schemas, deterministic demo, SQLite snapshots, paired aggregates, one-worker gate, safe failures and restart recovery.
- Source import APIs for pasted text, text-based PDF, UTF-8 CSV, and public webpage extraction; immutable snapshots, input references, explicit Live confirmation, and SSRF-aware URL retrieval. Scanned PDF OCR and validated answer citations are unsupported.
- Expanded benchmark catalog: stable five-case `starter-v1`, 26-case `starter-v2` (including writing and code-generation prompts), effective case limits, completion/truncation status, and a self-contained JSON analysis export. All fixture checks are synthetic and deterministic, not semantic model evaluations.
- Task-specific Live instructions, deterministic label/JSON checks, optional one-time large-model escalation after an eligible validation failure, and attempt-level metrics. These checks do not establish semantic correctness.
- Opt-in local workspace agent for bounded writing/code tasks. Exact-path file reads/writes each require separate approval; operations are loopback-only, manually continued, step-limited, and have no shell/network/code execution.
- Groq-compatible HTTP adapter for GPT-OSS small/large and an explicitly marked Qwen Preview benchmark model with published pricing. Usage/timing, estimated cost, hard timeout, truncation status and sanitized errors are recorded. Tested with mocked HTTP responses; **real Groq inference and account access have not been tested**.
- Teammate's unchanged React frontend integrated from main `a7e3767`; real HTTP browser walkthrough passed using simulated backend inference, through both Vite and the production frontend served by FastAPI.

Shared specification: [original architecture](docs/01-product-and-architecture.md), [comparison semantics](docs/02-api-and-data.md), [accepted benchmark contract](docs/API_CONTRACT.md), [OpenAPI](contracts/openapi.json), [handoff and verification](docs/backend-handoff.md). Original v1 schemas/fixtures are preserved; benchmark schemas/examples are additive. The workspace agent is a separate opt-in, loopback-only prototype; its execution is approval-gated and it has no shell or network tools.

## Setup and launch on Windows

Use PowerShell from the repository root. `npm.cmd` avoids the PowerShell script execution policy that can block `npm.ps1`.

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci --prefix frontend
$env:VITE_USE_FRONTEND_MOCK = "false"
npm.cmd run build --prefix frontend
$env:LIVE_ENABLED = "false"
$env:BENCHMARK_INFERENCE_MODE = "simulated"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Open [EcoAgent](http://127.0.0.1:8000). The backend serves `frontend/dist`. Use one backend worker for SQLite run coordination. To develop the UI, keep the backend running and open another PowerShell terminal:

```powershell
cd frontend
$env:VITE_USE_FRONTEND_MOCK = "false"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8000"
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

## Setup and launch on macOS/Linux

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
AGENT_ENABLED=false
AGENT_WORKSPACE_ROOT=
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

The local workspace agent also requires `AGENT_ENABLED=true`, `AGENT_WORKSPACE_ROOT` set to the precise local directory, and working Live inference. Keep it disabled unless you intentionally want to submit instructions and approved file contents to the configured provider. It only accepts loopback requests, and each file read/write needs a separate approval. It does not run shell commands or generated code. Do not expose it through a public deployment.

Default limits: 20 requests/run, 60 provider requests/minute, 10 benchmark starts/minute, $0.50/run, $1.00/UTC day and a hard 30-second deadline per HTTP request. `INFERENCE_MAX_COMPLETION_TOKENS` defaults to 65,536 and accepts 1–65,536. The backend clamps this to known model ceilings (GPT-OSS: 65,536; Qwen 3.8 27B: 16,384) and sends `max_completion_tokens`. All knobs are in `.env.example`. Limits and conservative spending reservations persist in SQLite across restart. Each request reserves full-context maximum input plus the model-bounded completion cap; known usage reconciles the reservation. Unknown usage/failure retains it, so limits may block conservatively. Missing usage stays null in displayed metrics. Costs use the [Groq standard token rates](https://console.groq.com/docs/models) checked October 24, 2026. No automatic retry or fallback is used; a `length` finish reason stays marked incomplete. The adapter uses Groq's current `max_completion_tokens` field from [the API reference](https://console.groq.com/docs/api-reference).

`BENCHMARK_MAX_CASES` defaults to 10, bounded by the dataset and paired request cap. `BENCHMARK_EXTRA_MODEL_IDS` defaults to `qwen/qwen3.8-27b`; it is marked Preview and provider account access is not probed. Remove it from the environment if you do not want the option.

Source parsing limits and retention are documented in [the API contract](docs/API_CONTRACT.md). Unbound previews expire after 30 minutes; source text attached to a run remains in that local SQLite database. This prototype has no authentication, source cleanup, OCR, or validated answer citations. Do not submit confidential or regulated documents or webpages.

## Copyable frontend/backend handoff

Available comparison endpoints: GET health/capabilities/sample-tasks; POST runs; GET runs/{UUID}, all under `/api/v1`.

Source endpoints: POST `/api/v1/sources/text`, POST `/api/v1/sources/files`, POST `/api/v1/sources/webpage`, GET/DELETE `/api/v1/sources/{UUID}`.

Available benchmark endpoints:

- `GET /api/v1/benchmarks/datasets`
- `GET /api/v1/benchmarks/datasets/{dataset_id}`
- `GET /api/v1/benchmarks/runs?limit=20`
- `POST /api/v1/benchmarks/runs`
- `GET /api/v1/benchmarks/runs/{UUID}`
- `GET /api/v1/benchmarks/runs/{UUID}/cases?limit=50`
- `GET /api/v1/benchmarks/runs/{UUID}/export`

From the repository root, with the backend running:

```sh
curl -i http://127.0.0.1:8000/api/v1/benchmarks/runs \
  -H 'Content-Type: application/json' \
  --data-binary @contracts/examples/benchmark-start.json
```

Poll the returned Location until terminal, then GET `Location/cases`. The default run is explicitly simulated. Keep frontend mocks false, open Benchmarks, submit, and inspect history/cases or download the JSON analysis. Comparison and benchmark 409 responses include the active run kind so the frontend can navigate without submitting a duplicate.

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

Windows PowerShell checks use `.\.venv\Scripts\python.exe -m pytest -q backend/tests`, `npm.cmd run typecheck --prefix frontend`, `npm.cmd run test --prefix frontend`, and `$env:VITE_USE_FRONTEND_MOCK="false"; npm.cmd run build --prefix frontend`. `npm ci` requires the checked-in `frontend/package-lock.json`; use `npm.cmd` when PowerShell blocks `npm.ps1`.

The team deadline is October 25, 2026 at **9 AM Eastern**. Keep the verified simulated walkthrough available while validating any optional real-provider run.
