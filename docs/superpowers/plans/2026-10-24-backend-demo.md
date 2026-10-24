# EcoAgent Backend Demo Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the exact v1 offline demo API and a copyable frontend integration handoff.

**Architecture:** FastAPI validates explicit Pydantic schemas. A single background worker executes baseline then optimized, persists JSON run snapshots in SQLite, and calculates paired comparisons. Fixtures resolve relative to the repository, not the current directory.

**Tech Stack:** Python 3.11+, FastAPI/Pydantic v2, Uvicorn, standard-library SQLite; pytest, HTTPX and jsonschema for verification. Pin every resolved dependency.

**Spec:** docs/01-product-and-architecture.md, docs/02-api-and-data.md, docs/03-team-and-integration.md, docs/04-acceptance-and-demo.md, contracts/openapi.json and demo/*.json.

## Global Constraints

- Work in the existing Sean_branch checkout; preserve original untracked files.
- Contract fields, demo inputs and coefficients remain unchanged.
- One active run, one Uvicorn worker, no secrets in responses or logs.
- Demo is simulated; energy coefficients are illustrative; null is not zero.
- Complete backend milestone 1 before milestone 2; optional live work waits for the actual frontend integration gate.
- No frontend edits, remote pushes, PR merges or deployment in this work.

## Review Focus

- Concurrent submissions must reserve one slot before HTTP 202.
- Shutdown/restart must not leave a run falsely completed or permanently block new runs.
- Malformed JSON and unknown API paths must return safe JSON errors.
- Zero and absent comparison data must remain distinguishable.
- Fixture loading must work from a different working directory.

### Task 1: Adopt foundation and expose a persisted one-task demo

**Files:** root README.md/.gitignore/.env.example; move kit docs/contracts/demo/prompts to root unchanged; backend/requirements.txt; backend/app/{main,schemas,settings,store,runner,policy,metrics}.py; backend/app/providers/demo.py; backend/tests/test_api.py.

**Interfaces:** `create_app(settings: Settings | None = None) -> FastAPI`; `Settings(database_path: Path)`; `Store.create(run)`, `Store.get(id)`, `Store.save(run)`; `Runner.submit(request) -> Run`; async `DemoProvider.execute(task, policy, role) -> InferenceResult`.

- [ ] Write contract-validation tests for metadata endpoints and the real one-task POST, poll, restart/GET cycle, with literal billing outputs and energy totals 0.0052/0.00104.
- [ ] Run `.venv/bin/python -m pytest -q`; expect missing app failure.
- [ ] Implement exact schemas, metadata routes, deterministic fixture provider, background execution, paired metrics, SQLite storage and sanitized API errors.
- [ ] Run the full suite and an actual Uvicorn HTTP cycle; expect schema-valid 202 followed by completed with two outputs and persistent GET.
- [ ] Record milestone 1 handoff and commit only owned/adopted files after validation.

### Task 2: Complete demo acceptance behavior

**Files:** backend/tests/test_api.py, backend/tests/test_execution.py, backend/app/{runner,store,metrics,main}.py; root setup/handoff documentation.

**Interfaces:** Task 1 interfaces; `ProviderError(code)` produces failed attempts; `compare(results) -> Comparison`; `Store.recover()` marks unfinished records failed/RUN_INTERRUPTED.

- [ ] Add tests for full fixture arithmetic 0.0434/0.02644 Wh and 4700/2750 ms; validation boundaries and exact fixture matching; concurrency; partial failures; missing usage; zero intensity; negative savings; job failure; restart recovery; unknown API paths and fixture loading from another cwd.
- [ ] Run new tests and confirm uncovered behavior fails, then implement the minimum missing behavior.
- [ ] Run `.venv/bin/python -m pytest -q`, `.venv/bin/python -m pip check`, and real HTTP smoke; expect all passing.
- [ ] Request an independent code review, fix material findings with regression tests, and record final handoff/versions/limits.
- [ ] Commit validated milestone 2 changes. Leave optional live and real frontend serving pending the frontend integration gate; no frontend exists yet.
