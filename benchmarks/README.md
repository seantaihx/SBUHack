# Benchmark fixtures

These fixtures describe reproducible checks for the v1 comparison API. They are test inputs and acceptance criteria, not evidence that a backend benchmark has run. Execute them against an isolated development service and preserve the run snapshots with the API version, policy version, and fixture version. Do not use fixture-derived carbon estimates as measured emissions. The shared kit has example request/run snapshots but no standalone `sample-tasks` JSON; fetch the task definitions from the API before creating the run.

`starter-v2` version 2.1.0 has 26 synthetic cases, including coding and writing prompts. Its deterministic checks do not establish semantic quality; the coding case does not execute generated code. Use isolated, resource-limited evaluators and held-out cases before making quality claims.

## Running the v1 scenarios

1. Start the backend with its deterministic demo implementation and fetch `GET /api/v1/capabilities` and `GET /api/v1/sample-tasks`.
2. Submit each case from `v1-scenarios.json` as `POST /api/v1/runs`, using its mode, exact task objects, and carbon-intensity scenario.
3. Poll `GET /api/v1/runs/{id}` until `completed`, `partial`, or `failed`.
4. Compare the response with each case's pass conditions. Record failures; do not repair backend output in the browser.
5. For answer correctness, review the generated outputs against the criteria. The API does not define an automated quality score or guarantee equal quality. Mark a case unscored if its task prompt does not have an objective check.

Baseline-versus-optimized routing checks should confirm the backend's selected role and `route_reason` for each attempt. Compare numeric metrics only where the response supplies complete comparable cohorts; null means unavailable. `saved` can be negative (an increase). Latency, token counts, and outputs from demo fixtures are simulated.

## Deliberately out of the benchmark fixture set

The workspace-agent API now implements a bounded local action loop, exact-path read/write approval, duplicate-operation rejection, and denial of unknown/out-of-scope operations. These agent-specific benchmark files have not yet been adapted to the implemented run/event schemas and are still proposal data, not executable tests. They must not be described as measured agent pass rates.

`proposed-agent-firewall-v1.json` covers repeated operations, legitimate repeats, allow/deny/approval, and unknown operations. Its expected decisions remain pending explicit dataset acceptance and the data is not an executable starter dataset.
