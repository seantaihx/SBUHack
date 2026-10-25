# EcoAgent: judge-feedback implementation prompt

Copy this prompt when assigning the next implementation milestone:

```text
Continue EcoAgent in the existing SBUHack repository and current feature branch. First read README.md, the product/API/team/demo documents, contracts/openapi.json, and current branch instructions. Preserve all existing user changes. Do not commit, push, merge, publish, or change permissions unless explicitly asked.

PRODUCT GOAL
EcoAgent helps teams adopting AI inspect the tradeoffs of a fixed large-model baseline versus a backend-selected optimized routing policy, and apply explicit limits to the workspace-agent actions EcoAgent mediates. Present it as an evaluation and guardrail prototype. Never claim guaranteed company-wide cost savings, correctness, prevention of data breaches, measured electricity use, or verified emissions reductions.

BEFORE EDITING
- Inspect git branch/status and preserve uncommitted work.
- Inspect the frontend, backend, API contract, tests, demo data and documentation.
- List the exact behavior and evidence already present; identify gaps before adding scope.
- Keep the backend authoritative for policy, routing, status, usage and aggregates. Do not create a competing client schema or silently substitute fixtures after a real API failure.
- Avoid billable provider calls unless the user explicitly authorizes the specific run.

IMPLEMENTATION PRIORITIES
1. Dependable demo: make the documented flow easy to reproduce from a clean launch. Include startup instructions, a deterministic simulated fallback, readable connection/error states, and clear Demo/Live plus simulated/observed provenance. Preserve the actual run ID and backend outputs.
2. Truthful comparison: show backend-selected model and routing reason per attempt; paired cohort counts; unavailable values as “Unavailable”; correctness/validation status beside cost, tokens and latency when available; task, source and measurement assumptions. Explain that format validation is not semantic correctness. A small fixture is illustrative, not proof of general savings.
3. Agent boundary: state which local workspace operations EcoAgent mediates, exactly which paths/actions are allowed, what needs per-action approval, what is logged, how stop/continue and bounded loop handling work, and what it does not protect. Keep generated code inert; do not execute it. Never claim universal control of third-party agents.
4. Evaluation evidence: use a versioned held-out benchmark. Report completion/correctness, failures, truncation, fallbacks, provider calls, cost and latency together. Separate synthetic/simulated values from provider observations. Do not choose examples using their hidden answer key or infer quality from a model confidence score.
5. Submission/demo materials: keep the story to one clear user problem, one successful comparison, one agent safety example, the measured evidence, and explicit limitations. Update screenshots/recording only after visually inspecting the actual build. State the exact browser, mode, backend and test results; do not claim an unperformed walkthrough.
6. Accessibility: audit every screen and interaction for semantic landmarks/headings, explicit labels, keyboard operation, visible focus, dialog focus behavior, status announcements, contrast, zoom/reflow at 320px through desktop, long text/table/log handling, and reduced-motion support. Fix blockers without redesigning unrelated features. Add focused tests for important keyboard and error flows.

PROVIDER CREDENTIAL SETUP
- Provider credentials are backend secrets. Never put them in React state longer than necessary, VITE_* variables, source code, browser storage, URLs, analytics, logs, screenshots, test snapshots, API responses, or client-side persistence.
- If a local setup form exists, use a same-origin, loopback-only backend endpoint with Origin/Host and caller checks, strict request bounds, sanitized errors, no credential echo, and atomic write into the gitignored backend root .env. Do not expose this to public deployments. Clear the password input immediately after submission and explain that it is transiently present in browser memory and the local request. A browser form cannot promise that a key is never present in frontend runtime memory.
- Read only a boolean “configured” status; never read the secret back to the browser. Environment variables override .env; disclose this safely. Require backend restart when configuration is loaded at startup. Saving a key does not by itself enable Live, validate provider access, or authorize paid calls.
- Prefer process/OS secret managers for production deployment. Make no unsupported claim that a local .env file is encrypted.

VALIDATION AND HANDOFF
- Add tests for safe credential writes, cross-origin/non-loopback denial, no secret in responses/errors, restart-required status, and frontend save/error/accessibility behavior when relevant.
- Run backend tests, frontend tests, type checking, production build, and diff checks. Run a real backend/browser walkthrough only when those services are available; report “not run” otherwise.
- Review `git diff` for secrets and unrelated changes. Keep the change small enough to review.
- End with changed files, commands and actual outcomes, tested endpoints, demo readiness, remaining mocks, unresolved decisions, and an exact next step. Do not imply production readiness from passing unit tests.
```
