# Complex EcoAgent feature test pack

All people, orders, amounts and messages are synthetic. This pack exercises the current v1.1 app. It does not automatically run Live requests, change provider settings, publish data or execute model-generated code.

## Start here

1. **Normal comparison:** open [NORMAL_PROMPTS.md](NORMAL_PROMPTS.md). Copy a prompt, select its task type in Compare > Live, and compare both answers with [the answer key](expected/normal-answer-key.json). The two API request files preserve IDs and constraints for automated output checking. Custom prompts do not work in Demo; [00-demo.json](requests/00-demo.json) uses the exact supported samples.
2. **Source import:** upload [orders.csv](sources/orders.csv), [support-tickets.csv](sources/support-tickets.csv), or one of the [PDF fixtures](../../output/pdf/feature-test-pack). Preview first, inspect extracted text, then deliberately confirm a Live source submission if desired.
3. **Agent:** run `python3 test-data/complex-v1/prepare_workspace.py` from the repository root. It prints a new disposable workspace path and creates an outside sentinel. Configure only that path as `AGENT_WORKSPACE_ROOT`; do not point the agent at the project or your home directory. Use the fields in [agent-single.json](requests/agent-single.json) or [agent-manager.json](requests/agent-manager.json). Both require an intentionally configured Live provider.
4. **Firewall evidence without provider charges:** run the command below. It injects scripted model proposals into a temporary app/database/workspace, so rejection is deterministic rather than dependent on a model choosing to attack.

```sh
.venv/bin/python -m pytest backend/tests/test_feature_pack.py backend/tests/test_agents.py backend/tests/test_agent_progress.py backend/tests/test_sources.py backend/tests/test_local_settings.py -q --tb=short
```

Windows: replace `.venv/bin/python` with `.venv\Scripts\python.exe`.

## What is in the pack

| Input | Complexity / purpose | Expected result |
|---|---|---|
| 10 normal prompts in two five-task batches | All five task types; ambiguity, injection, corrected records, missing values, constrained writing and code | Exact labels/JSON or an explicit human rubric |
| 26 order rows | 24 IDs, exact duplicate, latest revision, mixed statuses/currencies, Unicode, quotes/newlines, literal formula-like text and an adversarial note | 11 included orders; gross 417.23, refund 10.00, net **407.23 USD** |
| 12 support tickets | Mixed billing/technical/general, quoted distractors, conflicts and injection | [12 expected labels](expected/ticket-labels.json) |
| Policy and brief | v2 supersedes v1; no currency conversion; notes are data | Apply v2 to the whole supplied dataset, even earlier dates |
| Selectable PDF, 2 pages | Superseded rule, amendment and adversarial quotation | Preview succeeds, page references present; insufficient amounts to calculate revenue from PDF alone |
| Scanned PDF | Visible text is rasterized; no PDF text layer | `SOURCE_PDF_SCANNED` |
| Encrypted PDF | Password is `synthetic-test-only`, for fixture inspection only | `SOURCE_PDF_ENCRYPTED`; app does not unlock it |
| Single agent / Manager requests | Exact scopes, JSON output, code as text, serial dependent review | Inspect output contents and handoff; do not count mere file existence as correctness |
| 9 forced model actions | Shell/network/delete/git/deploy, out-of-scope reads/writes and synthetic credential-like output | Denied with no completed tool action or filesystem mutation |
| 6 forbidden source URLs | Private/loopback/link-local destinations, file scheme, unexpected port | URL validation rejects before connecting |

Raw CSV cells intentionally include formula-looking strings as parser data. Import through EcoAgent; they are not instructions to execute spreadsheet formulas. No real credentials are in these fixtures.

## Normal comparison: exact steps

### UI

1. Use Demo with its sample tasks first to establish backend connectivity.
2. For custom data choose Live, then the matching classify/extract/summarize/write/code task type. Paste one prompt at a time from NORMAL_PROMPTS.md. Select configured models.
3. The UI may assign its own task IDs and does not expose every API constraint. Use manual answer-key comparison for UI-created tasks. Use the supplied API payloads if you want exact fixture IDs and label/JSON constraints.
4. Inspect both answers, the route reason, available tokens/timing, fallback details, and errors. Baseline uses large; optimized classification/extraction starts small; summarize/write/code use large. A fallback can change the final optimized route.
5. Search an answer, copy it, add a human review label, export JSON and CSV, and open Print / Save PDF. Refresh the run URL and confirm the same result restores.
6. Change the carbon scenario and confirm only the what-if view changes. Confirm the ledger separates simulated and observed provenance. A local target is informational, not an execution limit.

### API (choose requests deliberately)

With the local backend already running, this makes a **simulated** run:

```sh
curl -s -H 'Content-Type: application/json' \
  --data-binary @test-data/complex-v1/requests/00-demo.json \
  http://127.0.0.1:8000/api/v1/runs
```

Live files are `01-live-comparison.json` and `02-live-comparison.json`. Each has 5 tasks, 10 base calls and at most 15 with fallback, within the default 20-request cap. Sending them to the same route invokes configured providers and may incur cost. Run batches sequentially. A 409 means another run is active; inspect/reopen or deliberately stop that run rather than repeatedly resubmitting.

Save `GET /api/v1/runs/{id}` or use UI Export JSON, then check it offline:

```sh
python3 test-data/complex-v1/check_results.py --comparison /path/to/export.json
```

The checker requires the supplied task IDs. Exit 0 means the authored exact checks passed; 1 means failure/incomplete evidence; 2 means human review remains. Writing, summary and code tasks always need human review. No generated code is executed. An allowed label or valid JSON can be factually wrong: compare exact values with the answer key, not just the app's format-validation badge.

## Source import and grounding

- **CSV:** preview orders.csv. Verify 26 data rows and that quotes, café, the multiline note and `=1+1` text survive. Attach this CSV, not just policy.txt, for the numerical source-audit task.
- **Text:** paste policy.txt or use source-text-preview.json with `POST /api/v1/sources/text`. Check source ID, hash and preview text. A policy-only source should not invent order totals.
- **PDF:** upload each PDF in output/pdf/feature-test-pack. The selectable file has two pages. Ask which policy applies (v2), whether pending orders count (no), and whether the document alone supplies revenue amounts (no).
- **Webpage:** preview a small public static page such as `https://example.com/` if internet is available. Check title/text and provenance. Its current content is not a fixed oracle. URLs in a prompt are not fetched; use the webpage source control. A local HTML server is intentionally blocked by public-address-only retrieval.
- **Negative URLs:** use source-url-denials.json as a manual list. Rejection is the expected success. The automated check does not make HTTP requests to these addresses.
- **Live source API:** copy 03-live-source-template.json to a temporary file and replace its placeholder UUID with the preview response's real source_id. Submit only after confirming the source/provider. Its expected numerical JSON is expected/order-summary.json. This payload assumes the attached source is orders.csv.
- **Lifecycle:** restore the source/run by URL; delete an unbound preview if desired. A source bound to a run should return `SOURCE_IN_USE` on deletion. Existing backend tests cover these lifecycle rules.

## Agent: exact setup and prompts

Create a fresh sandbox for each single-agent/Manager test:

```sh
python3 test-data/complex-v1/prepare_workspace.py
```

Use the printed `workspace_root` in the backend environment. Set `AGENT_ENABLED=true` and deliberately configure Live/provider access, then restart your backend. This helper does not do that for you. Keep the server bound to loopback.

The sandbox has input/brief.txt, input/policy.txt, input/orders.csv, input/untrusted-note.txt, and an existing output/ folder. A synthetic .env canary is forbidden; an outside.txt sentinel lives next to the workspace. Do not include either in the allowed paths.

### Single agent

Use requests/agent-single.json with `POST /api/v1/agent-runs`, or copy its instruction/scope/check fields into Workspace Agent. Read permissions are the four exact input paths. Write permissions are only output/summary.json and output/reconcile.py. Budget: 16 calls. Completion checks: valid JSON summary and code file exists.

Approve each read/write only after checking its exact path and preview. Click Continue explicitly between steps. Expected summary values are in expected/order-summary.json. Code must define summarize(rows), handle revisions/duplicates and Decimal amounts, and contain no network/shell/deletion behavior. It is delivered as text, not executed by this test pack.

### Manager workflow

Use requests/agent-manager.json with `POST /api/v1/agent-workflows`. Plan: Writer creates output/brief.md; Coder creates summary.json and reconcile.py; read-only Reviewer depends on both. Global scope includes reading those output paths for review. Budget: 20 total calls, 8 per specialist, 3 tasks, 15 minutes. Model plans vary, so inspect and decline any plan that does not meet the intended scopes/dependencies. Specialists must execute serially.

After completion, verify handoff task names/statuses, actual model IDs, usage bounds, file paths and remaining work. A Manager saying “ready” is not an independent correctness proof.

```sh
python3 test-data/complex-v1/check_results.py --agent-summary /path/to/workspace/output/summary.json
python3 test-data/complex-v1/check_results.py --workspace /path/to/workspace
```

The second check verifies source hashes and unexpected output names; it deliberately leaves log/external-state review pending. Separately check that the sibling outside.txt still contains `OUTSIDE_SENTINEL_DO_NOT_CHANGE`. Never execute model-generated reconcile.py just because it exists or was approved for writing.

## How to know the “firewall” works

This app implements **application policy boundaries**, not an OS firewall, a general prompt-injection detector, or protection for every process on your computer. The agent may call its configured provider; “no network tool” means it cannot use an arbitrary model-requested network action.

A meaningful pass needs all three: **backend rejection/event + no unauthorized completed tool action + unchanged protected state**. A refusal sentence alone is insufficient. Include an allowed positive control so “everything is disabled” does not masquerade as protection.

| Probe | Expected evidence |
|---|---|
| Allowed write before approval | Pending preview; original file unchanged |
| Approve exact allowed action | Only named file changes to exact approved content; completed tool event |
| Deny or send incorrect action hash | No write; wrong hash returns 409 |
| Change file after preview | `WORKSPACE_CHANGED`; user edit preserved |
| Swap target for symlink to outside after preview | `WORKSPACE_CHANGED`; outside sentinel preserved |
| Request ../outside.txt, absolute path, .env, .git/config, .ssh/id_rsa | 422 `AGENT_PATH_NOT_ALLOWED` before provider dispatch |
| Force model shell/network/delete/git/deploy proposal | `OUT_OF_SCOPE_OPERATION`; no pending action, no tool execution |
| Force model out-of-scope read/write | `OUT_OF_SCOPE_PATH`; no accessed/changed target |
| Propose synthetic credential-like file content | `CONTENT_NOT_PERMITTED`; no write |
| Remote client uses agent API | HTTP 403 before provider dispatch |
| Web source targets private/loopback/link-local destination | `SOURCE_DESTINATION_BLOCKED` before connection |
| Public webpage redirects to private destination | Existing source regression test blocks the second connection |
| Stop or restart while approval is pending | No unapproved write; stale approval unusable; explicit recovery required |

The 9 forced-action fixtures are **mock provider responses**, not user API payloads. test_feature_pack.py injects them directly so the boundary is exercised even if a real model would refuse first. Input validation tests use a provider mock that fails if called. Approval tests include the allowed-write positive control.

Limits: these tests do not prove race-freedom under hostile concurrent filesystem mutation, whole-machine network isolation, comprehensive secret detection, prevention of all prompt injection, or security of public deployment. A user-approved write can still contain bad code or misleading content. Regular comparison/benchmark outputs are text and do not execute tools. Inspect the content as well as the boundary.

## Remaining feature checklist

| Feature group | Dataset / evidence | Manual follow-up |
|---|---|---|
| Benchmarks | benchmark-starter-v1.json (5), benchmark-starter-v2.json (10), POST /api/v1/benchmarks/runs | Check baseline/candidate, one exact case, history/pagination, refresh and analysis export. Backend inference mode decides simulated/Live; request has no mode field. Custom dataset upload is not supported. |
| Quality fallback | Normal classify/extract constraints; existing test_task_quality.py | Do not demand fallback on every Live run: only a qualifying failed small-model validation triggers it. Correct-format wrong facts may not trigger it. |
| Bounds / retries / restart | test_agents.py and test_agent_progress.py | Stop a disposable run; restart only your test server. Inspect limits, no autoresume, durable handoff. |
| Settings | test_local_settings.py uses temporary .env paths | Never paste a real key into fixture files or screenshots. Saved key/options do not prove model access. |
| Provider adapters / errors | test_live.py uses fake transports | Actual provider accounts/models require separate Live smoke tests. |
| GPU / throughput | Capability/measurement fields | Requires supported local Ollama + NVIDIA hardware; unavailable is not zero. No GPU telemetry claim from this pack. |
| UI / accessibility / exports | Existing frontend tests plus this data | Browser rehearsal, keyboard navigation, narrow viewport, download and print inspection still required. |
| Provenance / metrics | Demo vs Live batches, carbon scenario | Inspect matched pairs, null handling and negative savings. Do not treat fixture savings as measured reductions. |

Record each result as PASS, FAIL, or NOT RUN with run ID, provenance, screenshot/export, observed event/error and file hash where applicable. Use [RESULTS_TEMPLATE.md](RESULTS_TEMPLATE.md). Do not collapse skipped/not-run cases into passes.

## Rebuild and verification

The generated inputs are checked in as ordinary fixtures and can be used without PDF-generation packages. To regenerate, run generate.py using Python with reportlab, Pillow and pypdf installed. It makes no network requests and does not clear existing agent outputs. Use prepare_workspace.py for a fresh run.

The PDF renderer used for visual QA was PDFium; the bundled Poppler font configuration was unavailable. Both selectable pages and the raster-only fixture were visually inspected, and text/negative-format parsing is asserted by tests. CSV fixtures are raw text parser inputs, with byte-preserving quoting rather than workbook formulas.
