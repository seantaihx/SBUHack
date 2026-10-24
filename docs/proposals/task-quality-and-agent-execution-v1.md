# Proposal: task quality and bounded agent execution

**Status: IMPLEMENTED ON `Muffin_branch` (2026-10-24); backend/frontend automated checks pass. Review and merge are still pending.**

The user reports that Sean approved the proposal. Backend/OpenAPI work was implemented on `Muffin_branch`; Sean's review is still required before merging to main. This milestone does not implement arbitrary company-agent adapters, shell commands, or unattended repository edits.

## Implementation checkpoint

- Live comparison now uses versioned task-type instructions, supports `write` and `code`, validates allowed classification labels and configured extraction fields, and offers an opt-in single large-model escalation for eligible deterministic failures. Provider errors and truncation are not retried. Fallback attempt accounting remains nullable when provider data is missing.
- `starter-v2` is version 2.1.0 with 26 synthetic cases including writing and code-generation prompts. Their lexical checks do not verify semantic correctness or execute code.
- The workspace agent is implemented as an opt-in local-only prototype: exact-path UTF-8 reads/writes, per-action approval, duplicate rejection, unknown-operation denial, event log, manual continuation and bounded model calls. Shell/network/delete/git/deploy/permission tools and code execution are absent. Restart pauses active work.
- Automated verification: backend `157 passed`; frontend Vitest `45 passed`; TypeScript typecheck and Vite production build passed. No real provider inference or browser walkthrough against Sean's running backend was performed in this milestone.

## Pre-implementation baseline (proposal snapshot)

- Comparison tasks accept only `classify`, `extract`, and `summarize`. `task-routing-v1` sends classify/extract to `small`, summaries to `large`; the client supplies the task type. There is no difficulty inference.
- The live provider uses a generic system message. It forwards the task prompt and, when attached, extracted source text as untrusted evidence. The same source snapshot is used for both policies.
- Completion output is configurable up to 65,536 tokens and clamped to known model ceilings. `finish_reason=length` is captured and marked truncated. Benchmark evaluation does not count a truncated or unverifiable output as a correctness result. There is no automatic retry/fallback.
- Source preview currently supports pasted text, text-based PDF, UTF-8 CSV, and public static webpage retrieval. Scanned/encrypted PDFs, OCR, authenticated pages, and JavaScript-rendered pages are unsupported. Source references are locators, not validated citations.
- Benchmark checks are deterministic exact/JSON/required-fact checks on synthetic fixtures. They are not a semantic judge and do not establish answer-quality equivalence.
- The shared v1 API has no company-agent integration, tools, permission model, approval queue, action log, or agent loop state.

## Proposed phase A: improve quality within comparison runs

Keep the paired baseline/optimized experiment interpretable: both policies receive the same task-specific instruction, source snapshot, generation settings, and validator. A policy change must be versioned and returned in results.

### Task-specific instruction profiles

Add server-owned, versioned profiles keyed by task type. Each profile should specify the requested output format, allowed labels/fields when applicable, missing-information behavior, source-use rules, and concise examples. Treat user prompt and extracted source as untrusted data; source text must never override the system instruction. Store the profile version on each run/result. Do not accept arbitrary system prompts from the browser.

Initial profile behavior:

- `classify`: choose exactly one configured label; return a configured abstention value if evidence is insufficient.
- `extract`: return a JSON object with declared fields; represent absent fields as `null`, never guess.
- `summarize`: preserve only supported key claims and state when the source lacks requested information.
- `write`: produce the requested prose or document section; include explicit constraints and distinguish source facts from invented examples.
- `code`: produce code for the declared language/runtime, explain assumptions, and do not claim execution or tests unless an approved executor actually ran them.

Adding `write` and `code` to comparison `Task.type` is a contract change. Do not land UI task options until Sean updates Pydantic schemas, policy, samples, OpenAPI, fixtures and tests and both teammates accept routing semantics. Proposed default: baseline `large`; optimized also `large` for `write`/`code` until held-out evaluations establish safe small-model routing. The UI must describe them as prompt-generation/comparison tasks, not autonomous coding agents.

### Validation and selective escalation

1. Parse/validate deterministic properties first: JSON syntax/schema, allowed labels, required fields, data types, arithmetic where a deterministic expression is explicitly present, and source locator bounds.
2. Mark invalid outputs as validation failures; never silently repair them or score them as correct.
3. Add optional escalation only as a new, explicit policy version. On a deterministic validation failure or an explicit unsupported/abstain signal, rerun the same task on the configured large model. Preserve both attempts, reasons, outputs/errors, tokens, costs, and latency. The final answer is the fallback answer only when its own validation passes; otherwise report unresolved failure.
4. Keep retry count bounded (at most one escalation per task), apply the same overall deadline/spend admission safeguards, and never automatically retry ambiguous provider timeouts that might have incurred a charge.
5. Do not use model-generated confidence percentages as correctness evidence. A future confidence field may be logged as a model claim, never as a validation pass.

Proposed new response fields (Sean to refine in OpenAPI): `validation_status`, `validation_checks[]` with stable check IDs and safe human-readable summaries, `escalation_reason`, and `attempts[]`. Each attempt needs model ID, status, finish reason/truncation, nullable usage/cost/latency, and safe error. Keep output nullable for failures and keep all unavailable metrics null.

### Evaluation quality

- Add held-out coding and writing cases plus adversarial/missing-source cases. Keep answer keys out of model inputs.
- Use objective checks where feasible: compile/run only in a separate controlled evaluator with fixed timeout/resources and no ambient secrets/network; unit/hidden tests for coding; rubric dimensions and blinded human review for open-ended writing.
- Report pass/fail/incomplete counts and the exact evaluator. Separate formatting/structural validity from semantic correctness. Never describe lexical overlap as answer correctness.
- Compare baseline, optimized, and optimized-with-escalation on identical cases. Report quality, fallback rate, total provider calls, cost, latency, and truncation together.
- Keep synthetic fixture results labeled simulated. Do not use them to claim real-model quality.

## Proposed phase B: bounded company-agent adapter

This is a separate product/API milestone, not an extension to the current inference endpoint. A chat-completions API is not itself an agent runtime. A company may integrate only through an explicitly supported adapter and a declared tool capability contract; do not assume that arbitrary vendor agents expose compatible execution or permissions.

### Safety defaults

- Default to **plan-only**: the agent may propose steps, but no tool executes until an operator reviews and starts the run.
- Execute in an isolated, disposable workspace with a configured root. Reject absolute paths, traversal, symlink escapes, and writes outside the allowed roots. Do not mount the user's home directory, credential stores, or host secrets.
- Default network access off. Commands come from a server-side allowlist with fixed executable and argument validation; do not execute model-authored shell strings through a shell. No arbitrary package install, deployment, git push, permission changes, or destructive commands in the first milestone.
- Define per-tool `allow`, `deny`, and `require_approval` rules. Unknown operations are denied by default. Approval is bound to the exact operation and arguments; changing either requires a new approval.
- Treat repository files, tool output, webpages, and agent-to-agent messages as untrusted instructions. They cannot grant permissions or override the user's approved scope.

### Loop and budget guards

- Require hard limits: maximum tool steps, wall-clock duration, input/output tokens, and estimated spend. Reject starts missing any limit; never let the agent increase them.
- Hash normalized tool name + arguments. Stop on repeated identical calls beyond a small configured threshold, repeated no-progress state, cyclic handoffs, or exhausted budget. Keep one global step budget across company-agent handoffs.
- Persist each proposed, approved, denied, started, and completed action before advancing. On stop, timeout, application restart, or policy violation, mark the run terminal/paused with a reason; never silently continue or restart.
- A policy violation blocks that operation and pauses the run for human review. It must not fall back to a more privileged adapter.

### Human-readable action log and proposed contract

Every event should include ordered sequence, timestamp, actor (`agent`, `operator`, `policy`, or `tool`), tool/action name, a redacted natural-language summary, scope target, decision, approval reference, outcome, and safe error. Keep raw secrets out of logs; bound and redact tool output. Show the requested scope and permitted actions next to the log, and make a denied/out-of-scope attempt prominent.

Candidate routes, names and fields are proposals only:

- `GET /api/v1/agent-capabilities`: supported adapters/tools, policy version, and hard limits; no secret or endpoint disclosure.
- `POST /api/v1/agent-runs`: task (`write`/`code`), workspace ID, explicit allowed paths/tools, resource limits, and `plan_only=true` by default; returns `202` and run ID.
- `GET /api/v1/agent-runs/{run_id}`: state, progress, final result, stop reason, and immutable policy snapshot.
- `GET /api/v1/agent-runs/{run_id}/events`: cursor-paginated action/approval audit log.
- `POST /api/v1/agent-runs/{run_id}/approvals`: approve/deny one exact pending action using an approval ID and operation hash.
- `POST /api/v1/agent-runs/{run_id}/continue`: explicitly resume a paused run within its original remaining budget; no endpoint may raise limits.

Before implementation, decide authentication/operator identity, workspace lifecycle/cleanup, adapter protocol, secret isolation, approval timeout, audit retention, and whether any code execution is in scope. These are blockers to safely enabling tools, not details to invent in the frontend.

## Acceptance tests required before enabling execution

1. Duplicate operation and cyclic handoff stop at configured limit; no extra tool call is executed.
2. Allow, deny, approval-required, and unknown-operation cases produce the exact policy decision. Mutating arguments invalidates prior approval.
3. Path traversal, absolute paths, symlink escapes, shell metacharacters, and writes outside the workspace are blocked.
4. A plan-only run executes zero tools. A policy violation pauses the run and is clearly visible in the event log.
5. Step/time/token/spend exhaustion stops safely; restart cannot repeat a completed operation.
6. Logs describe each action in readable language while redacting credentials and bounding output.
7. Code evaluation has no network/secret access and is isolated with CPU, memory, process, and wall-time limits.
8. Coding/writing quality is measured on held-out cases; incomplete/truncated attempts are not counted as passes.

## Suggested implementation sequence

1. Sean and Muffin agree on scope and the v2 API/policy proposal; Sean owns backend, OpenAPI and shared fixture updates.
2. Implement task profiles, deterministic validators, provenance fields, and held-out benchmarks without enabling agent tools.
3. Evaluate fallback as a separate versioned policy and expose full attempt-level accounting.
4. Prototype the agent runtime plan-only, policy evaluator and audit events; do not expose execution controls yet.
5. Add one isolated, low-risk tool only after the firewall acceptance tests pass. Keep write/code prompt comparison available separately from tool execution.

