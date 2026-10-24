# Acceptance checklist and demo script

These are implementation acceptance requirements, not claims that tests have run.

## Backend checks

- health/capabilities/sample-tasks responses match OpenAPI; every run snapshot validates against Run schema.
- One and three-task fixture runs produce two results per task, correct routes and terminal completed state.
- Deterministic all-task fixture arithmetic matches API document; rounding is presentation-only.
- Unknown fields, 0 or 11 tasks, duplicate IDs, blank/oversized prompts, out-of-range intensity and altered demo prompts return the common 422 envelope.
- Two concurrent run submissions yield one 202 and one 409 with the correct active ID.
- Missing provider usage leaves estimates null. Zero intensity yields zero carbon and null carbon savings percentage. Negative savings survive unchanged.
- Provider timeout/auth/rate-limit/invalid-response cases produce sanitized failed results; remaining attempts continue; mixed outcomes terminate partial.
- Only paired successful comparable results enter totals. No comparisons return null metrics rather than zero savings.
- Restart changes persisted queued/running jobs to failed/RUN_INTERRUPTED and permits a new run. Completed jobs remain available.
- Provider mock verifies URL joining, exact request shape and Bearer behavior; no key or URL leaks through API errors.

Use pytest for backend behavior. Run tests around contract and business logic, not trivial implementation details. A local fake provider is sufficient for automated adapter tests; network tests are optional and explicitly separate.

## Frontend and integration checks

- Fresh clone setup is documented with verified commands; no secrets or database committed.
- Can start a demo without an account, key or Internet once dependencies are installed.
- Mode, measurement source and estimate assumptions are visible before and after running.
- Submit → progress → terminal response works through actual backend; no page reload needed.
- Button blocks double submit; network uncertainty does not automatically POST again; 409 offers opening the active run.
- Poll stops at terminal/unmount; error retains last known state and supports retry.
- Refresh with ?run=<uuid> restores inputs/results; missing run explains the problem.
- Failed attempts are visible; null is displayed 'Unavailable', not zero. Partial comparisons show included pair counts.
- Output text is rendered as text, never unsafe raw HTML. Long prompts/answers wrap and remain readable.
- Keyboard-only selection, submit, result expansion and retry work; labels and focus are visible.
- Production build served by backend works; unknown /api route returns JSON 404.

Run frontend type checking and production build. Add focused component tests for polling/error/provenance behavior if time permits. One browser walkthrough of the integrated demo is required; a passing build alone does not establish functionality.

## 90-second presentation

0–15 sec: 'EcoAgent helps developers compare a fixed large-model policy with task-based model routing. We built a working comparison prototype.'

15–35 sec: show the three sample tasks and start Demo. Say 'This demonstration uses deterministic simulated inference; live mode connects to a configured compatible endpoint when available.' Only claim live support after a successful real smoke test.

35–60 sec: show simple tasks choosing small, summary retaining large; inspect outputs side by side. Explain that successful generation does not prove equal quality and that human evaluation is still needed.

60–80 sec: show latency/token provenance and illustrative energy/carbon panel. 'These carbon figures are calculated from disclosed hypothetical token-energy coefficients and a chosen carbon intensity. We have not measured provider electricity use.'

80–90 sec: show architecture and next step: calibrated telemetry, representative workloads and systematic quality evaluation before production use.

Avoid claims such as 'we reduced real emissions 44%' or 'our model is equally accurate.' The fixture's savings percentage illustrates the calculation only.
