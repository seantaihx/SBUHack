# Frontend mock and benchmark-data inventory

The centralized client is [`../frontend/src/api/client.ts`](../frontend/src/api/client.ts). `VITE_USE_FRONTEND_MOCK=true` explicitly selects browser fixtures; the application displays fixture provenance. The default is real relative `/api/v1` HTTP transport. Backend simulation is a separate mode and is reported by the returned run.

## Browser fixtures (`frontend/public/mock`)

| File | Consumer | What it represents and limitation |
|---|---|---|
| `capabilities.json` | `api.capabilities()` | Static demo configuration, limits, illustrative energy coefficients, and disabled Live reason. It is not a backend health check. |
| `tasks.json` | `api.sampleTasks()` | Three synthetic sample tasks. |
| `run-queued.json` | `api.createRun()` | Fixed three-task acknowledgement; ignores submitted values. Mock mode only accepts the fixture's expected full task set. |
| `run-completed.json` | `api.getRun()` | Fixed synthetic outputs, latency, tokens, estimates, and aggregate metrics. No calculation or inference occurs. |
| `run-partial.json` | Manual/session-storage mock status selection | Hypothetical partial result with failures; no normal UI selector currently chooses it. |
| `source-preview.json` | `SourceInput` in fixture mode after explicit “Load synthetic … preview” action | Synthetic PDF/CSV preview and locators unrelated to the selected file. It cannot be submitted as a source-backed run. |
| `benchmark-datasets.json` | `benchmarkApi.listDatasets()` | Static dataset/model catalog for fixture UI. |
| `benchmark-runs.json` | `benchmarkApi.listRuns()` | Static empty history page; local mock runs are overlaid in browser memory. |
| `benchmark-run.json` | Mock benchmark start and polling | Synthetic queued/running/completed snapshots. Mock outputs are not inference measurements. |
| `benchmark-cases.json` | `benchmarkApi.getCases()` | Synthetic case outputs/evaluations for fixture rendering. |

The comparison mock polling path changes to the fixed completed fixture after a short delay and stores that selection in `sessionStorage`. The benchmark mock assembles local run snapshots from its fixed fixtures. Neither mode calls the backend. Mock exports are disabled. Fixture mode is for interface demonstration only.

## Executable benchmark datasets

| File | Cases | Use |
|---|---:|---|
| [`../benchmarks/starter-v1.json`](../benchmarks/starter-v1.json) | 5 | Small stable regression dataset. |
| [`../benchmarks/starter-v2.json`](../benchmarks/starter-v2.json) | 24 | Broader synthetic analysis set. Server returns an effective per-run maximum, currently bounded by request and spend guards. Runs may be explicitly split; each export marks whether it covers the whole dataset. |
| `proposed-agent-firewall-v1.json`, `proposed-out-of-scope.json`, `v1-scenarios.json` | Varies | Planning/reference data only; not in the executable catalog and not evidence of implemented agent-loop or permission-firewall behavior. |

These datasets use synthetic input and expected values with deterministic evaluators. Passing means the declared exact/lexical check passed. It does not establish semantic answer quality. Live provider output, where configured, is reported separately from deterministic simulation.

## Shared contract examples

`contracts/examples/*.json` are examples for contract consumers and reviewers, not files loaded by the browser mock client. They cover comparison and benchmark requests, success/partial outputs, pagination, and safe errors. Generated OpenAPI in [`../contracts/openapi.json`](../contracts/openapi.json) is the API source of truth. Frontend copies can drift; update them only when their corresponding UI fixture should change.

## Remaining fixture risks

- Mock mode uses fixed IDs and does not model independent persisted runs, backend validation, rate limits, or real cancellation/network failure timing.
- `source-preview.json` can look like a successful parser result, so the UI must retain the explicit synthetic-fixture labels and keep it non-submittable.
- Fixture costs, token usage, latency and energy/carbon estimates are synthetic or illustrative. They must not be presented as measured results.
- API mode failures must remain visible; they must never fall back to these files silently.
