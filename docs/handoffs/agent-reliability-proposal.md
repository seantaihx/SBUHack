# Workspace Agent Reliability Proposal

**Status:** Implemented on `Muffin_branch` after Sean approved the reliability scope. See `contracts/openapi.json`, `docs/API_CONTRACT.md`, and `docs/02-api-and-data.md` for the current contract.

## Current behavior verified in this branch

- Agent runs and their event history are persisted as SQLite snapshots.
- Restart recovery changes an interrupted active run to a paused state with `APPLICATION_RESTARTED_REVIEW_REQUIRED`; it does not resume provider calls automatically.
- `POST /api/v1/agent-runs/{run_id}/continue` explicitly schedules one more model call for a paused run, including a run recovered after restart.
- Every proposed file read/write is separately approved. Paths are exact, operations are loopback-only, and shell/network/file execution remain unavailable.
- `max_steps` permits up to 20 model calls, bounded by `INFERENCE_MAX_REQUESTS_PER_RUN` and existing provider spending limits.
- Action fingerprints include operation, path, proposed content and the observed file state. An unchanged read is blocked, a changed-file reread is allowed, and no-op writes pause as `NO_PROGRESS_LOOP`.
- Optional bounded checks verify file existence/change, literal text, or JSON syntax; the run distinguishes verified, pending, failed and not-requested states.
- Same provider/structured-response failure pauses for explicit review; three repeated failures stop as `REPEATED_PROVIDER_FAILURE`.
- The frontend displays checkpoint sequence/time, remaining calls, check results and verification status.

Relevant current files: `backend/app/agents.py`, `backend/app/agent_schemas.py`, `backend/app/store.py`, `backend/tests/test_agents.py`, `contracts/openapi.json`, `docs/API_CONTRACT.md`, and `frontend/src/AgentDashboard.tsx`.

## Implemented first milestone

### 1. State-aware loop detection — implemented

Exact path permissions and per-action approval remain in place. Duplicate tracking uses the proposed action and observed workspace state:

- For reads, record the SHA-256 of the bytes read. A repeated read of the same path and same content is a repeat; a reread after the file changes is allowed and recorded as a new state.
- For writes, include the target file's pre-write SHA-256 (or an explicit missing-file marker) in the action fingerprint. The backend must still re-check that base hash at approval time.
- Pause a no-op write with `NO_PROGRESS_LOOP`. Do not block a changed-file reread or different useful operation solely because it targets the same file.
- A loop pause makes no tool call and requires the user to review and explicitly continue or stop.

### 2. Explicit checkpoints and resume — implemented

Reuse the persisted `AgentRun` and existing one-step `POST /continue` route; do not add a second resume route unless recovery proves the current route cannot safely serve it.

Additive run fields:

```json
{
  "checkpoint_sequence": 4,
  "checkpoint_at": "2026-10-24T19:42:00Z",
  "model_calls": 4,
  "max_steps": 20
}
```

Automatic task decomposition and task IDs are not implemented. Every persisted run snapshot advances the checkpoint. On restart, expose the last checkpoint and remaining model-call budget, keep the run paused, and require the existing explicit continuation action. Do not automatically replay an operation or resend a prior provider request.

### 3. Independent completion checks — implemented

A completion message from the model alone is not marked as verified. `AgentStartRequest` accepts an optional list of **machine-checkable** criteria scoped to exact permitted write paths:

- required output file exists;
- file changed from the checkpoint's starting hash;
- required literal text is present, if the user supplied that literal;
- JSON parses, when the user explicitly asks for JSON output.

Return each check as `passed`, `failed`, or `not_verifiable`, with a short explanation. Do not execute generated code, run shell commands, infer semantic correctness from a model self-review, or claim a successful test suite unless one was actually run through a separately approved tool. A run with unmet checks pauses for review rather than reporting verified completion.

## Request/response additions

Current additive contract fields:

- `AgentStartRequest.completion_checks`: optional list of up to 10 typed checks, scoped to exact `write_paths`; literal text is limited to 500 characters.
- `AgentRun.checkpoint_sequence`, `checkpoint_at`, completion-check definitions/results, starting fingerprints and `verification_status`.
- A 20-call hard ceiling, further bounded by `INFERENCE_MAX_REQUESTS_PER_RUN`; existing per-run/daily spending limits remain active. The browser cannot override the backend ceiling.
- Keep `POST /agent-runs/{id}/continue` as a single-call, explicit user action. It rejects runs with pending approvals or terminal states.

The response fields, enum values and limits are now part of the shared OpenAPI contract.

## Safety and recovery invariants

- Unsafe actions executed: **0**. Denied operations must never reach a filesystem/provider tool.
- No automatic resume after process restart.
- No automatic provider retry. Transient failures pause for explicit continuation; three repeated identical failure codes stop the run. Every attempt consumes the existing provider call/cost budget.
- Pending writes remain hash-bound; if the file changes before approval, reject the stale write and require a new proposal.
- A changed file may be reread only through the same exact-path approval flow.
- Completion checks are read-only and remain inside the already permitted exact path set.
- Human approval cannot grant shell, network, delete, code execution, Git, deployment, or permission-changing operations.

## Workflow benchmark scenarios

The separate synthetic workflow protocol is recorded in `benchmarks/agent-reliability-v1.json`; automated coverage is documented in `docs/AGENT_RELIABILITY.md`. It includes:

1. A legitimate workflow requiring more than 12 model calls but staying within the proposed configured hard budget.
2. An identical-action loop.
3. A changing-argument loop that makes no observable progress.
4. A necessary reread after an approved write changes the file hash.
5. A transient provider failure followed by a user-reviewed continuation (automatic retry remains off in milestone one).
6. A forbidden action such as shell execution; assert it is denied before any command/tool executes.
7. A model claims completion while a required output file/check is missing; assert the run remains unverified.

Report task completion rate, false-block rate, unsafe actions executed (must remain zero), model calls, provider-reported usage/cost where available, elapsed time, recovery outcome, and stop reason. Any simulated fixture result must be labeled simulated; do not present it as live model performance.

## Implementation record

1. Sean approved the scope; additive fields are documented in OpenAPI and the API contract.
2. Backend state fingerprints, no-op loop pause, checkpoint fields, and deterministic completion checks are implemented with regression tests.
3. The typed frontend client and Workspace Agent show checkpoints, remaining calls, verification state and check outcomes.
4. The frontend was visually checked at desktop and 320px phone widths for the comparison, benchmark results, source rejection, and completed Workspace Agent views. A keyboard-only Tab check confirmed the visible skip-link and logo focus states. No pending approval action was available in the restored completed run, so the approval screen was not manually demonstrated in this pass. The active local backend returned 404 for `GET /api/v1/local-settings/provider`, even though the route is present on this branch; restart the backend from this branch before testing key setup or a Live run.

## Remaining scope

- This milestone does not add automatic task decomposition, retries, stronger-model escalation, or code/test execution.
- A dedicated scoring harness for the synthetic workflow dataset remains unimplemented; current backend tests assert the listed scenarios with mocked providers. The integrated browser walkthrough still needs a restarted current-branch backend and an available pending approval action. No real provider call was made in this pass.
- The call limit is capped at 20 and remains subordinate to the provider's request, per-run cost and daily cost ceilings.
