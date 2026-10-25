# EcoAgent — Repository-Aware Implementation Prompt

## Assignment

Extend the existing EcoAgent application into a transparent, provider-aware inference comparison platform for SBUHack 2026. Work inside this repository. Preserve the working application and implement the highest-priority features end to end before expanding scope.

The central user question is: **Can a less expensive model satisfy this task's quality requirements, and what does that decision actually cost?**

Support the answer with provider-reported usage, complete available outputs, reproducible pricing, explicit evaluation evidence, and honest limitations. Energy and carbon remain secondary, illustrative estimates unless actual measurement evidence becomes available.

This is an implementation assignment. Inspect first, report a concise gap analysis and execution plan, then implement the authorized scope. Do not stop after writing a plan. Ask only about unresolved decisions that materially affect compatibility, team ownership, cost, or scope. Do not claim unfinished roadmap items are implemented.

## 1. Establish the current repository state

The following snapshot was inspected on October 24, 2026 after a successful `git fetch origin`. It is context, not a guarantee of the state when you execute this prompt:

- Local branch: `Sean_branch`; HEAD: `15862f4`, merge of `origin/main` into Sean's branch.
- `origin/main`: `4677500`, merge of backend integration PR #2.
- `origin/Sean_branch`: `3cee226`; the local branch was two commits ahead.
- `origin/Muffin_branch`: `a7e3767`, typed benchmark frontend and mock flow.
- Untracked directories existed: `.agents/`, `EcoAgent-repo-kit/`, and `handoffs/`. Preserve them.

Start with:

```sh
git status --short --branch
git remote -v
git fetch origin
git log -8 --oneline --decorate
git log -5 --oneline origin/main
git diff --stat
git diff --cached --stat
```

If fetching is unavailable, explicitly distinguish local refs from verified remote state. Fetching does not authorize merging, rebasing, resetting, or overwriting local changes. Do not automatically pull or switch branches.

Read applicable repository instructions and these files before editing:

- `README.md`, `START-HERE.md`
- `docs/01-product-and-architecture.md`, `docs/02-api-and-data.md`, `docs/03-team-and-integration.md`
- `docs/API_CONTRACT.md`, `docs/BENCHMARK_INTEGRATION.md`, `docs/FRONTEND_QA.md`
- `docs/backend-handoff.md`, `docs/handoffs/sean-progress.md`
- `docs/evaluation/e8943656-report.md`
- `contracts/openapi.json` and relevant contract examples
- Backend provider, pricing, schema, execution, persistence, benchmark and test modules
- Frontend API types/client, comparison screen, benchmark dashboard and tests

Resolve conflicting documentation using code, current tests and dated evidence. Do not infer that credentials are configured from historical reports. Do not print `.env`, keys, private database contents, or unsanitized provider payloads.

### Verified implementation baseline

The repository already contains:

- React/TypeScript/Vite frontend; FastAPI/Pydantic backend; SQLite persistence.
- Deterministic Demo mode and a Groq-compatible live HTTP adapter.
- Baseline routing to the large model; optimized classification/extraction to the small model and summarization to the large model (`task-routing-v1`).
- Original comparison endpoints, persisted snapshots, restart recovery and a shared active-run gate.
- Five implemented benchmark endpoints: dataset catalog, run history, start run, run snapshot, and case results. They are no longer merely proposed.
- Typed frontend benchmark integration, explicit fixture mode and benchmark cost metrics.
- Persistent request/spend reservations, configured rate limits and hard provider timeouts. Extend these safeguards rather than replacing them blindly.

Relevant limitations in the inspected code:

- `backend/app/providers/base.py`: `InferenceResult` contains only output text, latency, input tokens and output tokens.
- `backend/app/providers/live.py`: Groq-compatible non-streaming Chat Completions, fixed system message, `temperature: 0`, `max_tokens: 256`, no automatic retries or Demo fallback. It discards richer response metadata and finish reasons.
- `backend/app/pricing.py`: two hardcoded Groq model rates and binary floating-point calculations.
- `backend/app/store.py`: spending reservation amounts use SQLite `REAL`. Decimal correctness must include persistence and aggregation, not just the calculator.
- `backend/app/schemas.py`: strict original contracts; comparison results do not expose per-attempt API cost breakdowns.
- `backend/app/benchmarks/schemas.py`: benchmark results already expose estimated costs and basic usage.
- `frontend/src/App.tsx`: renders returned output text; richer inspection, search/copy/export and truncation status still need deliberate implementation.
- OpenAI-native and Anthropic-native adapters, detailed cache/reasoning accounting, price snapshots, custom rates and business projections are target features, not established functionality.

### Evidence that must remain accurately described

`docs/evaluation/e8943656-report.md` records a persisted nine-task live comparison with 18 successful attempts and complete usage/latency. Answer correctness is user-reported; the report does not independently establish quality equivalence. Its sanitized export cannot reproduce the original prompts or answers. Execution-time commit is unknown. Energy/carbon are illustrative; optimized latency was higher in this run.

The README's older statement that real Groq inference has never been tested conflicts with this later evidence. Update that wording carefully: distinguish historical persisted evidence, mocked adapter tests, and any fresh live smoke test. Never imply a new provider test occurred because you inspected an old report.

## 2. Scope, priorities and team boundaries

Sean owns backend, storage, providers, routing, ingestion and backend contracts. Muffin owns frontend, dashboards, inspection/export interfaces and frontend tests. Shared contract changes require the team's agreed coordination process. Prepare a concrete contract proposal and compatible examples before requesting any required agreement; continue independent work while blocked.

Preserve existing Demo and Groq flows. Keep old snapshots readable. Do not overwrite teammate branches, force-push, silently change agreed contracts or merge into main without authorization.

**Mandatory first release:** provider usage and full-output transparency; OpenAI/Anthropic integration alongside Groq; decimal pricing with immutable snapshots and custom rates; a usable request-level comparison UI; complete expenditure accounting; compatibility and regression checks.

**Next:** explainable routing/fallback, stronger evaluations and business projections.

**Later:** document/web ingestion, expanded reporting and additional analytical screens.

Treat this ordering as a dependency order. Complete and verify the mandatory release before adding speculative breadth. Preserve the later requirements in the backlog if time runs out.

## 3. Phase A — Audit, contracts and a baseline

Produce a short table: requirement, existing implementation, gap, proposed files, compatibility impact and verification.

Run the existing relevant checks before broad changes. Record failures without assuming they are caused by your work. The historical report records 127 passing backend tests; rerun to establish current status rather than quoting that as a fresh result.

Define additive or explicitly versioned contracts for attempts, provider usage, capabilities, price snapshots and cost breakdowns. Synchronize backend schemas, OpenAPI, examples and frontend types. Strict schemas mean an apparently additive field still requires compatibility testing.

Design a backward-compatible SQLite migration. Missing historical fields remain unknown; never manufacture historical usage, effective prompts, execution commits or pricing snapshots. Label any recalculation as a new derived result under new assumptions.

## 4. Phase B — Provider adapters and attempt records

Use a shared provider interface while preserving provider-specific semantics. Add native OpenAI Responses and Anthropic Messages adapters; retain the existing Groq path. Use official SDKs where practical, following current official documentation rather than assumed fields or remembered model lists.

Before selecting model IDs, parameters or prices, verify their current official documentation. Distinguish documented compatibility, local configuration, account accessibility and successful live verification. A configuration check does not prove provider access.

Use server-side `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and existing Groq configuration. Keep the local single-user deployment model. No secrets in React, `VITE_*`, responses, logs, browser storage, exports or Git.

For every attempt, preserve:

- Attempt/run IDs, parent/fallback relationships, provider, requested and returned model IDs.
- Endpoint identity without credentials, processing tier, request ID when supplied, timestamps and client latency.
- Exact effective message roles/content sent, supported generation parameters, complete returned user-visible text and supported content blocks/tool calls.
- Original provider usage categories plus normalized counts, their provenance and completeness.
- Streaming status, finish/stop reason, refusal/error and explicit incomplete/truncated status.
- Relevant capability/limit information and safely allowlisted response metadata.

Store immutable completed observations separately from annotations, reviews and recalculations. Complete output means everything available in the response; it does not mean hidden chain-of-thought or content the provider never returned. Preserve truncation reasons instead of implying a response stopped naturally.

### Token accounting rules

Provider-reported post-request usage is authoritative. Unknown is `null`; a provider-reported zero is zero. Word/character counts are never exact usage.

Capture input/output/total, uncached input, cache reads, cache writes and TTL categories, reasoning tokens and any supported additional billable categories. Retain raw category semantics alongside normalization.

- OpenAI: inspect documented input/output/total fields and available cached-input/reasoning details. Do not assume cache-write fields exist for every endpoint/model. Cached input and reasoning may be subsets of larger totals.
- Anthropic: distinguish uncached input, cache creation and cache reads; compute a normalized prompt total only from compatible categories. TTL detail is a subdivision, not an additional quantity to count twice. Do not invent a separately reported thinking-token count.
- Groq: preserve current usage behavior and extend only from documented response fields.

Never charge reasoning tokens twice when included in output tokens. Do not add a provider total to its constituent parts. Derived totals must be labeled derived. Missing components may make a derived total unavailable.

Initially keep non-streaming execution if that produces the complete mandatory release sooner. If streaming is added, capture finalized usage and preserve incomplete/aborted-stream state; text chunks are not tokens.

The token inspector must show authoritative numerical categories. Optional visible-text segmentation must be labeled tokenizer-derived, never a billing record. Raw token IDs remain unavailable unless actually supplied. Optional preflight counts/estimates must identify model, method and provenance separately from actual usage.

## 5. Phase C — Pricing, persistence and expenditure

Build a versioned pricing catalog independent of adapter execution. Seed a small officially verified model set; do not invent current prices. Reference official pricing documentation, including:

- https://developers.openai.com/api/docs/pricing
- https://platform.claude.com/docs/en/about-claude/pricing
- https://console.groq.com/docs/models

Each record identifies provider/model, currency, rate categories, applicable tier/context/region rules, source URL, effective/version dates and provenance: verified public, user-supplied or illustrative. Prices must be updateable without rebuilding the frontend. Snapshot the selected rates and rules on each attempt so historical reports remain reproducible.

Support custom company rates without labeling them provider-verified. Include cache-read/write categories and applicable TTL rules. Additional tools, batch tiers, long-context thresholds and regional adjustments must either be implemented correctly or explicitly unsupported; never silently apply standard pricing to an unsupported configuration.

Use `Decimal` from string inputs, exact storage such as decimal text or a documented integer unit, and exact aggregation. Do not round intermediate amounts or pass money through floats before persistence. Define frontend serialization and compatibility deliberately.

For disjoint billable categories:

```text
input_cost       = uncached_input_tokens × input_rate / 1,000,000
cache_read_cost  = cache_read_tokens × cache_read_rate / 1,000,000
cache_write_cost = sum(write_tokens_by_category × write_rate / 1,000,000)
output_cost      = billable_output_tokens × output_rate / 1,000,000
estimated_total  = input_cost + cache_read_cost + cache_write_cost
                   + output_cost + additional_charges
```

Normalize inclusive categories before applying this formula. Missing applicable rates or required usage make the total incomplete/unavailable. Known subtotals may be displayed as partial. Never substitute a missing price with zero.

Expose cost components, total, currency, rate snapshot and completeness per attempt. These are **API cost estimates calculated from reported usage**, not confirmed invoices.

Separate:

1. Evaluation expenditure: every actual comparison, router, verifier, retry and fallback call.
2. Modeled production-policy cost: the cost of serving traffic through a specified policy.
3. Projected savings: baseline production cost minus optimized production cost under stated assumptions.

Unknown expenditure stays visibly incomplete. Budget reservations are conservative guardrails, not measured spend. Preserve existing safeguards through the money migration; do not release reservations for unknown failed usage without a sound reconciliation rule.

## 6. Phase D — Integrate transparency into the existing UI

Extend the comparison and benchmark screens rather than creating nine new pages by default. Near each model output display provider/model, usage, cost estimate, latency, quality status and provenance.

Provide expandable panels:

- Full Input / Effective Prompt
- Full Model Output
- Token Breakdown
- API Cost Breakdown
- Pricing Assumptions
- Evaluation Evidence
- Raw Sanitized Metadata

Full Output must show all stored available text, with scrolling, expand, search and copy. Previews may be shortened only when clearly marked. Use safe text rendering. Clearly distinguish application preview shortening from provider-side truncation.

Use explicit labels: Live — Provider Reported; Calculated From Reported Usage; Pre-request Estimate; User-Supplied Price; Simulated Demo Data; Unavailable.

Show absolute/percentage cost differences, usage differences, latency and quality separately. Keep negative savings visible. A zero baseline yields an undefined percentage, not infinity or an invented zero. Display enough precision for small costs. Do not calculate authoritative monetary totals independently in JavaScript.

Maintain keyboard access, screen-reader labels, narrow-screen usability, long-output handling and clear loading/error/missing states. Preserve fixture mode and test actual HTTP integration separately from fixture rendering.

## 7. Phase E — Routing, quality and projections

Preserve fixed routing for regression comparisons. Add manual provider/model selection, then transparent cost-aware routing constrained by context, capabilities, budget and latency.

Quality-aware routing may use deterministic rules and relevant historical evaluations. Explain evidence availability and sample size. Do not invent confidence scores or claim a trained difficulty classifier. Unsupported quality thresholds must be reported as unverified rather than guaranteed.

Optional fallback to a stronger model must have a declared validation trigger, attempt linkage, explicit reason and accounting for both calls. Keep transport success separate from correctness. Incorrect cheaper answers cannot count as quality-preserving savings; ungraded answers cannot silently count as correct.

Expand evaluations gradually: classification, structured/missing-information extraction, summarization, numerical/multi-step tasks, format constraints, long-context and ambiguous/adversarial cases. Include cases where the small model fails. Use equivalent source material and instructions; record provider-specific transformations and settings. Lexical checks are task-specific heuristics, not universal truth evaluators.

Report success, evaluated accuracy, quality-pass rate, cost/request, cost/validated answer, usage distributions, total evaluation spend, latency distribution and fallback rate. State cohorts, denominators and sample sizes. Use repeat runs when practical; avoid tail-latency claims from tiny samples.

Add a simulator using request volume, task mix, model policy, rates, caching, quality assumptions and fallback frequency. Show monthly/annual cost and savings, verification overhead and quality-adjusted cost. Define how daily/monthly inputs relate to avoid conflicting volumes. Separate measured workload samples from user assumptions. Do not apply provider API rates to self-hosted infrastructure except as a labeled hypothetical comparison.

## 8. Phase F — Sources, reports and environmental scenarios

After the mandatory release is verified, add plain-text, selectable-text PDF, CSV and safe public-webpage inputs as remaining scope. Both policies use the same captured source snapshot, with page/row/column references and previews. Keep preprocessing/retrieval latency and cost separate. Treat source content as untrusted; do not execute embedded instructions.

Web retrieval requires SSRF protection covering resolved addresses, private/reserved networks, redirects, DNS rebinding, size limits and timeouts. Do not expose an unrestricted URL fetcher. Scanned-PDF OCR and unrestricted web research may remain future scope.

Provide JSON, CSV and PDF summary/full reports as capacity permits. Include IDs, timestamps, provenance, model/policy, usage, price snapshots, cost categories, actual versus modeled costs, evaluation, review notes, source references, latency, errors and environmental assumptions. Full prompts/outputs require explicit export selection. Protect CSV against spreadsheet formula injection; preserve Unicode, quoting and multiline content, and document null encoding. Never export credentials or environment files.

Energy/carbon profiles must identify coefficient values, version and carbon-intensity scenario. Persist the actual assumptions used. Clearly label uncalibrated estimates; dollar savings and energy estimates can move differently. Hardware measurement and infrastructure accounting remain future scope unless real integrations exist.

## 9. Operational constraints and verification

Preserve one-worker/active-run behavior until deliberately changed and tested. Bound requests, input/output sizes, concurrency, retries and timeouts. Keep persistent run/day spending safeguards and rate-limit handling. Add cancellation/safe stopping deliberately. Large live benchmarks require explicit user action; do not spend API credits merely to validate this prompt.

Use mocked provider fixtures for routine verification. A real smoke test requires authorized spending and configured credentials, a tiny bounded workload and an exact record of provider/model/results. Never silently fall back to Demo after a live failure.

Required regression coverage:

- OpenAI, Anthropic and Groq usage normalization; cache subdivisions and inclusive totals; reasoning subsets; missing versus zero; malformed/error/incomplete responses.
- Decimal arithmetic, tiny costs, custom rates, missing rates, supported pricing tiers and historical price reproducibility.
- Migration from existing snapshots/reservations, restart recovery and immutable observations.
- Existing fixed policy, capability constraints, insufficient quality evidence and all fallback costs.
- Offline Demo, mocked Live, explicitly labeled frontend fixtures, actual HTTP integration, complete outputs, cost panels and missing states.
- History reload, exports, source consistency and accessibility for features actually implemented.

Repository baseline commands, from the repository root:

```sh
env -u LIVE_ENABLED -u BENCHMARK_INFERENCE_MODE .venv/bin/python -m pytest -q backend/tests
uv pip check --python .venv/bin/python
.venv/bin/python backend/tests/smoke_http.py
.venv/bin/python backend/tests/smoke_benchmarks.py
npm run typecheck --prefix frontend
npm test --prefix frontend
VITE_USE_FRONTEND_MOCK=false npm run build --prefix frontend
```

Inspect test isolation before execution. The HTTP smoke scripts are documented as simulated and use temporary servers/databases; loopback permission may be required. Use the supported local Python/Node runtime; do not assume historical temporary runtime paths still exist. Record unavailable checks instead of inventing passes. Re-run relevant tests after implementation.

## 10. Completion gates and handoff

The mandatory release is complete only when:

1. Existing Demo and Groq comparisons still work under their documented configuration.
2. OpenAI and Anthropic adapters pass representative mocked tests; any actual connectivity status is reported separately.
3. Supported provider/model selection works through the real frontend/backend contract.
4. Available usage, effective inputs, full outputs and finish/incomplete states persist and can be inspected.
5. Cache/reasoning categories are normalized without double counting; missing values stay missing.
6. Decimal cost breakdowns, custom rates and immutable price snapshots survive reload/restart.
7. Evaluation expenditure is separate from production projections; failed attempts and fallback overhead are accounted for without fabricated values.
8. Quality claims match actual evidence; simulated and environmental estimates remain unmistakably labeled.
9. Applicable backend, frontend, contract, migration and integration checks pass, with limitations disclosed.

For each phase report implemented behavior, changed files, checks/results and remaining gaps. At completion provide updated contracts/examples, migration notes, provider compatibility, pricing methodology, README/setup, placeholder-only environment examples and a short reproducible demonstration.

End with a compact status table: **implemented and verified / implemented but unverified / simulated / deferred**. List exact test commands, actual live calls if any, branch/commit state, teammate dependencies and unresolved risks. Do not report tests from old documents as current execution results.

Begin with the repository audit, then deliver the smallest complete implementation that satisfies the mandatory release. Preserve truthful evidence and working behavior throughout.
