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
