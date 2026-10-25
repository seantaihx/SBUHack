# EcoAgent

EcoAgent compares a fixed baseline model policy with task-aware routing. It records the outputs and available usage and timing data, then displays illustrative energy and carbon estimates. A React interface connects to a FastAPI backend that supports deterministic simulated runs and optional provider-backed inference.

The app also includes benchmark runs, text/PDF/CSV/webpage source import, provider settings, and an opt-in local workspace agent with approval-gated file actions. See [limitations and safety](#limitations) before using Live inference or the workspace agent.

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

- Energy and carbon values are estimates based on illustrative coefficients; they are not measured electricity or verified emissions.
- Simulated runs and lexical benchmark checks do not establish model quality or semantic correctness. Inspect paired outputs.
- Provider usage and cost figures depend on provider-reported data and configured price catalogs. Real provider access has not been verified by the presence of a model option or saved key.
- The service has no user authentication. Keep it local; do not expose provider settings or the workspace agent publicly.
- Source snapshots persist in the local SQLite database. Do not submit confidential or regulated material.

## Further reading

- [API contract](docs/API_CONTRACT.md) and [OpenAPI schema](contracts/openapi.json)
- [Hackathon demo guide](docs/HACKATHON_DEMO.md)
- [Feature acceptance checklist](docs/FEATURE_ACCEPTANCE_TESTS.md)
- [Benchmark fixtures](benchmarks/README.md) and [demo fixtures](demo/README.md)
- [Environmental estimate notes](docs/ECO_IMPACT_FEATURES.md)
- [Vite configuration example](frontend/.env.example)
