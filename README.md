# EcoAgent

EcoAgent compares a fixed large-model baseline with an AI-routed candidate. In live benchmarks, a bounded router-model call selects the configured small or large model for each task; simulated runs use an explicitly labeled routing fixture. It records the outputs and available usage and timing data, then displays illustrative energy and carbon estimates. A React interface connects to a FastAPI backend that supports deterministic simulated runs and optional provider-backed inference.

The app also includes benchmark runs, text/PDF/CSV/webpage source import, provider settings, and an opt-in local workspace agent with approval-gated file actions. See [limitations and safety](#limitations) before using Live inference or the workspace agent.

## For judges: the five-minute version

**EcoAgent helps developers test whether a smaller model can handle a task before spending a larger model's resources.** It compares a fixed baseline with task-based routing, shows both answers, and exposes usage, timing, and environmental assumptions so the tradeoff can be reviewed.

Use **three minutes for the pitch and demo, then two minutes for Q&A**. The [word-for-word judge script](docs/JUDGE_WALKTHROUGH.md) includes click instructions, fallback options, and short answers to likely questions. Start with Compare in Demo mode; show Benchmarks next. Demonstrate the Workspace Agent only if its Live setup has already been rehearsed.

## Features and current completeness

Status means implementation and local verification, not production certification. See the [readiness and debugging review](docs/READINESS_REVIEW.md) for evidence and remaining checks.

| Feature | What works now | Completeness / boundary |
|---|---|---|
| Policy comparison | Paired outputs, model IDs, routing reasons, usage, latency, progress, stop, run restoration | Core simulated path verified over HTTP. Baseline uses large; optimized classify/extract use small, summarize/write/code use large. |
| Live inference | Hosted-provider adapters and local Ollama; selectable small/large routes | Implemented and tested with fake transports; real provider/model access needs a smoke test on the demo machine. |
| Quality checks and fallback | Label/JSON constraints; optional single large-model escalation for eligible small-model failures | Deterministic checks work; no general semantic quality guarantee. |
| Benchmark lab | starter-v1 (5 cases), starter-v2 (40 cases), fixed or AI auto-route candidates, case results, history, analysis export | Live auto-route includes a separate router call; simulated runs use fixtures. Hard cap: 20 cases, subject to request and spend budgets. Lexical checks do not establish general accuracy. |
| Source import | Text, text-selectable PDF, CSV, public webpage preview and source snapshots | Automated coverage; source-grounded inference requires Live. No OCR or JavaScript webpage rendering. |
| Review and exports | Answer search/copy, local human review labels, JSON/CSV export, browser Print / Save PDF | Automated UI coverage; final browser/download rehearsal still needed. |
| Environmental views | Illustrative energy/carbon, footprint map, scenario slider, local ledger and informational target | Implemented; estimates are not measured emissions and the target does not enforce a budget. |
| Local GPU telemetry | Optional NVIDIA power sampling for local Ollama comparisons, device energy and throughput fields | Hardware-dependent, not exercised in this review. Measures a whole GPU during the call, including other activity; not whole-system or per-request-exclusive energy. |
| Workspace Agent | Exact file scopes, approval previews, pause/continue/stop, completion checks, logs and durable handoff | Automated coverage including restart recovery; opt-in Live demonstration needs rehearsal. No shell or code execution. |
| Manager workflow | Manager plans Writer/Coder/Reviewer tasks with dependencies, role models, bounded usage and review | Implemented and tested with fake inference; specialists execute serially. Model review is not independent proof of correctness. |
| Provider settings | Backend-only key storage and role-model assignments | Local setup only; restart required. A saved key does not verify access. |
| Production deployment | Local React/FastAPI/SQLite prototype | Not production-ready: no user authentication or multi-tenant isolation; use one backend worker. |

## Repository layout

- `backend/` — FastAPI application, provider adapters, SQLite storage, benchmarks, and tests.
- `frontend/` — React, TypeScript, and Vite application.
- `contracts/` — OpenAPI contract and example requests/responses.
- `benchmarks/` and `demo/` — versioned benchmark datasets and deterministic demo fixtures.
- `docs/` — API reference, feature notes, demo guidance, and acceptance checklist.

## Requirements

- Python 3.11 or newer.
- Node.js version supported by the frontend dependencies (Node 24 was used for verification).
- PowerShell on Windows, or a POSIX shell on macOS/Linux.

## Install and run

From the repository root, create a virtual environment and install backend dependencies:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci --prefix frontend
```

Build the frontend and launch the backend with safe defaults (simulated inference and Live disabled):

```powershell
$env:VITE_USE_FRONTEND_MOCK = "false"
npm.cmd run build --prefix frontend
$env:LIVE_ENABLED = "false"
$env:BENCHMARK_INFERENCE_MODE = "simulated"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Run a single backend worker because SQLite coordinates active jobs. `frontend/dist` is served by FastAPI after it has been built.

For UI development, leave the backend running and start Vite in a second terminal:

```powershell
cd frontend
$env:VITE_USE_FRONTEND_MOCK = "false"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8000"
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

On macOS/Linux, create the environment with `python3 -m venv .venv`, install using `.venv/bin/python -m pip install -r backend/requirements.txt`, and replace `npm.cmd` with `npm`. Run the server with `.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1`.

## Configuration

The backend loads the repository-root `.env`; process environment values take precedence. Start from the safe defaults in [`.env.example`](.env.example). The application works in simulated mode without provider credentials. For Live comparison or benchmarks, configure a supported provider key on the backend, deliberately enable `LIVE_ENABLED=true`, and set `BENCHMARK_INFERENCE_MODE=live` when benchmark calls should use providers. Provider calls can incur charges.

Never put credentials in frontend `VITE_*` variables, source code, or URLs. The local Provider Settings screen sends keys to the same-computer backend, which saves them to the ignored root `.env`; restart the backend after saving. Saving a key alone does not enable Live inference.

The local workspace agent is off by default. It requires `AGENT_ENABLED=true`, a precise `AGENT_WORKSPACE_ROOT`, configured Live inference, and explicit approval for each file action. Keep it bound to loopback and use only a disposable workspace for demonstrations.

## Main API routes

All routes use the `/api/v1` prefix. The complete request and response schemas are in [`contracts/openapi.json`](contracts/openapi.json) and the [API contract](docs/API_CONTRACT.md).

- `GET /health`, `/capabilities`, `/sample-tasks`
- `POST /runs`, `GET /runs/{run_id}` — comparison runs
- `/sources/text`, `/sources/files`, `/sources/webpage`, `/sources/{source_id}` — source import and snapshots
- `/benchmarks/datasets`, `/benchmarks/runs` — benchmark catalog and runs
- `/agent-runs`, `/agent-workflows` — optional local workspace agent

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd run typecheck --prefix frontend
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
```

Run equivalent commands on macOS/Linux with `.venv/bin/python` and `npm`.

## Limitations

- Coefficient-based energy and carbon values are illustrative estimates, not verified emissions. Optional local NVIDIA telemetry is separate: it measures whole-device power during an Ollama call, includes idle/other workloads, and excludes CPU, memory, and the rest of the system. Hosted-provider energy remains unmeasured.
- Simulated runs and lexical benchmark checks do not establish model quality or semantic correctness. Inspect paired outputs.
- Provider usage and cost figures depend on provider-reported data and configured price catalogs. Real provider access has not been verified by the presence of a model option or saved key.
- The service has no user authentication. Keep it local; do not expose provider settings or the workspace agent publicly.
- Source snapshots persist in the local SQLite database. Do not submit confidential or regulated material.

## Further reading

- [Five-minute judge script](docs/JUDGE_WALKTHROUGH.md) and [readiness/debugging review](docs/READINESS_REVIEW.md)

- [API contract](docs/API_CONTRACT.md) and [OpenAPI schema](contracts/openapi.json)
- [Hackathon demo guide](docs/HACKATHON_DEMO.md)
- [Feature acceptance checklist](docs/FEATURE_ACCEPTANCE_TESTS.md)
- [Benchmark fixtures](benchmarks/README.md) and [demo fixtures](demo/README.md)
- [Environmental estimate notes](docs/ECO_IMPACT_FEATURES.md)
- [Vite configuration example](frontend/.env.example)
