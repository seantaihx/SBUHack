# EcoAgent — Devpost draft

Use this as a draft only. Check the actual event form for required fields, team eligibility, repository visibility, video requirements, and AI-assistance disclosures before submitting. Keep claims aligned with the branch and demo you actually show.

## Project name

EcoAgent

## Tagline

Compare AI model-routing choices and put clear approval boundaries around the workspace-agent actions EcoAgent mediates.

## Inspiration

Teams adopting AI can have difficulty predicting how model choice affects token usage, latency, and answer behavior. Teams new to agents also need to understand what an agent is allowed to do before trusting it with work. We wanted to make these tradeoffs visible and give users explicit boundaries to review.

We do not claim that token use alone caused a named company's bankruptcy or data breach. EcoAgent is a prototype for evaluating usage and constraining its own workspace-agent actions; it does not monitor every AI system in a company.

## What it does

EcoAgent compares a fixed large-model baseline with an optimized policy selected by the backend. For a task workload, it displays the returned model choice and routing reason, side-by-side plain-text outputs, run status, and available token and latency data. When complete paired usage is available, it also displays energy and carbon **estimates** using disclosed hypothetical coefficients and a scenario carbon-intensity input.

The benchmark page runs versioned cases against the backend's deterministic evaluators and exports the case definitions and outcomes. These checks provide limited evidence about the authored criteria; they are not a general measure of semantic answer quality.

The optional local Workspace Agent can propose reads or writes only within exact paths the operator supplied. Each operation requires a separate approval. It has no shell, network, delete, deployment, Git, or code-execution tool. These controls apply to the EcoAgent workspace agent only; EcoAgent does not automatically govern third-party agents.

## How to try it

1. Start the local FastAPI backend and Vite frontend using the current README instructions.
2. Leave the app in Demo mode, select the sample tasks, and start a comparison.
3. Inspect each policy's returned route, reason, text, attempt status, and cohort counts.
4. Open the assumptions disclosure. Demo outputs, latency, and tokens are simulated; energy coefficients and carbon intensity are illustrative assumptions.
5. Open the benchmark catalog to inspect the versioned evaluation cases. Use the Workspace Agent only if its local opt-in prerequisites are deliberately configured; no agent action is needed for the core Demo.

For a Live run, configure credentials on the backend only, enable Live deliberately, and use synthetic prompts. A configured key does not guarantee provider availability. Provider calls may incur charges. Do not present Live as tested unless the team has completed a real provider walkthrough.

## How we built it

The frontend uses React, TypeScript, and Vite. It talks to a FastAPI backend through a centralized typed API client and same-origin `/api/v1` routes. The backend owns routing, provider calls, run persistence, evaluation, and aggregate calculations. SQLite stores local run snapshots. Provider credentials stay in backend configuration; the browser never calls the model provider directly.

## What we learned

Lower token use is not by itself proof that a routed answer is good enough. We kept answer review separate from deterministic format checks, displayed missing metrics as unavailable, and disclosed that our energy and carbon numbers are modeled rather than measured. We also learned that an agent boundary is only meaningful when the exact mediated actions, approvals, and unsupported operations are visible to the user.

## Limitations and next steps

- This prototype does not provide organization-wide AI proxying, provider billing reconciliation, budgets, or alerts.
- The benchmark cases and deterministic checks are limited; representative held-out evaluations and human review are still needed.
- Token-based energy/carbon figures use hypothetical coefficients. EcoAgent does not measure electricity or verify emissions reductions.
- A successful response does not prove semantic correctness or equal answer quality.
- The Workspace Agent governs only its own local file actions and is not a general firewall for other agents or applications.
- The local credential setup is for trusted development machines, not a production secret-management system.
- Before submission, add only screenshots or recordings captured from the final build and visibly preserve mode/provenance labels and estimate disclosures.

## Demo recording / screenshots

**Not attached yet.** Capture and review these on the final build before uploading:

- Integrated simulated comparison with provenance and status labels.
- Results showing both outputs, backend routing reasons, cohort counts, and assumptions.
- Optional agent approval screen only if the local agent is enabled and safely demonstrated.

Do not crop away simulated, observed, unavailable, or illustrative labels.
