# EcoAgent: current features versus the original plan

Audit date: October 24, 2026 (America/New_York)

Audited checkout: `Sean_branch`, commit `f69b244`, including `main` through `d07ab5b`. This report compares the actual checked-out implementation with the user's original **ECOAGENT — Full Implementation Prompt for SBUHack 2026**, not just the later rewritten prompt. It does not claim to include subsequent remote changes.

## Overall assessment

EcoAgent is now a working prototype for comparing Groq model configurations, inspecting responses, importing sources, running synthetic benchmarks and trying bounded local workspace actions. It has moved well beyond the original three-task Demo.

It is **not yet the complete multi-provider, quality-aware cost-optimization platform described in the original plan**. The highest-priority gaps remain native OpenAI/Anthropic integration, detailed billing-token categories, precise/versioned pricing, per-request cost transparency throughout the UI, and reproducible historical pricing. More lower-priority source/report features have shipped than some original Priority 0 requirements.

Status vocabulary:

- **Implemented:** a concrete code path exists; this does not automatically mean live-provider or browser verification.
- **Partial:** meaningful functionality exists, but important original requirements remain unmet.
- **Missing:** no implementation found in the audited application.
- **Extra:** functionality beyond the original implementation prompt.

No overall completion percentage is assigned: a count of small UI features would obscure missing core requirements.

## 1. Current feature inventory

### Comparison application

- React/TypeScript/Vite frontend with Compare, Benchmarks and Workspace agent navigation.
- FastAPI backend, API version `1.1.0`, Pydantic contracts and SQLite persistence.
- Deterministic Demo mode without provider credentials; separate frontend fixture mode.
- Live Groq-compatible Chat Completions inference with server-side credentials.
- Editable classification, extraction, summarization, writing and code-generation tasks.
- Up to 10 comparison tasks, each with a 2,000-character instruction limit; sources use separate limits.
- Baseline versus optimized results, progress, errors and persisted run reopening by URL.
- Full returned text, response search/highlighting, copy, truncation warnings and unknown-completion warnings.
- Input/output token counts, client latency, illustrative energy/carbon and route reasons.
- Human correctness labels stored in the local browser, separately from model output.
- JSON/CSV downloads and a browser Print/Save PDF report.

Evidence: `frontend/src/App.tsx`, `frontend/src/comparisonUtils.ts`, `backend/app/main.py`, `backend/app/schemas.py`, `backend/app/runner.py`.

### Providers, output limits and quality controls

- One live adapter: Groq-compatible non-streaming `/chat/completions`.
- Configured small/large defaults: `openai/gpt-oss-20b` / `openai/gpt-oss-120b` served through Groq. The `openai/` prefix does **not** mean a native OpenAI API integration exists.
- Benchmark catalog also includes a configured Groq preview model, `qwen/qwen3.8-27b`; this audit did not independently verify current provider/account availability or public prices.
- `max_completion_tokens` replaces the previous 256-token setting. The code defaults to 65,536 and clamps by its model-limit table (16,384 for the configured preview model).
- Finish reason and output-limit truncation are now recorded.
- Versioned task instructions: `task-instructions-v1`.
- Classification can validate membership in configured labels; extraction validates JSON-object format and required keys.
- Optional Live optimized fallback performs at most one large-model call after an eligible small-model validation failure. It records both attempts and combines known costs/tokens/latency.
- No automatic fallback for provider errors or known truncation. No learned difficulty classifier or semantic correctness guarantee.

Evidence: `backend/app/providers/live.py`, `backend/app/settings.py`, `backend/app/task_quality.py`, `backend/app/policy.py`, `backend/app/runner.py`.

### Benchmarks and analysis

- `starter-v1`: 5 cases, version 1.0.0.
- `starter-v2`: **26 cases**, version 2.1.0: classification 5, arithmetic 5, extraction 5, summarization 3, reasoning 2, formatting 2, fact retrieval 2, writing 1, coding 1.
- Fixed baseline model selection; candidate model selection or `eco-auto` task-category routing.
- Catalog/detail, start, history, snapshot, case pagination and analysis-export APIs.
- Default server cap is 10 cases per run, further constrained by request/spend budgets. Having 26 catalog cases does not mean all 26 run in one default job.
- Exact matching, authored JSON-value checks and lexical required-fact checks.
- Truncated/unknown-completion outputs are incomplete rather than correctness passes.
- Aggregate cost estimate, input/output usage, mean latency, pass counts, incomplete counts and provider-error counts.
- Stored dataset definition, outputs and an analysis JSON export.
- Simulated benchmark answers come from expected answers by construction. Their scores demonstrate application behavior, not model intelligence.

Evidence: `benchmarks/starter-v2.json`, `backend/app/benchmarks/`, `frontend/src/BenchmarkDashboard.tsx`.

### Document and website inputs

- Paste text; upload selectable-text PDF or UTF-8 CSV; retrieve a supplied public HTTP(S) webpage.
- Backend preview with extracted text, SHA-256, metadata and source references.
- PDF page references, CSV row/column references and webpage text offsets.
- Both comparison policies receive the same stored source text.
- Source-bound inference requires Live mode and explicit source-submission confirmation.
- File limit 10 MiB; PDF limit 100 pages; CSV limits 10,000 data rows and 200 columns; extracted-text limit 100,000 characters.
- Web response limit 5 MiB, configured 10-second retrieval limit, at most three redirects, public-address checks and connections pinned to a checked IP.
- Web fetch accepts HTML/plain text, excludes script/style content and strips query strings from stored URL provenance.
- Unbound previews expire after 30 minutes and can be deleted. Bound sources are retained and cannot be deleted through the source endpoint.
- No OCR, JavaScript browser rendering, authenticated browsing or whole-site crawling.
- Input references are **not validated answer citations**.

Evidence: `backend/app/sources.py`, source routes in `backend/app/main.py`, `backend/app/store.py`, `frontend/src/SourceInput.tsx`.

**Website issue status:** there is now a real fetching implementation, unlike the earlier checkout. The user's previously reported failing URL/error has not been supplied or reproduced in this audit. Its fix is therefore unverified. Compressed responses are explicitly rejected; JS-only and access-restricted pages are outside the implemented flow. Do not claim the original reported failure is resolved merely because the new code was merged.

### Operational controls and persistence

- One active queued/running job enforced through SQLite; serial comparison/benchmark execution.
- Server-side live enablement, request caps, rate limits, run/day spending reservations and provider deadlines.
- Unknown failed-call usage retains a conservative reservation; it is not presented as exact spend.
- Safe error messages, no silent Live-to-Demo fallback and restart recovery.
- Persisted comparison/benchmark/agent snapshots and source records.
- These remain local prototype controls, not authenticated multi-tenant deployment security.

### Workspace agent: added scope

A new optional workspace agent can propose file reads/writes in an explicitly configured local workspace. It uses exact path scopes, per-action approval/hash checks, event logs, continuation/stop controls, bounded steps, secret-pattern checks and restart pausing. It has no shell, network, delete, Git or deployment action tools; model planning itself calls the configured provider.

This is an **extra feature relative to the original implementation prompt**. It does not substitute for cost-aware inference routing, native provider support or accurate billing accounting. Generated code is text, not automatically executed or tested.

Evidence: `backend/app/agents.py`, `backend/app/agent_schemas.py`, `frontend/src/AgentDashboard.tsx`.

## 2. Requirement-by-requirement comparison

Original section numbers are retained for traceability.

| Original section / objective | Current status | What exists | What remains |
|---|---|---|---|
| 1. Business mission | Partial | Real comparison workflow and explicit limitations | Evidence that a lower-cost policy preserves required quality on representative workloads |
| 2. Preserve architecture/team work | Implemented foundation | Existing stack, Demo/Live, additive features and merged teammate work | Continued contract coordination; new features still need full acceptance walkthrough |
| 3. Exact tokens and full transparency (P0) | Partial | Provider input/output counts, full text, finish/truncation state | Cache/read/write/TTL/reasoning categories, returned model/request IDs, raw allowlisted metadata, exact effective-prompt snapshots, supported content blocks, token inspector and preflight counts |
| 4. OpenAI + Anthropic + Groq (P0) | Partial | Groq-compatible adapter | Native OpenAI Responses and Anthropic Messages, provider capability registry and provider-specific normalization; streaming not implemented |
| 5. Accurate configurable pricing (P0) | Partial | Three hardcoded input/output rate pairs, unknown price/usage returns null | Decimal arithmetic/storage, immutable execution-time rates, custom prices, caching/tier/context/region/tool rules and editable catalog |
| 6. Request-cost dashboard (P0) | Partial | Backend comparison costs; benchmark aggregate costs | Compare UI cost display/breakdown, per-case cost inspection, pricing assumptions and complete token-cost panels |
| 7. Intelligent routing (P1) | Partial | Fixed category routing, manual benchmark selection, validation-triggered fallback | Cost-aware optimization, quality thresholds from relevant historical evidence, capability/latency constraints and calibrated evidence |
| 8. Evaluation vs production cost (P1) | Partial | Both sides retain costs; comparison fallback combines attempt costs | Explicit total evaluation expenditure, production-policy cost model and savings/overhead dashboard |
| 9. Business simulator (P1) | Missing | No simulator found | Volume/task-mix/cache/custom-rate/quality/fallback projections, monthly/annual savings and cost per validated request |
| 10. Better benchmarks (P1) | Partial | 26 synthetic cases, deterministic evaluation, dataset snapshots and export | Representative reviewed workloads, repeat runs, broad semantic evaluation, latency distributions, quality-adjusted cost and failure-sensitive policy metrics |
| 11. Document/web inputs (P2) | Partial, substantially implemented | Text/PDF/CSV/web import, previews, immutable captured text and locators | Validated answer citations/not-found outcomes, bound retention/deletion, real-site failure reproduction and stronger extraction acceptance evidence |
| 12. Reports/export (P2) | Partial | Comparison JSON/CSV and print report; benchmark analysis JSON | Complete cost/fallback CSV fields, selectable full/summary payloads, execution-time price provenance and dedicated PDF generation if required |
| 13. Environmental calculations | Implemented illustrative baseline | Token coefficients, chosen carbon intensity, caveats and negative savings | Persist coefficient snapshots; no measured provider electricity/carbon telemetry |
| 14. Architecture/contracts/storage | Partial | Modules, API 1.1.0, OpenAPI/types/examples, SQLite additive tables and recovery | Rich immutable attempt ledger, pricing/capability services, exact money persistence and broader migration/reproducibility guarantees |
| 15. Frontend experience | Partial | Compare/Benchmarks/Agent, source preview, search/copy, review, history and exports | Token/cost analytics, pricing/provider settings, simulator, routing-policy UI and completed browser accessibility review |
| 16. Safeguards | Partial, strong foundation | Limits, deadlines, reservations, serial jobs, explicit live/source consent | Comparison/benchmark user cancellation endpoint, richer pre-spend estimates and remaining production-security needs |
| 17. Tests/validation | Partial | Backend/frontend suites and mocked-provider checks | One current backend failure; new browser/live-site/provider acceptance verification; tests for missing P0 features |
| 18. Implementation sequence | Diverged | Source/report work and workspace agent added | Return focus to original P0 token/provider/pricing/transparency work before expanding optional scope |
| 19. Acceptance criteria | Not fully met | See detailed checklist below | Multi-provider, accounting, projections and verification gaps prevent full acceptance |
| 20. Engineering deliverables | Partial | Code, tests, contracts, environment examples, setup/demo and acceptance docs | Update stale docs, resolve known failure, complete missing deliverables and final reproducible demonstration |

## 3. Original 20 acceptance criteria

| # | Original acceptance requirement | Assessment |
|---|---|---|
| 1 | Existing Demo and Live comparisons remain usable | Implemented; automated coverage exists; fresh real-provider walkthrough not run after merge |
| 2 | Choose supported GPT or Claude when configured | Not met for native OpenAI/Claude; Groq-hosted GPT-OSS is different |
| 3 | Record actual provider input/output tokens | Implemented when supplied; missing remains null |
| 4 | Cache/reasoning categories without double counting | Not implemented as detailed categories |
| 5 | Inspect full output and effective prompt | Partial: output yes; exact assembled system/user/provider settings not stored as a complete execution snapshot |
| 6 | Transparent versioned pricing | Partial: hardcoded rates, no immutable per-attempt price version |
| 7 | Custom company rates | Missing |
| 8 | Compare two models/providers' API costs | Partial: Groq model benchmarks; no cross-provider flow |
| 9 | Respect provider tokenization differences | Groq-reported counts retained; cross-provider normalization/counting not implemented |
| 10 | Wrong cheap answer cannot count as quality-preserving savings | Partial: validation/review visible, but comparison aggregates are transport-success based, not quality-gated |
| 11 | Evaluation expenditure distinct from hypothetical savings | Not complete as a product/accounting feature |
| 12 | Explain routes/fallback | Implemented for deterministic rules and bounded fallback; not evidence-trained routing |
| 13 | Reproducible history and pricing | Partial: run/dataset/source snapshots exist; original pricing/effective prompt/coefficient snapshots incomplete |
| 14 | Label simulated values | Implemented labels in inspected paths; browser acceptance remains outstanding |
| 15 | Missing measurements never become exact zero | Generally implemented nullable fields; see fallback aggregation risk below |
| 16 | Environmental estimates not called measurements | Implemented caveats; no physical telemetry integration |
| 17 | Critical backend tests pass | Not met: latest run 156 passed, 1 failed |
| 18 | Frontend contracts match backend | Partial: typecheck/build/tests pass; comparison cost presentation/export is incomplete |
| 19 | Narrow displays and long outputs usable | Supporting styles/text controls exist; complete browser/responsive acceptance unverified |
| 20 | Convincing end-to-end demonstration | Main building blocks exist; updated rehearsal and acceptance record still needed |

## 4. Concrete gaps and risks found in code

### Cost is recorded but not carried through the comparison experience

`runner.py` now supplies `Result.cost_usd`. However, `App.tsx` does not show that field in the comparison result metrics, and `comparisonUtils.ts` explicitly assigns `cost_usd: null` to CSV rows. The CSV also represents one selected result per policy/task rather than expanding each fallback attempt into its own row. A full-cost export cannot be claimed yet.

### Export-time pricing is not an execution-time snapshot

`backend/app/benchmarks/routes.py` constructs the export's `pricing_snapshot` from the current `PRICES` dictionary. `BenchmarkRecord` persists the dataset, not the original pricing catalog. Changing rates later could produce an export whose assumptions do not match its stored costs. This directly conflicts with the original reproducibility requirement.

### Structural validation is not factual correctness

Classification accepts any configured label, even a factually wrong one. Extraction checks valid JSON and required keys, not whether values agree with the source. Fallback is useful for detected structural failures, but does not catch a plausible incorrect value. No numeric quality threshold or source-supported answer validator exists.

### Quality failures do not gate comparison aggregates

`metrics.compare()` selects pairs by `status == succeeded`. A failed deterministic check can still have a successful provider status and enter the energy/latency aggregates. These aggregates must not be presented as demonstrated quality-preserving savings.

### Failed fallback can leave null metrics in a successful result

Code inspection shows a potential failure path: after an initial answer, a failed fallback preserves the initial answer with `status='succeeded'`, while combined latency/usage become null. `metrics.compare()` selects successful pairs and sums latency without excluding null latency. This may raise a `TypeError` and fail the run. This is a code-derived risk, not a reproduced failure in this audit; add a targeted regression test before fixing.

### Website retrieval has intentionally narrow compatibility

Only static HTML/plain text is supported; compressed responses are rejected, and only the first validated resolved address is attempted. These limitations may explain some failures, but the user's failing URL is still unknown. Public-address validation and IP pinning exist; passing mock tests is not a complete SSRF/security audit or real-site acceptance test.

### Larger output limits have cost/latency tradeoffs

Raising the default output cap removes the earlier 256-token restriction but is not proof of higher accuracy. Provider calls still have a 30-second deadline; reservations use a full input/output ceiling, which can reduce admitted benchmark case counts. The correct cap should be evaluated against actual task needs.

### Benchmark subsets need clearer coverage

Execution takes the first `max_cases` cases. The default cap is 10, so a larger catalog alone does not ensure later categories are exercised. Add deliberate subset/category selection or a documented full-suite process before claiming coverage of all 26 cases.

### Documentation contains stale branch/feature statements

`FEATURE_ACCEPTANCE_TESTS.md` still calls merged source/agent features branch-only and describes main as older API. `ISSUES_TO_FILE.md` mentions a 24-case dataset, while the current file has 26. Some historical “Live unverified” wording must be distinguished from the persisted nine-task evidence report. Update dated claims instead of treating all documentation as current truth.

## 5. Verification evidence and limits

The immediately preceding merge verification on this checkout produced:

| Check | Result |
|---|---|
| Merge of main `d07ab5b` | Completed without conflicts; local merge `f69b244` |
| Frontend TypeScript check | Passed |
| Frontend tests | 45 passed across 4 files |
| Frontend production build | Passed |
| Backend tests, after installing new pinned dependencies | 156 passed, 1 failed |
| Backend failure | `test_agent_actions_require_exact_approval_and_log_human_readable_steps`: expects `before\r\n`, macOS file contains `before\n` |
| New dependencies installed | `pypdf==6.21.2`, `python-multipart==0.0.32` |
| `git diff --check` during this audit | Passed |

These test results are from the preceding merge turn on the same code, not a newly rerun suite for this documentation audit. The initial backend collection failed before the dependencies were installed; the table reports the subsequent full run. The chained `uv pip check` did not execute because pytest exited nonzero; do not report it as passed.

No fresh paid inference, external website reproduction, real browser walkthrough or production-security audit was performed here. The earlier nine-task live evidence remains historical persisted application evidence, with user-reported answer correctness and illustrative environmental metrics.

The created accuracy-test PDF and separate answer key are local testing artifacts, not evidence that the app or models have passed that test.

## 6. Remaining work aligned to the original priorities

1. **Stabilize the current release:** correct the platform-dependent newline test; reproduce/test failed fallback aggregation; carry comparison costs into UI/CSV; reproduce the reported webpage failure; refresh stale docs and run the browser acceptance checklist.
2. **Finish original P0 accounting:** richer immutable attempts, exact effective prompts, provider metadata and usage categories; Decimal calculations/storage; execution-time pricing snapshots and custom rates.
3. **Finish original P0 provider/UI coverage:** native OpenAI and Anthropic adapters, verified capability registry and multi-provider selection; complete token/cost inspection panels.
4. **Finish P1 quality and economics:** explicit total evaluation expenditure, quality-aware policy evaluation, cost-aware constraints, representative held-out benchmarks and a business-volume simulator.
5. **Finish P2 evidence/reporting:** validated citations/not-found outcomes, source retention/deletion, complete reproducible exports and final accessibility/demo review.

The current product can truthfully be described as: **a Groq-based inference comparison and benchmark prototype with source import, deterministic validation, optional escalation and a bounded workspace agent**. The full planned claim—**a reproducible multi-provider platform that selects cheaper models while preserving specified quality**—still requires the core accounting and evaluation work above.
