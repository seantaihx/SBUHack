# Workspace Agent reliability checks

`benchmarks/agent-reliability-v1.json` defines synthetic protocol cases for the bounded Workspace Agent. They exercise recovery and safety behavior; they are not model-quality measurements and do not contain live provider results.

## Run the automated coverage

From the repository root in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_agents.py backend/tests/test_api.py -q
cd frontend
npm.cmd test -- --run src/AgentDashboard.test.tsx
npm.cmd run typecheck
npm.cmd run build
```

The automated backend tests mock the provider and assert API state, filesystem state, call counts, and stop reasons. The browser tests verify that longer call budgets and completion-check selections are submitted. No test sends prompts to a real model.

## Scenario mapping

| Dataset scenarios | Automated coverage |
|---|---|
| More than 12 calls, bounded by backend budget | `test_agent_allows_longer_bounded_run_but_never_above_provider_budget` |
| Identical read and changed-file reread | `test_agent_duplicate_operations_pause_without_second_execution`, `test_changed_file_can_be_reread_but_noop_write_is_paused` |
| No-op write despite changed summary wording | `test_changed_file_can_be_reread_but_noop_write_is_paused` |
| Explicit recovery after a transient provider error | `test_transient_provider_failure_requires_explicit_continue` |
| Three repeated provider failures stop | `test_repeated_identical_provider_failures_stop_after_three_user_reviewed_calls` |
| Forbidden shell/tool action denied | `test_agent_denies_disallowed_operations_without_running_them` |
| Model finish with missing required output | `test_completion_checks_pause_unverified_finish_and_verify_after_output` |

The JSON records measurable pass conditions for future harnesses. For this milestone, task completion, call count, check result, filesystem mutation and stop reason are directly asserted. Time, false-block rates across representative tasks, real provider cost and semantic correctness require a separate controlled evaluation; they must not be inferred from these mocked cases.

## Current boundaries

- Per-run model calls are at most 20 and also capped by `INFERENCE_MAX_REQUESTS_PER_RUN`; provider cost and daily limits still apply.
- Provider errors pause for explicit continuation. The same failure three times ends the run. No automatic retry, task decomposition, model escalation, command execution, or generated-code execution is implemented.
- Exact path permissions and individual read/write approvals remain mandatory. Completion checks only inspect bounded UTF-8 text files within the allowed write paths.
- A passing file/format check does not prove semantic correctness. A model completion without checks is clearly marked `not_requested` and is not independently verified.
