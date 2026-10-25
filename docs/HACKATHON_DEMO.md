# Hackathon demo and integration walkthrough

## Truthful 90-second demo

1. **Problem (0–15 seconds):** AI requests vary in difficulty, while a fixed model choice can spend the same resources on every task. EcoAgent makes a comparison between a baseline policy and task-aware routing visible.
2. **Input and provenance (15–30 seconds):** Show the selected sample tasks, Demo/Live mode, and provenance labels. State explicitly whether this screen is using the checked-in frontend fixture or the integrated API. Do not call the fixture a backend run.
3. **Comparison (30–55 seconds):** Submit a Demo comparison, show progress, then inspect the result table and each task's two plain-text outputs. Point out backend-reported model role and routing reason. If using the fixture, say that outputs, latency, and tokens are simulated.
4. **Assumptions (55–75 seconds):** Open the assumptions disclosure. Explain that energy uses hypothetical coefficients and carbon intensity is a scenario input, not live grid data. Point out cohort counts and any Unavailable values. Negative savings means an increase.
5. **Limitations (75–90 seconds):** State that the comparison does not prove equal answer quality or real emissions reductions. Live should be demonstrated only after an approved provider is configured and a real smoke test succeeds.

Do not present fixture savings as an achieved reduction. Do not show Live as working merely because a control exists. Keep the simulated/observed and Demo/Live badges in any screenshots or recording.

### Optional Workspace Agent segment (only when safely configured)

This is not required for the core 90-second Demo. If the backend has deliberately enabled the local Workspace Agent and a disposable workspace is configured, show its exact read/write scope, one pending file action, the approval preview, and the human-readable event log. State that each operation needs approval and code is not executed. Do not improvise with a real company directory or confidential data. The agent uses Live inference and may incur provider charges; if it is not already configured, skip this segment rather than trying to enable it during judging.

### Likely judge questions

- **Are these savings guaranteed?** No. Demo usage and latency are simulated. Live runs show available provider usage and timing for that run; broader savings require representative workloads and repeated evaluation.
- **Do you measure energy or emissions?** No. The energy coefficients and carbon-intensity scenario are illustrative inputs, not hardware telemetry or live grid data.
- **How do you know the optimized answers are as good?** We do not assume equivalence. The interface exposes both answers and deterministic validation when configured; broader semantic quality needs held-out tests and human review.
- **Does the agent protect every tool or agent in a company?** No. The current opt-in Workspace Agent mediates its own local file read/write actions. It has no shell/network/delete/code-execution tool and does not govern unrelated agents.
- **How would a company adopt it?** Agree on the workload, provider API, data handling, and deployment boundary; configure the provider on the backend; validate the API contract; then evaluate routing against representative cases. This is a proposed integration path, not a completed enterprise deployment.

## Customer integration process (current prototype)

1. Agree on the API v1 contract, deployment origin, supported task types, and data handling with the customer and backend owner.
2. Configure provider credentials only in the backend's secret store; never in Vite variables or the browser.
3. Implement the backend provider adapter and report safe capabilities through `GET /api/v1/capabilities`.
4. Validate requests and responses against the shared OpenAPI contract and deterministic demo examples.
5. Build the frontend and have the backend serve `frontend/dist` with same-origin `/api/v1` routes.
6. Run the integration checklist and a browser walkthrough, then disclose provenance and assumptions during the demo.

This is an integration checklist for the prototype, not a claim that a production customer onboarding or security process exists.

## Presentation outline

- Problem: fixed model selection obscures the cost/quality tradeoff across task difficulty.
- Product: a single-screen, backend-authoritative comparison workbench.
- Architecture: React/TypeScript frontend; typed API client; FastAPI contract v1; backend owns routing, status, outputs, and aggregates.
- Evidence: show only verified endpoint responses and distinguish fixtures from observed runs.
- Limitations and next steps: representative workloads, agreed quality evaluation, provider calibration, operational security review, and measured energy data.

## Screenshot checklist

- Capture the integrated Demo screen only after a real API walkthrough; otherwise title it clearly as frontend mock.
- Keep Demo/Live and simulated/observed badges, cohort counts, and assumptions visible.
- Capture one result view with both policy outputs and one narrow viewport after visual review.
- Do not crop away unavailable/failed results or provenance labels in a way that changes their meaning.

The interface was visually inspected in a browser at desktop and 320px phone widths during implementation, but no screenshot files have been saved for Devpost. Capture the integrated views above after restarting the current-branch backend and completing the final demo walkthrough.
