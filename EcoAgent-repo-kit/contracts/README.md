# Contract usage

`openapi.json` is OpenAPI 3.1 with JSON Schema-compatible components. It is a shared design contract, not generated evidence that endpoints exist. API behavior additionally follows docs/02-api-and-data.md, particularly validation, state transitions and paired aggregation. Some cross-field requirements cannot be expressed by these simple schemas and need tests.

Examples include configuration without credentials, create request, queued/completed demo snapshots, a hypothetical partial live snapshot, and a conflict error. Timestamps and model identifiers in examples are illustrative.

Backend builders: implement Pydantic models matching these fields, including explicit nulls; normalize FastAPI validation exceptions to ErrorEnvelope. Check actual OpenAPI for semantic agreement with this contract (generated schema names need not be byte-identical). Frontend builders: use this schema and examples; do not wait for a running backend to define response types.

Capabilities always returns both logical model roles exactly once, small then large. `live_model_id` is null when not configured. `live_disabled_reason` is null when enabled and a safe explanation when disabled. No key or endpoint URL is returned.

Schema validation alone does not check duplicate task IDs, exact demo fixture matching, output/error exclusivity, complete run state transitions, semantic pair counts or calculation accuracy; those are required behavior tests.
