# API contract

`openapi.json` is the OpenAPI 3.1 contract for the implemented `/api/v1` service. The API contract and backend tests document behavior that schemas alone cannot express, including validation, state transitions and paired aggregation.

Examples include configuration without credentials, create request, queued/completed demo snapshots, a hypothetical partial live snapshot, and a conflict error. Timestamps and model identifiers in examples are illustrative.

The backend uses Pydantic models matching these fields, including explicit nulls, and normalizes validation errors to `ErrorEnvelope`. The frontend uses the schema and examples as a reference for its API types.

Capabilities always returns both logical model roles exactly once, small then large. `live_model_id` is null when not configured. `live_disabled_reason` is null when enabled and a safe explanation when disabled. No key or endpoint URL is returned.

Schema validation alone does not check duplicate task IDs, exact demo fixture matching, output/error exclusivity, complete run state transitions, semantic pair counts or calculation accuracy; those are required behavior tests.
