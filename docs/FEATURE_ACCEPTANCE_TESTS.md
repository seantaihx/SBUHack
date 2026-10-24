# EcoAgent feature acceptance test plan

Use this checklist to verify behavior, not just that the app builds. It covers features on `main` and the additional features on `Muffin_branch`. Run the branch-only checks on `Muffin_branch`; they are not present in `main` until merged.

## Test safety and result recording

- Start the API in simulated mode for routine checks. No real model provider calls are needed for the automated tests or Demo/benchmark simulation checks below.
- Real Live comparison, Live benchmark, and workspace-agent planning can send prompts/file contents to the configured provider and may use paid quota. Run those optional checks only with synthetic inputs and after checking the provider/account and spend limits.
- For agent UI testing, configure `AGENT_WORKSPACE_ROOT` to a disposable test directory outside the repository. Do not give the agent access to the real project, home directory, credentials, or private files for acceptance testing.
- Do not count a simulated fixture, lexical benchmark match, valid JSON, HTTP success, or a passing build as proof of semantic correctness or equal answer quality.

Record each manual case as `PASS`, `FAIL`, or `NOT RUN`, including branch, API version, browser/device, run ID (if applicable), and a screenshot or response excerpt with secrets removed.

## Automated test baseline

Run from the repository root on `Muffin_branch`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd run test --prefix frontend
npm.cmd run typecheck --prefix frontend
npm.cmd run build --prefix frontend
git diff --check
```

Expected: backend and frontend suites pass, type checking and production build exit successfully, and `git diff --check` reports no whitespace errors. These tests use fake/mock inference where relevant; they do not make paid provider calls or replace browser testing.

## Start a local simulated test session

Stop any old EcoAgent process on port 8000 first. In PowerShell terminal 1:

```powershell
cd "C:\Learning\SBU hack\Project\SBUHack"
$env:LIVE_ENABLED = "false"
$env:BENCHMARK_INFERENCE_MODE = "simulated"
$env:AGENT_ENABLED = "false"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

In terminal 2, from the repository root:

```powershell
$env:VITE_USE_FRONTEND_MOCK = "false"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8000"
npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. This uses real HTTP and the local backend, while inference remains deterministic/simulated. For the integrated presentation build, use `npm.cmd run build --prefix frontend` and open `http://127.0.0.1:8000` instead.

Initial API smoke checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/capabilities
Invoke-RestMethod http://127.0.0.1:8000/api/v1/sample-tasks
```

On `Muffin_branch`, health should report API `1.1.0`; capabilities should provide policy, supported task types and estimation assumptions. On `main`, expect the older API version and do not treat branch-only endpoints returning 404 as regressions in main.

## Feature-by-feature acceptance checklist

### A. Main comparison experience — Demo

1. Load the Compare page with `VITE_USE_FRONTEND_MOCK=false`.
   - **Pass:** API connection state is visible; sample tasks load from `/api/v1/sample-tasks`; Demo and Live availability come from `/api/v1/capabilities`.
2. Select the sample workload and Demo mode; start one comparison.
   - **Pass:** one POST is sent; submission disables while pending; no duplicate run is started by double click.
   - **Pass:** run progresses through queued/running to terminal status; a three-task run has one baseline and one optimized result per task (six rows/attempts), unless the backend returns a documented failure.
   - **Pass:** backend route/model choices appear in results. Baseline is large; optimized routing follows the backend policy.
   - **Pass:** output panels display plain text, including any HTML-looking content; no markup from model output is executed.
3. Check status and provenance labels.
   - **Pass:** Demo and simulated labels are visible; failed attempts and partial status are visible and readable.
   - **Pass:** unavailable/null values appear as “Unavailable,” never as zero.
4. Check assumptions and arithmetic.
   - **Pass:** energy coefficients, selected scenario carbon intensity, and illustrative estimate label are visible; carbon intensity is not described as live grid data.
   - **Pass:** backend metrics and cohort counts are shown. For any returned pair, `saved = baseline - optimized`; a negative value is shown as an increase and is not clamped. Missing values stay unavailable.
   - **Pass:** the UI does not claim equal answer quality or measured emissions reduction from fixture data.
5. Try the result tools: response search, copy, human review labels, JSON export, CSV export, and Print/Save PDF.
   - **Pass:** search highlights matches without hiding the complete answer; copy targets the selected response; review labels are explicitly human review and browser-local; exports open/download valid data for the displayed run; Print/Save PDF opens the browser print workflow.
6. Refresh and recovery.
   - Open a completed run URL with `?run=<run UUID>` and refresh.
   - **Pass:** the exact run and tasks restore from GET; invalid/missing IDs show a useful error. Polling stops when terminal or page unmounts; network failure retains last data and offers retry.
   - Submit while another run is active.
   - **Pass:** 409 identifies the active run and the UI navigates to it without repeating POST.

### B. Main benchmark experience

1. Open Benchmarks; inspect dataset catalog and model options.
   - **Pass:** `starter-v1` is available with five cases; model and provenance labels match the backend. Any Preview model is clearly labeled Preview.
2. Run a bounded simulated benchmark using the UI.
   - **Pass:** request is accepted once, results/history/cases load, and queued/running/completed/partial states are distinct.
   - **Pass:** backend deterministic evaluator and expected values are shown; unknown/truncated outputs are incomplete rather than correctness passes.
   - **Pass:** missing costs/tokens/latency stay null/unavailable. Pass rate denominator and error counts match the API response.
3. Test history pagination, case pagination, export, and refresh restoration.
   - **Pass:** cursor pagination has no duplicates or skipped items; the JSON export includes the authored dataset, run provenance, and completeness indication; refresh with `?benchmark=<UUID>` opens the same run.
4. Submit an invalid model/configuration or exceed the server-reported case cap in a safe test environment.
   - **Pass:** the backend returns its validation/rate-limit message; no silent switch to simulation occurs for a requested live run.

### C. Source import and source-grounded comparison — `Muffin_branch`

Use synthetic/public text only.

1. Pasted text preview.
   - **Pass:** `POST /api/v1/sources/text` returns a snapshot with a source ID, extracted text, SHA-256, metadata, and references/limits as specified. UI preview is the returned parsed text, not a fixture.
2. PDF.
   - Test a small text-selectable PDF and a scanned/image-only PDF.
   - **Pass:** selectable text is extracted with page references; scanned PDF gets the documented OCR unsupported error; encrypted/malformed/oversized files fail safely without creating a usable snapshot.
3. CSV.
   - Test a UTF-8 CSV with headers, quoted commas, and formula-looking cell text.
   - **Pass:** cells remain text and references locate the relevant row/column; unsupported encoding, malformed content, row/column/file limits return safe errors.
4. Webpage retrieval.
   - With internet available, use a small public static page such as `https://example.com/`.
   - **Pass:** visible page text is returned with source metadata; blocked/private IP, localhost, unsupported schemes/ports, redirects to blocked addresses, invalid content, and timeout are rejected safely. Query strings are not exposed in stored/displayed provenance.
5. Source lifecycle and submission.
   - **Pass:** refresh restores an unexpired preview via GET; deleting an unbound preview returns 204; deleting a source attached to a run returns 409 `SOURCE_IN_USE`; unbound previews expire after the documented period.
   - **Pass:** selecting a source blocks comparison until a valid preview is attached; source-grounded runs require Live and explicit confirmation. No failed parse/retrieval substitutes fixture text. The same source is provided to both policies.
   - Optional real Live source run is billable: use synthetic text and confirm prompt/source submission deliberately.

### D. Expanded catalog, analysis export, and quality handling — `Muffin_branch`

1. Fetch `GET /api/v1/benchmarks/datasets` and `GET /api/v1/benchmarks/datasets/starter-v2`.
   - **Pass:** `starter-v1` has 5 cases; `starter-v2` version 2.1.0 has 26 cases and lists writing/code categories. The effective per-run limit is returned and respected.
2. Run a simulated bounded `starter-v2` benchmark with the automatic candidate and export it.
   - **Pass:** baseline remains fixed large; automatic candidate follows the task category. Export contains full case definitions/expected values/evaluators, run outputs, model assumptions, provenance, and `data_completeness`.
   - **Pass:** simulated outputs are labeled synthetic. `required_facts` is described as lexical, not semantic; generated code is not executed; no claim of quality equivalence is made.
3. Check task profiles and deterministic validation using backend tests.
   - **Pass:** supported `classify`, `extract`, `summarize`, `write`, and `code` tasks use versioned server instructions; invalid configured labels/JSON fields are marked failed with human-readable notes. Unconfigured semantic truth is not called verified.
4. Check optional fallback using injected/fake provider responses in tests.
   - **Pass:** eligible Live optimized classify/extract validation failure performs at most one large-model escalation; both attempts and reason are recorded; usage/cost/latency remain nullable when unavailable. Truncation/provider errors are not retried. Fallback adds to request/spend counts.
   - Do not use a real provider call just to force validation failure; deterministic tests cover this behavior.

### E. Bounded local workspace agent — `Muffin_branch`

First use a disposable sandbox, for example `C:\EcoAgent-agent-sandbox`, containing only synthetic `seed.txt` and a new output target. Set backend `AGENT_WORKSPACE_ROOT` to that folder and restart the backend. Keep it loopback-only. To test disabled state, set `AGENT_ENABLED=false`; to test enabled state, set it true and configure Live. A real agent planning call may use provider quota.

1. Capability and consent.
   - **Pass:** disabled state shows the backend reason; enabled state advertises only supported operations and workspace name, never the absolute root. Start without provider confirmation is rejected; UI cannot start until consent is checked.
2. Exact scope and path protections (mostly automated tests).
   - **Pass:** `../outside`, absolute paths, backslash/drive paths, `.env`, `.git`, credential folders, and symlink escapes are rejected; remote/non-loopback calls return 403.
   - **Pass:** model-proposed shell/network/delete/git/deploy/unknown actions are logged as denied and never executed.
3. Approval workflow.
   - **Pass:** each file read/write becomes a pending action with exact path and content preview; nothing changes before approval. Denial leaves the file unchanged. Approval applies only to the displayed action hash; stale approval returns 409. If the file changes before approval, the action is rejected.
   - **Pass:** the event log states who proposed/approved/denied/completed the action, the operation, target, and a readable summary. Read content is visibly treated as provider-bound data before explicit continuation.
4. Loop and stop controls.
   - **Pass:** repeated identical operations are rejected; one action is processed at a time; after an approval the run pauses; Continue triggers one planning call; step limit stops/finalizes the run; Stop prevents later actions; restart pauses active work and never auto-resumes.
   - **Pass:** generated code is displayed as text and is never run. No command execution or tests are claimed.
5. Exercise all negative/edge behaviors with injected model responses in `backend/tests/test_agents.py`; avoid relying on the real model to produce a particular malicious action.

## Optional Live provider smoke test

Only do this if the provider account and cost are understood. Use a short synthetic prompt, one task, no source, and `quality_fallback=false`; keep the key backend-only. Confirm a single request is observed in provider logs/account and verify model ID, finish reason, usage, and latency. If provider usage is omitted, corresponding UI metrics must remain unavailable. A `finish_reason=length` output must be marked incomplete. Never test with private prompts or infer emissions/answer quality from one successful response.

## Responsive, accessibility, and security walkthrough

For Compare, Benchmarks, source panels, and Agent:

- Check desktop, tablet, and phone widths. No horizontal page overflow; tables/long prompts wrap or scroll inside their own region; primary actions remain reachable.
- Use keyboard only: tab through navigation, mode/task selection, form fields, dialogs/disclosures, approval actions, and retry/stop; focus remains visible; Enter/Space activates controls.
- Confirm form labels, readable contrast, status announcements, and meaningful errors. Verify no output is rendered with unsafe HTML.
- Try a missing backend, delayed network, 404 run, 409 active-run response, 422 invalid request, and 503 Live unavailable response. The app should retain useful state, show safe backend messages, and never silently submit again or switch to Demo.
- Confirm secrets are absent from tracked files, frontend bundles, API responses, URLs, browser storage, and screenshots.

## Completion record

| Area | Branch | Result (PASS/FAIL/NOT RUN) | Evidence/run ID | Notes or issue |
|---|---|---|---|---|
| Automated backend/frontend checks | `Muffin_branch` | | | |
| Main comparison UI | `main` and `Muffin_branch` | | | |
| Main benchmark UI | `main` and `Muffin_branch` | | | |
| PDF/CSV/webpage source handling | `Muffin_branch` | | | |
| Expanded benchmark/export/quality | `Muffin_branch` | | | |
| Workspace-agent safety and workflow | `Muffin_branch` | | | |
| Optional real Live provider | either | | | |
| Responsive/keyboard/browser walkthrough | either | | | |
