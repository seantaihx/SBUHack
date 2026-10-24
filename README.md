# EcoAgent

SBUHacks prototype comparing a fixed large-model baseline with task-based model routing. Demo inference is deterministic and simulated. Energy/carbon values use disclosed hypothetical coefficients; they are not measured emissions or evidence of equivalent answer quality.

## Status and shared specification

The approved kit now lives at the repository root. The API contract and fixtures are unchanged from the kit on main. Sean owns the backend; Muffin owns the frontend. The first backend milestone exposes a working offline one-task comparison. Actual frontend integration is pending; no frontend is present in this checkout. Live is explicitly disabled in this milestone, even if provider variables are set.

Read [product/architecture](docs/01-product-and-architecture.md), [API semantics](docs/02-api-and-data.md), [team workflow](docs/03-team-and-integration.md), [acceptance](docs/04-acceptance-and-demo.md), and [OpenAPI](contracts/openapi.json). The docs describe the full target; this README and [handoff](docs/backend-handoff.md) record implemented/verified behavior. Do not change contracts or fixtures without team coordination.

## Backend setup

Run from the repository root. Use Python 3.11 or newer (verified here with CPython 3.14.6). All resolved dependencies, including test dependencies, are pinned in `backend/requirements.txt`.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

If using uv, the equivalent environment/install commands are:

```sh
uv venv .venv --python /absolute/path/to/python3
uv pip install --python .venv/bin/python -r backend/requirements.txt
```

Use exactly one worker. The service stores runs in `backend/data/ecoagent.sqlite3`; override `DATABASE_PATH` in the server environment or root `.env`. Relative paths resolve against the repository. Environment values override `.env`. No provider credentials are needed. Never commit `.env`, database files, or provider keys, and never put a key in `VITE_*`. `.env.example` documents reserved live settings; they do not enable Live yet.

## Working endpoints

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `GET /api/v1/sample-tasks`
- `POST /api/v1/runs` (202 plus Location header)
- `GET /api/v1/runs/{run_id}`

Copyable one-task request:

```sh
curl -i http://127.0.0.1:8000/api/v1/runs \
  -H 'Content-Type: application/json' \
  --data '{"mode":"demo","tasks":[{"id":"classify-1","type":"classify","prompt":"Classify this support message as billing, technical, or general. Return one label only. Message: I was charged twice for my subscription."}],"carbon_intensity_g_per_kwh":400}'
```

GET the returned `Location` until terminal. Expect two `billing` outputs, baseline `large` and optimized `small`, `measurement_source: simulated`, and `energy_estimation_profile: illustrative-v1`. The initial POST snapshot is queued, and simulated execution waits 150 ms per attempt.

## Verification

```sh
.venv/bin/python -m pytest -q
uv pip check --python .venv/bin/python
.venv/bin/python backend/tests/smoke_http.py
```

The smoke script starts real Uvicorn on a temporary loopback port from `/tmp`, uses an isolated temporary SQLite database, sends a real HTTP request, and checks persistence after restarting. It needs permission to bind loopback. No live provider is called. Installation requires package access; the installed demo runs offline.

## Frontend integration handoff

Muffin: coordinate adoption of the root-level kit first, then run Vite on 5173 with `/api` proxied to `http://127.0.0.1:8000`. Use relative `/api/v1` URLs, fetch sample tasks, POST one exact sample, and poll the returned Location every 1000 ms with only one GET in flight. Show both outputs with simulated/illustrative labels. Do not automatically repeat a POST after a network failure; use `details.active_run_id` on 409. No CORS changes are needed for this proxy setup.

The milestone 1 team gate requires an actual UI-to-FastAPI walkthrough. Production `frontend/dist` serving and optional Live remain pending that gate; root `/` currently returns JSON 404. No frontend files are created by this backend work.

Deadline: October 25, 2026, **9 AM Eastern**. Reserve time for UI integration and submission; optional Live must not delay the offline demo.
