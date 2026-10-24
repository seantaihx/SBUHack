# Expanded benchmark catalog and analysis export proposal (implemented subset)

**Status: Implemented on `Muffin_branch` as additive API v1 routes.** See [`../API_CONTRACT.md`](../API_CONTRACT.md) and [`../../contracts/openapi.json`](../../contracts/openapi.json). The implementation preserves `starter-v1`, adds the 24-case synthetic `starter-v2`, publishes the effective per-run cap, adds a Groq Qwen preview model option with known price, records completion/truncation, and exports the complete dataset plus all persisted run cases. Multi-provider adapters and cross-batch aggregation remain out of scope.

> Historical proposal below: it records the original alternatives and questions before the current v1 implementation. Its `/api/v2` route suggestions and pending decisions are superseded. The accepted route names, limits, schemas, and current verification are in `docs/API_CONTRACT.md`; do not treat old sample shapes or decision lists below as current requirements.

## Why this is needed

The current executable dataset is `starter-v1` with five synthetic cases. `BENCHMARK_MAX_CASES` also defaults to 5. The request schema permits larger integers, but the service rejects values above the dataset or configured limit. The catalog contains only the configured small and large Groq-compatible model IDs. `eco-auto` is a routing policy, not a third model. The UI shows results from the run and case endpoints but cannot download a complete self-contained artifact with the authored inputs and evaluation criteria.

Increasing the case cap alone does not expand the dataset. Increasing dataset size or the cap must remain bounded by request-rate, per-run/day spend, timeout, and storage safeguards. With the current paired execution, each requested case can dispatch one baseline and one candidate attempt; the current default per-run provider request cap of 20 therefore limits a paired run to ten cases.

## Proposed versioned routes

All routes are relative to `/api/v2` (or a separately agreed additive v1 extension). Existing v1 clients and persisted run snapshots remain valid.

### `GET /benchmarks/datasets`

Returns versioned dataset summaries, the current executable case count, provenance, supported configuration IDs, and the effective server maximum for one run. The UI uses the effective maximum and does not guess from a hardcoded constant.

### `GET /benchmarks/datasets/{dataset_id}`

Returns the immutable authored dataset definition, including every case input and complete evaluator criteria. Unknown dataset/version returns the existing safe error envelope. Case order and evaluator meaning are stable for a dataset version.

Proposed case definition:

```json
{
  "case_id": "extract-order-001",
  "category": "structured_extraction",
  "input": "Return JSON with order_id and total_usd. Text: Order ECO-1042. Total $42.50.",
  "expected": {"order_id": "ECO-1042", "total_usd": 42.5},
  "evaluation": {
    "method": "json_schema_and_values",
    "required_values": ["order_id", "total_usd"],
    "additional_properties": false
  },
  "provenance": "synthetic"
}
```

Evaluator definitions must be typed, deterministic when so labeled, and versioned. A lexical check must never be described as semantic answer-quality evaluation. Cases without a defensible automatic check must say `human_review` and remain unscored by automated pass-rate metrics.

### Model/configuration identity

The model catalog must enumerate only adapters and model IDs actually supported by the running backend. Each choice identifies provider, model ID, display label, availability/configuration status, capabilities/limits, and pricing snapshot or an explicit unavailable value. Configuration checks must not claim account access or live reachability.

For v2, replace the ambiguous string-only choice with a discriminated configuration. One possible shape is:

```json
{"kind":"model","provider_id":"groq","model_id":"openai/gpt-oss-20b"}
```

or

```json
{"kind":"policy","policy_id":"eco-auto","policy_version":"task-routing-v1"}
```

The exact names and support fields require team agreement. Do not accept arbitrary provider/model strings or label a routing policy as a model. Keep the v1 baseline/candidate request readable for historical runs.

### `GET /benchmarks/runs/{run_id}/export`

Returns a single JSON analysis package assembled from the persisted run, the exact immutable dataset version used, and all persisted case results. It must not reconstruct an input from an output or fetch a newer dataset definition for an old run.

Proposed envelope:

```json
{
  "export_version": "benchmark-analysis-v1",
  "exported_at": "2026-10-24T20:00:00Z",
  "data_completeness": "complete",
  "dataset": {"dataset_id":"starter-v2","version":"2.0.0","provenance":"synthetic","cases":[]},
  "run": {"run_id":"<uuid>","status":"completed","measurement_source":"simulated"},
  "configurations": {"baseline":{},"candidate":{}},
  "assumptions": {"pricing_snapshot_ids":[],"evaluation_method":"versioned per case"},
  "cases": [
    {
      "definition": {"case_id":"example-001","input":"...","expected":"...","evaluation":{}},
      "result": {
        "status":"passed",
        "evaluation_method":"exact_match",
        "evaluation_details":"Deterministic exact comparison; not semantic quality evidence.",
        "baseline": {"provider_id":"groq","model_id":"...","output":"...","input_tokens":null,"output_tokens":null,"latency_ms":null,"cost_usd":null,"error":null},
        "candidate": {"provider_id":"groq","model_id":"...","output":"...","input_tokens":null,"output_tokens":null,"latency_ms":null,"cost_usd":null,"error":null}
      }
    }
  ]
}
```

The real schema must include run and dataset IDs/versions, timestamps, all case definitions, expected checks, both complete available outputs, provider/model/policy and routing reasons, per-attempt status/errors, usage and its provenance, latency, cost breakdown and pricing assumptions, evaluator result/method, cohort denominators, and provenance. Unknown values remain JSON `null`. Cost is labeled estimated unless provider billing confirms it. Do not include credentials or private environment data. If output is truncated by the provider, expose that status and reason; do not call it complete.

For runs with unavailable historical dataset definitions or metadata, export `data_completeness: "partial"` and explain which fields are unavailable. Do not fabricate missing prompts, outputs, prices, model identities, or evaluator results.

## Limits and execution safeguards

- Dataset case count, UI maximum, API validation, worker iteration, progress total, pagination, and export contents must agree.
- The per-run case maximum is the minimum of dataset length, configured case limit, provider request allowance divided by worst-case attempts per case, and other applicable limits. Return the effective value in the dataset summary/capabilities.
- Keep request and spend controls authoritative. Do not raise spend limits automatically to make a large benchmark fit. If a dataset exceeds a single-run maximum, the UI must explain the cap and allow explicit bounded batches only if batch identity, aggregation, and denominator semantics are designed and tested.
- Dataset growth must include small-model failure cases and diverse tasks. A larger fixture count alone does not justify generalized quality claims. Report sample sizes and separate automatic checks, human review, provider errors, and skipped cases.
- Simulated runs remain explicitly simulated. Live benchmark inference requires explicit backend configuration and user action; no automatic Demo fallback or unprompted provider calls.

## Compatibility and verification

- Preserve API v1 routes and old snapshots. Add a versioned contract or an agreed additive extension only after review.
- Update OpenAPI, typed frontend definitions, examples, backend schemas, storage/migration behavior, README, and QA documentation together.
- Test unknown dataset/model/version, request-cap and spend-limit rejections, pagination and export completeness, old-run partial exports, provider failures, null usage, output truncation, restart recovery, and CSV/JSON round trips.
- Verify exported JSON parses and reconstructs every definition/result pair. Do not claim benchmark quality equivalence from synthetic outputs or lexical checks.

## Decisions requested

1. Approve an API v2 export route or choose an additive v1 path.
2. Approve the dataset-definition and model-configuration schemas.
3. Confirm an initial dataset size and effective per-run case/request cap without raising spending limits implicitly.
4. Confirm provider/model catalog fields and whether model adapters beyond Groq are in scope for this milestone.
5. Confirm retention and availability of exact dataset definitions for historical runs.
