# EcoAgent feature acceptance test plan

Use this checklist to verify behavior, not just that the app builds. It covers the merged v1.1 implementation. All sections below now apply to the current merged branch. For the latest executed checks and remaining gaps, see [the readiness review](READINESS_REVIEW.md).

## Test safety and result recording

- Start the API in simulated mode for routine checks. No real model provider calls are needed for the automated tests or Demo/benchmark simulation checks below.
- Real Live comparison, Live benchmark, and workspace-agent planning can send prompts/file contents to the configured provider and may use paid quota. Run those optional checks only with synthetic inputs and after checking the provider/account and spend limits.
- For agent UI testing, configure `AGENT_WORKSPACE_ROOT` to a disposable test directory outside the repository. Do not give the agent access to the real project, home directory, credentials, or private files for acceptance testing.
- Do not count a simulated fixture, lexical benchmark match, valid JSON, HTTP success, or a passing build as proof of semantic correctness or equal answer quality.

Record each manual case as `PASS`, `FAIL`, or `NOT RUN`, including branch, API version, browser/device, run ID (if applicable), and a screenshot or response excerpt with secrets removed.

## Automated test baseline

Run from the repository root on the branch being presented:

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

Health should report API `1.1.0`; capabilities should provide policy, supported task types and estimation assumptions.

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
4. Check Eco impact tools.
   - **Pass:** the per-task footprint map uses paired backend estimates and names the backend-selected route; unavailable/pending values remain unavailable.
   - **Pass:** moving the carbon-intensity slider changes only the what-if preview using `saved Wh × intensity ÷ 1,000`; it does not submit a request or change the run. The UI says the intensity is a scenario, not live grid data.
   - **Pass:** the optional carbon target is compared with the optimized estimate, is labeled browser-local and informational, and does not claim to block or limit backend execution.
   - **Pass:** the impact ledger stores summary metrics only, separates simulated from observed runs, deduplicates the current run, and clears through its local reset control. No prompts, answers, or keys are stored.
5. Check assumptions and arithmetic.
   - **Pass:** energy coefficients, selected scenario carbon intensity, and illustrative estimate label are visible; carbon intensity is not described as live grid data.
   - **Pass:** backend metrics and cohort counts are shown. For any returned pair, `saved = baseline - optimized`; a negative value is shown as an increase and is not clamped. Missing values stay unavailable.
   - **Pass:** the UI does not claim equal answer quality or measured emissions reduction from fixture data.
6. Try the result tools: response search, copy, human review labels, JSON export, CSV export, and Print/Save PDF.
   - **Pass:** search highlights matches without hiding the complete answer; copy targets the selected response; review labels are explicitly human review and browser-local; exports open/download valid data for the displayed run; Print/Save PDF opens the browser print workflow.
7. Refresh and recovery.
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

### C. Source import and source-grounded comparison — merged v1.1

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

### D. Expanded catalog, analysis export, and quality handling — merged v1.1

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

### E. Bounded local workspace agent — merged v1.1

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
6. Start a Manager workflow in a disposable workspace with two synthetic outputs, one Writer task and one dependent Coder task. Inspect the full plan before approval.
   - In Provider Settings, assign Writer to the small model and Coder to the large model, save, restart the backend, then verify the plan and completed tasks show the model IDs actually used. Do not start a paid run unless provider use is intended.
   - **Pass:** the plan shows task names, roles, exact scopes, success criteria and dependencies. Each task can be expanded to inspect its exact instruction and permitted read/write paths; tasks without dependencies are visibly identified as eligible after approval. No specialist operation starts before plan approval.
   - **Pass:** conflicting writer/coder output paths are rejected, including case-only aliases on case-insensitive filesystems; tasks run sequentially. Provider Settings offers only backend-configured, price-supported model IDs for each role, and task/event snapshots identify the selected model. Roles can use different configured providers/models with provider-specific backend keys; local Ollama remains loopback-only. The UI does not claim parallel execution.
7. Approve one exact file proposal, then exercise Continue, a denied action, and Stop while an approval is pending.
   - **Pass:** the exact before/proposed content and path are shown; Stop remains available while a run is queued or running, including plan and file approvals; active-run inputs stay locked; denial/stop leaves no unapproved write; only the explicitly continued next model call runs.
    - **Pass:** starting a second task during an active Workspace Agent run reopens the run identified by the 409 response, restoring its status, checkpoint, Continue, and Stop controls.
8. Exercise maximum workflow calls, per-specialist calls, token budgets, estimated spend, and runtime deadline using deterministic backend tests or a disposable local run.
   - **Pass:** reaching any bound records a safe stop reason and durable handoff; completion-token caps use remaining budget; missing output usage is reserved conservatively. Per-request provider timeout remains 30 seconds.
9. Complete and interrupt workflows, including an application restart while active.
   - **Pass:** the handoff contains the plain-language summary, human-readable task titles/names/roles/statuses, compact task-intent summaries, per-task permitted paths, assigned model IDs, criteria, result summaries, completed/remaining/blocked task IDs, path-only file list, action counts, retry counts, available reported usage and exact next steps. Restart pauses without auto-resuming and refreshes the handoff. Handoff never contains credentials, full model output, or private file contents.
   - **Pass:** completed, paused, failed, stopped, or recovered single-agent runs also show a copyable durable handoff with a safe task summary, file paths, action history, completion/stop status, available usage and next steps; raw model output and file contents are excluded.
   - **Pass:** credential-like text is rejected from agent instructions, exact paths and completion checks; model-proposed operation labels and targets are redacted from returned event/handoff logs. Provider credentials stay only in backend configuration and are never returned by capabilities or agent responses.
10. Inspect the final review and verification status.
   - **Pass:** deterministic file/format checks are separate from the manager's model-generated semantic review; absent deterministic checks remain `not_requested`. Agent carbon is Unavailable.

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
| Automated backend/frontend checks | current merged branch | | | |
| Main comparison UI | current merged branch | | | |
| Main benchmark UI | current merged branch | | | |
| PDF/CSV/webpage source handling | current merged branch | | | |
| Expanded benchmark/export/quality | current merged branch | | | |
| Workspace-agent safety and workflow | current merged branch | | | |
| Optional real Live provider | either | | | |
| Responsive/keyboard/browser walkthrough | either | | | |
