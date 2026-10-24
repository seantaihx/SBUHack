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
