# Provider usage and cost transparency contract proposal

**Status: proposed for Sean and team review.** This document does not change OpenAPI, API v1, backend behavior, or the frontend's accepted types. The example is illustrative and is not provider telemetry.

## Why coordination is required

The current comparison `Result` exposes output text, client latency, aggregate input/output token counts, and illustrative energy/carbon values. It has no provider identity, provider request ID, detailed usage categories, finish/truncation state, effective messages, price snapshot, or API-cost breakdown. Benchmark responses expose a scalar `cost_usd` but no rate snapshot or completeness explanation. The accepted schemas reject undeclared properties, so adding response fields requires a compatibility decision and synchronized backend, OpenAPI, examples, frontend types, and tests.

The current UI must continue to show unavailable provider cost as **Unavailable**. It must not infer zero cost from null usage or recompute a provider charge in JavaScript.

## Proposed attempt observation

Keep the existing `Result` fields and add a versioned observation object to each completed or failed attempt. The example at [`examples/provider-attempt-v2.json`](examples/provider-attempt-v2.json) proposes:

- `provider`: provider identifier (`groq`, `openai`, or `anthropic`).
- `requested_model_id` and `returned_model_id`: distinguish configured input from provider response. Preserve existing `model_id` for compatibility until migration is agreed.
- `provider_request_id`, safe endpoint identity, request start/completion timestamps, and client latency.
- `effective_input`: exact role/content messages and supported generation parameters sent by the adapter. Redact credentials and transport headers. Treat prompts as user data and include them in export only when the user exports full input/output.
- `output_completeness`, `finish_reason`, refusal, and incomplete/truncation reason. `complete` means all user-visible content available from the provider response was stored; it does not imply hidden reasoning or content the provider did not return.
- `provider_usage`: provider-reported category names and values plus normalized input/output counts, provenance, and completeness. Keep reasoning tokens marked as a subset where the provider defines them that way. Do not add cache subdivisions on top of inclusive totals.
- `cost_estimate`: itemized component estimates, completeness, currency, pricing snapshot ID, and estimate basis. Keep unknown components null and expose known subtotals without representing missing rates as zero.
- `sanitized_metadata`: only an explicit allowlist; never store authorization headers, keys, raw request headers, or unrestricted provider payloads.

Amounts and rates should use decimal strings on the wire and decimal-safe storage/calculation. For example, `"0.00000125"` USD is exact, while a binary floating point JSON number may not preserve its decimal representation across consumers. The server remains authoritative for every total and delta.

## Pricing and expenditure semantics

Each attempt should reference an immutable rate snapshot containing provider, exact model ID, currency, rate source, source checked/effective timestamps, supported usage categories, and the rates applied. Custom rates must identify their user-supplied provenance. Historical observations retain their original snapshot; a later recalculation is a separate derived result under a new snapshot and must not overwrite the observation.

Expose these concepts separately:

1. **Evaluation expenditure:** all provider calls made by an evaluation, including baseline, candidate, router, verifier, retry, and fallback attempts.
2. **Modeled production-policy cost:** backend-calculated cost for a named policy and declared traffic assumptions.
3. **Projected savings:** baseline production cost minus candidate production cost under those same assumptions.

Provider API cost is an estimate from reported usage and the named rate snapshot, not a confirmed invoice. A pre-request budget reservation is a guardrail, not observed usage or expenditure. Unknown failed-call usage remains incomplete until reconciled; do not release its reservation by inventing zero.

## Compatibility choices for Sean and the team

Before implementation, agree on:

1. Whether the fields belong in a new `/api/v2` response, a negotiated/versioned schema, or an explicitly coordinated additive v1 revision. Existing v1 examples use closed schemas, so silent field insertion is not compatible with current contract validation.
2. Which provider SDK/endpoint versions and exact supported usage categories will be enabled first (Groq, OpenAI Responses, Anthropic Messages), including cache and reasoning subset rules.
3. Whether effective prompts and outputs are persisted in the run snapshot by default, and how export controls, retention, size limits, and sensitive content are handled.
4. Which public pricing sources and refresh process define immutable rate snapshots; how custom rates are stored and labeled.
5. How failed provider requests with absent usage are represented in evaluation expenditure and budget reservation reconciliation.
6. Whether SQLite decimal values migrate to canonical decimal text, integer scaled units, or another exact representation. Existing historical cost/usage remains unknown when absent; no backfill may manufacture it.

## Frontend work that can proceed independently

The current frontend can safely add search and copy for complete text already returned, and preserve existing mock/real transport behavior. Provider labels, full effective-input panels, detailed usage categories, cost breakdowns, pricing assumptions, and raw sanitized metadata views should be added only after the corresponding response contract and privacy rules are agreed. The current source import UI remains separately proposed and unavailable through the accepted API.

## Verification required after agreement

- Validate a legacy v1 response and stored snapshot unchanged, plus new responses against the agreed versioned schema.
- Test mocked Groq/OpenAI/Anthropic responses for missing, zero, malformed, inclusive, cache-subdivided, reasoning-subset, refusal, tool-call, truncated, and failed cases.
- Test decimal arithmetic for tiny amounts, unknown rates, custom rates, immutable snapshot reload, and migrated SQLite reservations.
- Confirm frontend displays null as **Unavailable**, known subtotals as partial, output completeness honestly, and never converts estimates into measured invoices or emissions.
- Keep live provider smoke tests explicit, bounded, and separately authorized; mock tests spend no provider quota.
