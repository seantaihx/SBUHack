# Muffin progress checkpoint

**Checkpoint: WIP — 2026-10-24 (source selection shell added; no real parsing)**

## Current branch and safety

- Working tree began clean on `Muffin_branch` at `339408f` (`Prepare frontend comparison integration and review`).
- Fetched `origin`; `origin/main` is `c2768c3` and was not modified. `origin/Sean_branch` has advanced through `625e293`; no merge or checkout of Sean's work was performed.
- No API keys, `.env` files, private documents, or uploaded content were read into this handoff.

## Completed before this checkpoint

- Previous comparison/benchmark integration and manual JSON run snapshot export are present on the branch.
- JSON currently includes the loaded run snapshot and separates local human annotations; it still needs explicit top-level run ID/version metadata.

## This task's completed work

- Read the attached expansion requirements and inspected README, frontend setup, accepted API contract, OpenAPI/fixtures inventory, current source files, current main and remote branch heads.
- Drafted `docs/proposals/source-import-export.md`. It is **PROPOSED, not accepted**; no shared contract or backend file changed.
- Added JSON export metadata, one-row-per-attempt CSV with text-cell formula protection, and an explicitly labeled browser Print/Save as PDF report.
- Added 36-test coverage for exports, CSV quote/newline/Unicode handling, formula safety, null preservation, partial-run warnings, and UI download/print actions.
- Fetched real persisted simulated run `0aab1070-143a-4a37-96b0-4893c2dd12d0`; generated/reopened JSON and parsed six CSV attempt rows with 30 fields in `%TEMP%`.
- Added source selection UI for pasted text, PDF, CSV, and URL. API mode clearly reports source routes unavailable, does not upload/fetch, and disables comparison while a source is selected. Explicit fixture mode can load labeled synthetic PDF/CSV examples unrelated to any user file.

## Files / tests

- `docs/proposals/source-import-export.md` — proposed source routes, schemas, limits, errors, URL safety, run/source references, retention questions, and exact Sean decisions.
- `docs/handoffs/muffin-progress.md` — this checkpoint.
- `frontend/src/App.tsx`, `frontend/src/comparisonUtils.ts`, `frontend/src/styles.css` — export actions/report.
- `frontend/src/App.test.tsx`, `frontend/src/comparisonUtils.test.ts` — UI/format tests.
- `frontend/src/SourceInput.tsx`, `frontend/src/SourceInput.test.tsx`, `frontend/public/mock/source-preview.json` — guarded source UI and fixtures.
- `frontend/README.md`, `docs/FRONTEND_QA.md`, `docs/MOCK_DATA_INVENTORY.md` — format, source UI, and fixture verification notes.
- Commands run with `VITE_USE_FRONTEND_MOCK=false`: `npm.cmd run test` (42 passed), `npm.cmd run typecheck` (passed), and `npm.cmd run build` (passed).
- PDF output remains unverified; the implemented browser print flow is not a direct PDF download.
- Proposal checkpoint commit `d2d0e1b`, export milestone commit `46b367c`, checkpoint record `498dbaa`, and WIP source UI commit `7c69936` are pushed to `origin/Muffin_branch`.
- `Muffin_branch` is clean and up to date with its remote after `7c69936`.

## Unfinished work

1. Send Sean the proposed API document through the team's normal review path and collect decisions on source routes, limits, retention, and citation/run fields.
2. Open/reopen a browser-generated print report and visually check pagination when browser UI automation is available.
3. Continue not calling proposed source routes or changing backend/OpenAPI until Sean confirms the proposal.
4. After agreement, implement actual PDF/CSV parsing and source-backed API integration in a separate milestone.

## Contract status and blockers

- Existing text-only comparison v1 remains authoritative.
- Source import, URL retrieval, source snapshots/references, and source-grounded answer behavior are proposed only.
- Browser UI/print-dialog automation availability is not yet established for this checkpoint.
- No billable provider requests are authorized or planned.

## Exact next action

Ask Sean to review `docs/proposals/source-import-export.md`; preserve the current explicit API-unavailable guard until those decisions are agreed.

## Milestone 3 — source import and expanded analysis (October 24, 2026)

This milestone supersedes the earlier WIP checkpoint above. The user approved the source API proposal and authorized implementation on `Muffin_branch`. Backend/API and dataset changes are recorded in local commit `18b03b1`; frontend and handoff changes are recorded separately. Neither commit was pushed or merged.

### Implemented

- Backend source preview for pasted text, text-based PDF and UTF-8 CSV; public HTTP(S) webpage retrieval with DNS/redirect validation, pinned connections, byte/time limits, and safe errors. Source preview is explicit, rendered as text, and immutable. A separate confirmation is required to attach it to a Live run; the same untrusted source snapshot is supplied to both policies. Source metadata restores with a run; unbound previews expire after 30 minutes and bound text remains in the local SQLite database.
- Additive routes: `POST /sources/text`, `POST /sources/files`, `POST /sources/webpage`, `GET /sources/{id}`, `DELETE /sources/{id}`. Bound snapshots cannot be deleted independently.
- Expanded benchmark `starter-v2` with 24 synthetic cases, retained five-case `starter-v1`, effective per-run limits, preview model listing, truncation-aware evaluation, and a self-contained JSON export with dataset definitions and outcomes. The export marks a bounded run `partial` when it does not contain all authored cases.
- Updated typed frontend source integration, explicit fixture boundary, source confirmation, benchmark model/case selection and JSON download; regenerated OpenAPI and synchronized API examples/fixtures.
- Updated source/benchmark contract, mock inventory, QA and launch documentation. Older proposal sections are now labeled historical.

### Verification

- `.\.venv\Scripts\python.exe -m pytest -q backend/tests` — **139 passed**.
- `npm.cmd run typecheck --prefix frontend` — passed; `npm.cmd run test --prefix frontend` — **45 passed**; `VITE_USE_FRONTEND_MOCK=false npm.cmd run build --prefix frontend` — passed.
- Parsed every checked-in contract example, browser mock and benchmark JSON — **33 files passed**; `git diff --check` passed.
- Local HTTP integration used a temporary SQLite DB and forced `LIVE_ENABLED=false` plus simulated benchmark inference. Source POST/GET/DELETE passed; `starter-v2` catalog/definition loaded; a one-case run completed; export contained all 24 definitions and correctly reported partial coverage.
- A public fetch of `https://example.com/` succeeded through the webpage source route; the temporary preview was deleted.
- No browser automation surface was available for visual, responsive or keyboard walkthrough. No live provider call or billable inference was made. No screenshot was captured.

### Changed areas

Backend: `backend/app/sources.py`, comparison and benchmark routes/schemas/runner/store/provider/settings/pricing, pinned source parser dependencies, and regression tests. Frontend: `App`, `SourceInput`, `BenchmarkDashboard`, typed API client/types, fixtures and focused tests. Shared: `.env.example`, `README.md`, `contracts/openapi.json`, examples, `benchmarks/starter-v2.json`, `docs/API_CONTRACT.md`, benchmark/QA/inventory docs, the two proposal records, and `docs/ISSUES_TO_FILE.md`.

### Remaining limits

- Scanned/image-only PDFs are rejected; OCR is not included. Web pages are fetched as static HTML/plain text; JavaScript-rendered content, login, crawling, and search are unsupported.
- Extracted locators are not answer citations. The model does not return validated claim citations or an explicit not-found-in-source state.
- Dataset evaluators are synthetic exact/lexical checks; they do not establish semantic quality. Energy/carbon figures remain illustrative.
- Qwen is marked Preview. Real Groq account access and inference were not tested. The per-run maximum can be lower than ten when the selected model pair reaches request or spend safeguards.
- The screen and print-to-PDF layout have not had a visual browser walkthrough in this checkout. GitHub search found no matching open issues, but the connected integration denied issue creation with HTTP 403; copyable drafts are in [`../ISSUES_TO_FILE.md`](../ISSUES_TO_FILE.md).

### Launch and review commands (PowerShell)

```powershell
# Terminal 1: backend, with root .env for private configuration as needed
$env:DATABASE_PATH = (Join-Path (Get-Location) '.tmp-ecoagent-demo.sqlite3')
$env:LIVE_ENABLED = "false"
$env:BENCHMARK_INFERENCE_MODE = "simulated"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1

# Terminal 2: frontend with real API transport
$env:VITE_USE_FRONTEND_MOCK = "false"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8000"
npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5173

# Checks
.\.venv\Scripts\python.exe -m pytest -q backend/tests
npm.cmd run typecheck --prefix frontend
npm.cmd run test --prefix frontend
$env:VITE_USE_FRONTEND_MOCK = "false"
npm.cmd run build --prefix frontend
```

The runnable source requests and exact limits are documented in [`../API_CONTRACT.md`](../API_CONTRACT.md). Source-backed inference remains unavailable until the backend explicitly enables Live and configures a supported provider; the frontend does not silently switch modes.

## Milestone 4 (historical) — extend Live completion limit (October 24, 2026)

The provider truncation report came from the old fixed 256-token completion cap. Live requests now use Groq's current `max_completion_tokens` parameter. The backend setting `INFERENCE_MAX_COMPLETION_TOKENS` defaults to 2048 and accepts 1–16384. Baseline, optimized, and benchmark attempts share the backend setting. `finish_reason=length` remains visible as incomplete and is never silently accepted or automatically retried.

The budget guard reserves 131072 input tokens plus the configured completion cap for every Live call. Benchmark admission uses the same configured cap when returning its allowed case maximum; increasing the token limit can reduce cases per run or be blocked by existing spend limits. No spending limit was raised.

Changed: `backend/app/settings.py`, `backend/app/providers/live.py`, `backend/app/benchmarks/service.py`, focused provider/benchmark tests, `.env.example`, README, architecture/API contract docs, and the frontend truncation warning.

Verification: **145 backend tests passed**, **45 frontend tests passed**, frontend typecheck and production build passed. Live tests used HTTPX MockTransport only; no key was read and no provider request was sent. The maximum-token parameter is covered by wire and reservation tests. The existing build output remains ready; no browser screenshot was taken for this backend setting change.

To raise the cap for a local Live run, set `INFERENCE_MAX_COMPLETION_TOKENS=4096` in the backend's private root `.env`, confirm that value is below the selected model's provider limit, and restart the backend. Do not put it in a `VITE_*` variable. The default 2048 should already prevent the common 256-token cutoff.

## Milestone 5 — raise default to current model output ceilings (October 24, 2026)

The user reported that responses still reached the 2048-token cap. The default is now **65,536** with configurable range 1–65,536. Known Groq model caps are applied before requests and reservations: GPT-OSS 20B/120B at 65,536 and Qwen 3.8 27B at 16,384. Benchmark budget calculations use the same per-model effective cap. The warning recommends shorter requests or a model with more output capacity instead of suggesting a setting increase that may exceed the selected model's ceiling.

The effective setting after this update is 65,536, with no environment override in the current shell. The backend process already listening on port 8000 was started before this update and must be restarted to load the new default. I left that user process running. No provider request was sent.

To apply it locally: stop the old backend with Ctrl+C, then from the repository root run:

```powershell
$env:INFERENCE_MAX_COMPLETION_TOKENS = "65536"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

The explicit setting overrides any stale shell value. Do not place it in a `VITE_*` variable.

Verification after this change: **146 backend tests passed**, **45 frontend tests passed**, typecheck and production build passed. Added tests verify provider-specific limits, wire payload, reservation amount, and cost-based benchmark case caps. Live-disabled benchmark requests return the backend's 503 reason before budget preflight.

Hard provider/context limits still exist, so an unusually long response can still return `finish_reason=length`. The UI keeps such output marked incomplete; no unsafe automatic continuation is added.

## Milestone 6 — judge-feedback reliability, setup and demo readiness (October 24, 2026)

Implemented the approved first reliability milestone on `Muffin_branch`; changes remain uncommitted and unpushed. Backend and frontend changes are separated into their respective directories, with additive shared fields in OpenAPI/API documentation.

### Implemented

- Workspace Agent now persists checkpoints, resumes only after an explicit user continuation, supports up to 20 bounded model calls subject to provider limits, fingerprints repeated actions against file state, allows changed-file rereads, pauses no-progress writes, applies bounded completion checks, and stops after repeated identical provider failures. File reads/writes remain exact-path scoped and require individual approval; shell, network, deletion, code execution, Git, deployment and permission changes are not available.
- Added `benchmarks/agent-reliability-v1.json` and regression coverage for longer bounded work, repeated/no-progress actions, changed-file rereads, explicit transient recovery, forbidden actions, and unverified completion. These are synthetic protocol cases, not evidence of semantic quality or live model performance.
- Added local Provider settings for the backend-only Groq key. The same-origin loopback routes save to the ignored root `.env` and return only boolean setup status. The field is disabled if setup is unavailable or a process-level key overrides `.env`; the browser never persists or returns the key.
- Added/fixed focused accessible UI and pixel-lab styling, provider-dialog phone scrolling, reduced-motion CSS, status announcements, and explicit provenance/error states. Added a safe explanation when the running backend is older than this branch.
- Added demo/presentation and truthful Devpost drafts. Updated prior browser-verification statements to distinguish inspected screens from saved submission screenshots.

### Verification actually run

- `npm.cmd test --prefix frontend` — **50 passed**.
- `npm.cmd run typecheck --prefix frontend` — passed.
- `npm.cmd run build --prefix frontend` — passed.
- `.\.venv\Scripts\python.exe -m pytest -q backend/tests --basetemp=.tmp-pytest-final` — **172 passed**. This includes local settings checks for a loopback status read without `Origin`, rejection of cross-origin status requests, and strict Origin enforcement on key writes. The sandboxed Windows asyncio `TestClient` could not create its local socket pair; the same suite passed when run with local socket access. Temporary test directories were removed afterward.
- `git diff --check` — passed; Git printed only its normal LF-to-CRLF working-copy notices.
- Browser visually inspected at desktop and 320px width: comparison, completed benchmark result, source rejection, completed agent safety screen and provider setup error. Keyboard Tab showed visible focus on the skip link and logo; frontend coverage also opens a pending write preview and activates its exact-action approval with Enter. The provider-key test confirms the password field clears before its request resolves. No pending approval was available to show manually in the browser; no provider request or new agent run was started. No Devpost screenshots were saved.

### Integration status and next check

At the time this milestone was recorded, the browser was connected to an older backend process that returned 404 for `GET /api/v1/local-settings/provider`; this was later resolved by restarting/reloading the backend. Milestone 7 records the current successful browser verification of provider settings against the updated backend. After restart, status reads require loopback caller/Host checks and validate Origin when present; key-saving `PUT` always requires a matching Origin. A webpage test using `http://127.0.0.1/` was rejected as a non-public-network target; the UI showed the safe rejection. No Live model inference was tested and no key was read or sent.

After restarting the backend from this branch, verify `GET /api/v1/local-settings/provider`, then verify the setup UI with a disposable test key only if the team explicitly wants to exercise writing the ignored `.env`. Keep `LIVE_ENABLED=false` and `AGENT_ENABLED=false` for the default simulated comparison/demo. The frontend fixtures remain available only under explicit `VITE_USE_FRONTEND_MOCK=true` and are labeled; request failures do not silently switch to them.

### Files changed in this milestone

Backend: `backend/app/agent_schemas.py`, `backend/app/agents.py`, `backend/app/main.py`, `backend/app/schemas.py`, `backend/app/store.py`, `backend/app/local_settings.py`, and the associated API/agent/local-settings tests. Contract/data: `contracts/openapi.json`, `docs/02-api-and-data.md`, `docs/API_CONTRACT.md`, and `benchmarks/agent-reliability-v1.json`. Frontend: `frontend/index.html`, `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/AgentDashboard.tsx`, `frontend/src/AgentDashboard.test.tsx`, `frontend/src/BenchmarkDashboard.tsx`, `frontend/src/SourceInput.tsx`, `frontend/src/SourceInput.test.tsx`, `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `frontend/src/main.tsx`, `frontend/src/test-setup.ts`, `frontend/src/ProviderKeySettings.tsx`, `frontend/src/agent-reliability.css`, `frontend/src/pixel-lab.css`, and `frontend/src/provider-settings.css`. Project/demo docs: `README.md`, `docs/AGENT_RELIABILITY.md`, `docs/DEVPOST_DRAFT.md`, `docs/HACKATHON_DEMO.md`, `docs/IMPLEMENTATION_IMPROVEMENTS_PROMPT.md`, `docs/handoffs/agent-reliability-proposal.md`, and this checkpoint.

## Milestone 7 — multi-provider Workspace Agent models (October 25, 2026)

Expanded Workspace Agent model assignment from Groq-only to per-role choices across Groq, OpenAI, Gemini, Anthropic Claude, and local Ollama. Agent-only provider-qualified IDs (`provider::model-id`) keep each role's selection unambiguous. The comparison and benchmark configurations remain on their existing Groq settings. No provider credentials were read out, printed, or sent to an inference service during this work.

Hosted provider credentials are independently stored in ignored root `.env` (`GROQ_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`). The new same-origin loopback route is `PUT /api/v1/local-settings/provider-keys/{provider}` with `{"api_key":"…"}`; old Groq route remains compatible. Responses contain key-free status booleans only. `GET /api/v1/local-settings/provider` reports status without values. `GET /api/v1/local-settings/agent-models` returns supported IDs and labels; `PUT /api/v1/local-settings/agent-models` saves per-role selections to `ECOAGENT_AGENT_MODEL_MANAGER`, `..._WRITER`, `..._CODER`, and `..._REVIEWER`. Existing `GROQ_AGENT_MODEL_*` assignments still load as legacy fallbacks. Restart the backend after changing `.env`.

Ollama is local-only: calls go to `http://127.0.0.1:11434/v1` by default, and configuration rejects non-loopback URLs. No Ollama API key is collected. Zero provider token fee does not mean zero electricity or total cost; those remain unavailable. Provider/catalog prices feed the existing spend checks; no claim is made that model/account availability was probed.

### Verification actually run

- `.\.venv\Scripts\python.exe -m pytest backend/tests -q` — **194 passed** (final fresh run).
- `npm.cmd run test --prefix frontend` — **55 passed**.
- `npm.cmd run typecheck --prefix frontend` — passed.
- `npm.cmd run build --prefix frontend` — passed.
- `git diff --check` — passed with only existing Git LF-to-CRLF notices.
- Browser at `http://127.0.0.1:5173/`: opened Provider Settings against the running backend, observed all five provider choices in the role model menus, and selected Ollama to confirm local setup instructions and absence of a key input. Provider status displayed only booleans/labels. No screenshot was saved.
- MockTransport tests verified OpenAI and Gemini `/chat/completions`, Anthropic `/messages` including finish reason/token usage, and local Ollama request URL/no auth header. Local API tests verified each hosted key writes to its provider-specific `.env` name without appearing in responses; Ollama key saves are rejected; provider-qualified role assignments persist.
- No real hosted inference call was made. Live model access/pricing/account permissions are not end-to-end verified. The backend Agent remains subject to `AGENT_ENABLED=true`, `LIVE_ENABLED=true`, a scoped workspace root, per-action approval and configured spend/token limits.

### Changed for this provider milestone

`backend/app/model_catalog.py`, `backend/app/pricing.py`, `backend/app/settings.py`, `backend/app/providers/live.py`, `backend/app/local_settings.py`, `backend/app/schemas.py`, `backend/app/main.py`, backend provider/local-settings tests, `frontend/src/ProviderKeySettings.tsx`, `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `.env.example`, `contracts/openapi.json`, `README.md`, `docs/02-api-and-data.md`, `docs/API_CONTRACT.md`, `docs/FEATURE_ACCEPTANCE_TESTS.md`, `docs/HACKATHON_DEMO.md`, and this handoff.

Launch frontend: `npm.cmd run dev --prefix frontend`. Launch backend from repository root: `.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1`. Use real backend transport (`VITE_USE_FRONTEND_MOCK=false`). Models/keys newly saved in `.env` require backend restart. Existing fixtures still only work when explicit mock mode is enabled; none of the provider paths silently switches to fixtures.

## Milestone 8 — model choices for comparisons and benchmarks (October 25, 2026)

Extended the existing provider catalog into Live comparisons and benchmarks. `GET /api/v1/capabilities` now returns `supported_models`. `POST /api/v1/runs` accepts optional `small_model_id` and `large_model_id`; they set provider models for the small/large backend-selected roles, and the run snapshots both IDs. The frontend only chooses role assignments; it still renders backend-selected routes and reasons. Benchmark datasets expose the shared catalog, `BENCHMARK_INFERENCE_MODE=live` dispatches selected provider calls, and legacy `groq` mode remains a live alias. Selected providers are preflighted for keys before accepting requests; no inference runs when a required key is absent. Local Ollama selections have no hosted token fee, and local energy remains unavailable.

The Workspace Agent team panel now identifies the Manager as the approved plan owner ahead of the serial specialist flow, using the actual manager assignment, approval state and backend workflow task statuses. Its provider note now explains provider-specific backend keys and local Ollama. This borrows the reference project's visible team/task log concept from [Agent Office](https://github.com/harishkotra/agent-office), while preserving EcoAgent's approval gates and avoiding invented autonomous movement or unapproved tools.

### Verification actually run

- `\.venv\Scripts\python.exe -m pytest backend/tests -q` — **196 passed**.
- `npm.cmd run typecheck --prefix frontend` — passed.
- `npm.cmd run test --prefix frontend` — **56 passed** (includes the Live role model submission interaction).
- `npm.cmd run build --prefix frontend` — passed before adding the interaction check (the check does not change production code).
- `git diff --check` — passed; Git only emitted its normal line-ending notices.
- Mocked backend tests verified Live comparison requests use and persist selected OpenAI/Anthropic role IDs, benchmark catalogs expose OpenAI/Gemini/Anthropic/Ollama options, and a missing Anthropic key is rejected before dispatch. No hosted provider traffic or API keys were used.
- Browser preview showed the current Compare page against the running local backend, but Live is disabled there, so I did not claim to inspect the Live selectors or perform a real provider end-to-end check.

### Changes for this milestone

`backend/app/settings.py`, `backend/app/main.py`, `backend/app/runner.py`, `backend/app/benchmarks/service.py`, `backend/tests/test_api.py`, `backend/tests/test_benchmarks.py`, `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/BenchmarkDashboard.tsx`, `frontend/src/AgentDashboard.tsx`, `frontend/src/api/types.ts`, `frontend/src/styles.css`, `.env.example`, `contracts/openapi.json`, `contracts/examples/capabilities.json`, `contracts/examples/run-*.json`, `frontend/public/mock/capabilities.json`, `frontend/public/mock/run-*.json`, `docs/API_CONTRACT.md`, `docs/02-api-and-data.md`, `README.md`, and this handoff.

## Milestone 9 — identify and stop an active comparison or benchmark (October 25, 2026)

Added `GET /api/v1/active-run` to expose the active run ID, kind, and status, plus `POST /api/v1/active-run/stop`. The stop endpoint accepts an optional `run_id`: a supplied ID must still match the active run, while an empty body stops whichever run is active at request handling time. This lets the explicit Stop active run action work even when conflict metadata or lookup is unavailable. Comparison and benchmark cancellation preserve already recorded attempts, return `cancelled`, and free the shared active slot. A no-longer-active run cannot be changed by a stale ID. Conflict handling still never repeats the original submission.

### Verification actually run

- `\.venv\Scripts\python.exe -m pytest -q` — **198 passed**.
- `npm.cmd test --prefix frontend` — **58 passed**, plus a focused fallback Stop test passed.
- `npm.cmd run typecheck --prefix frontend` — passed.
- `npm.cmd run build --prefix frontend` — passed.
- `git diff --check` — passed; Git emitted only existing LF-to-CRLF notices.
- OpenAPI contract response-schema/example checks — **19 passed**.
- Attempted to verify the listener on `127.0.0.1:8000`: it still serves the older app and returns 404 for `/api/v1/active-run`; a second Uvicorn process cannot bind because port 8000 is occupied. Restart the existing backend process to expose these new endpoints. No provider request was sent.

### Changed for this milestone

`backend/app/schemas.py`, `backend/app/store.py`, `backend/app/main.py`, `backend/app/runner.py`, `backend/app/benchmarks/service.py`, `backend/tests/test_api.py`, `backend/tests/test_benchmarks.py`, `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/BenchmarkDashboard.tsx`, `frontend/src/BenchmarkDashboard.test.tsx`, `contracts/openapi.json`, `docs/API_CONTRACT.md`, `docs/02-api-and-data.md`, and this handoff.
