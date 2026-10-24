# Paste this into Sean's AI assistant with repository access

We are building EcoAgent for SBUHacks 2026 in https://github.com/seantaihx/SBUHack. I am Sean, working on Sean_branch. My collaborator works on Muffin_branch. We share main through reviewed pull requests.

Read README.md, docs/01-product-and-architecture.md, docs/02-api-and-data.md, docs/03-team-and-integration.md, docs/04-acceptance-and-demo.md, contracts/openapi.json, contracts/examples/* and demo/*.json before implementation. These are the shared specification. Do not infer additional features from the project name. If this kit has not been adopted by both teammates, first summarize the proposed scope and ask me to confirm it before writing product code.

My ownership: backend/app, backend/tests, backend/requirements.txt, .env.example, .gitignore, root setup/deployment documentation. I coordinate changes to contracts and demo fixtures. Do not edit frontend files owned by my collaborator without coordinating.

Start by checking current branch, git status, available project instructions and existing code. Preserve uncommitted work. Verify Sean_branch rather than assuming it. Use the existing shared foundation; do not create a separate app repository. If shared docs differ across branches, flag it before coding against a different contract.

Implement in small milestones:
1. FastAPI skeleton, exact schemas, health/capabilities/sample-tasks, SQLite run storage and one-task deterministic demo POST/GET cycle.
2. Full policy execution, paired aggregates, single-worker gate, terminal/error behavior and restart recovery.
3. Optional OpenAI-compatible live adapter, only after demo works. Use the configured base URL/model IDs, server-side secrets and hard total timeout. Do not assume available credentials.
4. Serve the collaborator's built frontend on the backend origin and document verified setup.

Follow OpenAPI and prose semantics exactly. Demo values are simulated; energy coefficients are illustrative. Missing live usage stays null. Never silently substitute demo responses for failed live requests or claim measured carbon savings. Do not introduce auth, Kubernetes, additional providers, caching or extra product features.

Use meaningful tests from the acceptance document, including fixture arithmetic, concurrent submissions, provider failures, null metrics, zero intensity, negative savings and restart recovery. Verify responses against the shared schema. Pin resolved dependencies and record versions. Report commands actually run and their results; distinguish tests with a fake provider from a real integration smoke test.

Complete the first integration milestone before expanding optional scope. When ready, provide the exact backend launch command, working endpoints, branch/commit, and one request my collaborator can run. Continue through authorized implementation tasks while reporting progress and concrete blockers.

Work on my branch. Do not force-push, reset away changes, merge PRs, publish services, or change repository permissions without my instruction. If GitHub actions are requested, make small PRs to main with clear validation notes. Update contract, examples and docs together only after coordinating any contract change.

End each milestone with a copyable handoff: available behavior, changed files, checks performed, remaining mocks/limitations, and exact frontend action needed. The official PDF deadline is October 25, 2026 at 9 AM Eastern; preserve time for integration and submission.
