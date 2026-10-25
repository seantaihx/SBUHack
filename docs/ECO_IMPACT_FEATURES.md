# Eco impact features

EcoAgent's environmental interface helps users inspect model-routing estimates without presenting them as measured electricity or verified emissions. The features use existing `/api/v1` run data and do not add or change backend endpoints.

## What the frontend adds

- **Routing footprint map:** pairs each task's baseline and optimized result and describes the estimated energy difference. The displayed model ID and routing reason come from the backend. Missing, pending, or failed estimates stay unavailable.
- **Carbon-intensity explorer:** previews the saved-carbon figure at a user-selected scenario intensity using `saved Wh × gCO₂e/kWh ÷ 1000`. It is a what-if view; it does not change the saved run, make a new request, or use live grid data.
- **Local impact ledger:** records up to 50 terminal comparisons that have complete usage pairs, deduplicated by run ID. It stores only run IDs, timestamps, provenance, task counts, cohort counts, selected intensity, and aggregate energy/carbon differences. It does not store prompts, model outputs, provider IDs, or API keys. Simulated and observed records are shown separately. Clearing the ledger deletes its local browser-storage entry.
- **Personal carbon target:** compares the current optimized run estimate with a user-entered target. The target is stored locally in browser storage and is informational only; it is not an enforced backend limit or organization-wide policy.

## Interpretation limits

Energy values use the backend's `illustrative-v1` coefficients. Carbon estimates apply the carbon-intensity scenario sent with the run. Both are estimates, not measured electricity, provider telemetry, live grid intensity, or proof of emissions reductions. A smaller estimated footprint does not establish equal answer quality; users should inspect and review the paired outputs.

Ledger carbon totals add each run's selected scenario. If runs used different intensities, the total combines those different assumptions. The ledger is browser-local and is not synchronized between devices or users.
