# EcoAgent readiness and debugging review

Reviewed 2026-10-25 on `Sean_branch`, starting from merge commit `b13751e` (incoming main `28d95ab`). Results below describe this working tree, not a deployed service. Verification was performed before the follow-up commit and pull request.

## Overall assessment

**The core simulated comparison and benchmark demo is ready at the automated/API level.** A final browser rehearsal on the presentation machine remains. This is a local hackathon prototype, not a production service. An overall percentage would hide major differences between implemented functionality, mocked verification and real provider/hardware validation, so use the feature table in the [README](../README.md).

The strongest presentation path is Compare → one paired answer → environmental assumptions → a prepared benchmark result. The [five-minute script](JUDGE_WALKTHROUGH.md) reserves two minutes for Q&A. Workspace/Manager workflows are optional because they depend on configured Live inference and a disposable workspace.

## Verification evidence

| Check | Result | What it establishes |
|---|---|---|
| Backend `pytest backend/tests -q --tb=short` | 208 passed, 1 platform-gated skip | Contract, routes, persistence, provider fakes, sources, benchmarks, agent boundaries and recovery |
| Frontend `npm test --prefix frontend` | 59 passed, 5 files | Component/contract behavior, including literal rendering of untrusted output |
| `npm run typecheck --prefix frontend` | Passed | TypeScript type checking |
| `npm run build --prefix frontend` | Passed | Production bundle builds |
| `backend/tests/smoke_http.py` | Passed | Real Uvicorn/HTTP Demo submission, completion, SQLite persistence, abrupt restart and another run after recovery |
| `backend/tests/smoke_benchmarks.py` | Passed | Real HTTP benchmark catalog, submission, progress, cases, history and interrupted-run recovery |
| `git diff --check` | Passed | Patch whitespace checks |
| Real browser interaction / downloads / responsive layout | Not run | No browser connection available to the automation tool; component tests do not substitute for this |
| Hosted provider calls / real local Ollama inference | Not run | No claim of verified access, model quality, real speed or spend |
| NVIDIA GPU power measurement | Not run | Optional hardware path remains unverified on a real device |

The HTTP checks force simulated inference and use temporary databases. They do not validate paid provider access. One backend test is platform-gated: the write-path case-alias check skips when `os.path.normcase` does not fold case; this is not proof that all filesystem alias behavior has been exercised on macOS.

## Bugs found and fixed

1. **Pending file approval blocked recovery.** `Store.recover()` changed an agent to paused but retained its pending action. Continue rejected it, and the stale approval was inconsistent with the recovered phase. Recovery now clears the proposal while preserving completed writes, usage and the event history. Regression coverage verifies stale approval rejection and explicit continuation.
2. **Manager plan approval disappeared after restart.** A workflow waiting for plan approval was changed to paused, so plan approval returned a conflict. Recovery now retains `awaiting_plan_approval` for the `plan_review` stage. It does not auto-approve or auto-run anything.
3. **Interrupted manager planning could not continue.** Team continuation accepted only execution/review stages, leaving a recovered or failed initial planning step stuck. Explicit Continue now also allows planning, using the existing budget checks and scheduling path. A regression test first reproduced the HTTP 409, then verified a user-triggered second call without approving the plan.

## Test and merge cleanup

The initial run had **21 backend failures, 194 passes and 1 skip**, plus **1 frontend failure and 58 passes**. These were investigated rather than treated as 22 independent product defects.

- Seventeen failures came from the older branch's periodic-progress contract: unsupported `review_interval`, `max_elapsed_seconds`, `checklist`, `/extend`, `/review`, progress/revision arrays and previous stop semantics. The user had chosen incoming main, whose `AgentStartRequest` forbids those fields. Those 17 obsolete tests were replaced with 10 current-contract checks; the existing passing legacy-missing-usage test was retained. This is a contract migration, **not restoration of the retired features** and not 17 repaired runtime features.
- Removed the unused `backend/app/agent_progress.py`, which imported the now-nonexistent `AgentCheckpoint`. There were no remaining callers. Current completion checks and checkpoint sequence tracking live in the incoming implementation.
- Relevant current behavior remains tested in `test_agents.py`: duplicate prevention, changed-file rereads, no-op writes, bounded runs beyond twelve calls, step/token/deadline limits, completion checks, retries, approvals and durable handoffs.
- Three source/quality tests used fake inference functions missing the newly added `measure_gpu_energy` argument. Updated their signatures and asserted that comparisons request telemetry; no real GPU is used by these tests.
- One file-preview test assumed Windows newline translation. It now writes explicit CRLF bytes and still verifies exact previews and approved LF output on every platform.
- The frontend HTML-safety test asserted that the entire page contained no accessible image. The new policy diagram legitimately uses `role="img"`. The test still verifies the literal unsafe string and now checks answer containers for injected image/script/event-handler markup.

## Completeness boundaries for judging

- **Routing:** a fixed, transparent task-type rule, not a learned optimizer or an automatic assessment of prompt difficulty. Default comparison routing is small for classify/extract and large for summarize/write/code. Agent role assignments are separately configurable.
- **Evaluation:** comparison runs execute both policies, so evaluation itself adds inference. Benefits of deploying a selected policy have not been demonstrated on a production workload.
- **Quality:** exact/JSON/phrase checks and optional validation fallback are implemented. Semantic equivalence, hallucination detection and generated-code correctness are not established. Code is not executed.
- **Benchmarks:** starter-v1 has 5 cases; starter-v2 has 40, with all categories represented in its first 20. The hard run cap is 20 and live budgets may lower it. A catalog size is not the number evaluated in a particular run.
- **Sources:** text, CSV, selectable-text PDF and public static webpage parsing are implemented. No scanned-PDF OCR or browser-rendered webpage extraction. Source-grounded inference requires Live; parser tests do not verify model grounding quality.
- **Environment:** token coefficients and carbon-intensity scenarios are illustrative. The optional NVIDIA sampler is separate and describes whole-device activity during a local Ollama comparison, not exclusive request energy or whole-system emissions. No real hardware reading was verified here.
- **Agent:** exact read/write approvals, bounded execution, deterministic file checks, durable handoff and serial Manager workflows exist. Periodic checklist reviews, budget extension and old revision-history APIs are not current features. Manager semantic review is model output, not independent verification.
- **Operations:** one local worker and SQLite; no authentication, multi-user isolation or enterprise deployment validation. No claim that the app governs external agents.

## README review changes

The original README was useful for installation but did not give judges a concise reason to care, a completeness map or a timed narrative. Added those, linked a speaking script, documented the optional GPU path without overclaiming, and removed stale branch-only guidance from the acceptance checklist. Kept technical installation and limitations intact.

## Final presentation rehearsal

1. Start the current backend and production bundle; verify API connectivity and visible Demo/simulated provenance.
2. Run the three-task Demo once and inspect a paired answer; keep its run URL ready.
3. Run a five-case starter-v1 simulated benchmark and keep one case result visible in a second tab.
4. Check scrolling, answer expansion, carbon slider and JSON/CSV/print controls in the actual browser.
5. Rehearse to 3:00, then stop for questions. Use the architecture segment if Live agent setup is not already reliable.

Community research was attempted through DevRelay but the connector required sign-in, so no external community claims or citations are used in this audit.
