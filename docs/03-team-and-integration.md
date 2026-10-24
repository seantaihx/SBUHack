# Team workflow and implementation order

## Ownership

Sean_branch: backend/app, backend/tests, backend/requirements.txt, .env.example, .gitignore, root README and deployment integration. Sean coordinates contracts and demo fixtures.

Muffin_branch: frontend including its dependency/lock files, UI tests, accessibility, demo screenshots and Devpost draft. Collaborator access permits normal branch work; repository creator status does not change technical ownership.

Both: product choices, API changes, final integration, review and submission. Assignment can be swapped as a whole; do not let two AIs concurrently modify the same owned directories.

## Bootstrap this kit

This folder is a documentation kit, not an app or Git checkout. Copy its contents into the repository root after reviewing them. It replaces the one-line README and adds docs/contracts/demo/prompts. It contains no runnable product code.

Sean commits the shared kit on Sean_branch and opens a small documentation PR to main. Both review scope and API. Merge it, then BOTH update their own branches from main before asking AI to scaffold. This establishes one source of truth and prevents two independent root setups.

Example workflow (substitute your branch, do not paste angle-bracket placeholders):

```sh
git status
git fetch origin
git switch Sean_branch
git merge origin/main
```

For the collaborator, use `git switch Muffin_branch`. Commit or stash your own uncommitted work before merging. Never overwrite another person's files to resolve a conflict. Neither AI should force-push, reset --hard, or merge a PR without its user's instruction.

After each small milestone: run checks, commit, push your own branch, open a PR targeting main, and have the other teammate review. Use normal merge commits for this hackathon's persistent working branches; after merging a PR, both merge origin/main into their branch. Avoid squash/rebase surprises on long-lived shared branch history.

## Milestone 0: shared base (together, target 15–20 minutes)

Review and adopt the MVP, API, demo fixture and file ownership. Merge the documentation kit. Agree that energy numbers are illustrative and that live integration is optional. Record any deviation in this kit before implementation.

## Milestone 1: thin working connection (target 30–45 minutes)

Sean: backend skeleton; GET health, capabilities, sample-tasks; SQLite store; POST runs and GET runs using deterministic demo fixtures. Prioritize a working one-task run before all visual polish. Backend must produce the agreed schema, not an ad hoc substitute.

Muffin: frontend skeleton; proxy; API types/client; mode banner; sample-task fetch; Compare button; poll and show one returned output. Start against static contract examples only while backend is being built. Put transport behind one client module so the real API connection replaces mocks immediately.

Integration gate: launch both locally, submit one demo task through the actual UI, and display both outputs from FastAPI. A UI screenshot with hardcoded results does not pass.

## Milestone 2: complete demo (target 60–90 minutes)

Sean: full routing, progress and terminal states, aggregates, unknown/missing/error cases, worker gate and restart recovery; meaningful tests for arithmetic and API behavior.

Muffin: all three sample tasks, paired output table, progress, cohort-aware metrics, assumptions panel, empty/loading/error states, keyboard flow and responsive layout. No reimplementation of backend formulas.

Gate: demo runs offline with no key, refresh reloads the run, simulated results and illustrative estimates are labeled.

## Milestone 3: optional live adapter (target 45–60 minutes)

Sean: configure two distinct compatible models; implement auth, overall timeout, response/usage parsing and sanitized errors. Test adapter with a local fake HTTP server before spending provider quota. Add one real smoke test only if credentials and permission exist.

Muffin: live-mode availability, disabled reason, custom task editing, real vs simulated provenance, per-attempt failures and partial result display.

Gate: either show an actual live run with available credentials or keep Live disabled with a truthful explanation. An untested adapter is not advertised as working.

## Milestone 4: integration and presentation (reserve at least 60–90 minutes)

Sean: build frontend, serve it through backend, document exact verified commands/environment, preserve working main. Muffin: end-to-end walkthrough, screenshots, short demo recording and Devpost draft. Both: rehearsal, review provenance wording, check submission fields on actual event page.

Time boxes are planning estimates, not promises. Deadline controls scope. If time runs short, drop Live, custom tasks, decorative charts, and public hosting. Keep the integrated offline demo, correct labels, result comparison and Devpost submission.

## Shared-file changes

Changing endpoints, field names/types/units, fixtures or status semantics requires agreement in the team chat. Sean updates OpenAPI, examples and docs together; Muffin updates the client. Never silently adapt only one side. Each PR states dependencies and changed contracts.

## Handoff format

Branch and commit; changed files; commands run and their outcomes; exact endpoint/UI behavior available; mocked vs live status; known issues; any action needed by the other teammate. Say 'not tested' when not tested.
