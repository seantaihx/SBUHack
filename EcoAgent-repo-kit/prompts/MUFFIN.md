# Paste this into the collaborator's AI assistant with repository access

We are building EcoAgent for SBUHacks 2026 in https://github.com/seantaihx/SBUHack. I am the collaborator working on Muffin_branch. Sean owns backend work on Sean_branch. We share main through reviewed pull requests.

Read README.md, docs/01-product-and-architecture.md, docs/02-api-and-data.md, docs/03-team-and-integration.md, docs/04-acceptance-and-demo.md, contracts/openapi.json, contracts/examples/* and demo/*.json before implementation. They define the product and API. Do not invent features. If both teammates have not yet adopted this kit, summarize the proposed scope and ask me to confirm before writing product code.

My ownership: frontend/, its package files/lockfile, UI behavior, accessibility and demo/submission preparation. Sean owns backend, shared contract coordination and root deployment files. Do not rewrite those independently.

Start by checking current branch, git status, project instructions and existing code. Preserve uncommitted changes. Verify Muffin_branch. Confirm the shared kit is available from main; do not assume you can see Sean's unpushed changes.

Build React + TypeScript + Vite with plain CSS. Use a typed API client calling relative /api/v1 URLs and Vite's development proxy to localhost:8000. Backend responses are authoritative for calculations, routing and status. Derive client types from the contract where practical; do not create a competing schema.

First build only the connection: fetch sample tasks and capabilities, start one comparison, poll GET /runs/{id}, show the two actual backend outputs. You may temporarily use checked-in example JSON behind the API-client boundary while Sean works, clearly labeled as a frontend mock. Remove that default when the backend is ready; do not expand a disconnected dashboard before integration.

Then implement the single-screen demo:
- Persistent Demo/Live and simulated/observed provenance badges.
- Demo checkbox sample selection; live task editor only when live_enabled.
- Compare button with submission state and duplicate prevention.
- Progress and queued/running/completed/partial/failed states.
- Backend-provided metric cards with cohort counts and assumptions disclosure.
- Result table showing policy, logical model, routing reason, latency, tokens, estimates, and failures.
- Side-by-side plain-text answers for each task. No unsafe HTML.
- Visible energy coefficient and carbon-intensity assumptions. Carbon intensity is a scenario input, not live grid data.
- Refresh restoration via ?run=<uuid>, careful polling cleanup, network retry and 409 active-run navigation.

Use 'Unavailable' for null; never turn it into zero. Label demo values simulated and energy/carbon illustrative. Negative savings indicate an increase. Never claim equal answer quality or real emissions reductions based on the fixture. Keep labels visible in screenshots.

Use keyboard-accessible controls, readable contrast, responsive layout and helpful loading/empty/error states. No login page, marketing site, expensive chart library or unrelated feature work. A simple comparison table and CSS bars are sufficient.

Run type checking, production build and a browser walkthrough against Sean's real backend. Add focused tests where useful for polling, errors and provenance. Report what you actually verified. If Live is unavailable, show the backend's safe reason; never silently switch a requested live run to demo.

Do not force-push, discard changes, merge PRs, publish or alter permissions without my instruction. Keep changes on my branch and small enough to review. If contract changes are necessary, give an exact proposal for Sean before changing the client and spec.

End each milestone with a copyable handoff: changed files, launch/check commands and outcomes, tested endpoints, mocks still present, screenshots/demo readiness and exact backend requests. Prepare a truthful Devpost draft from implemented features and docs/05-submission.md. Official PDF deadline: October 25, 2026, 9 AM Eastern.
