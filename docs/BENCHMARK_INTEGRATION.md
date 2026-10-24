# Benchmark integration and handoff

The current benchmark API is implemented under `/api/v1/benchmarks`. Its source of truth is [the API contract](API_CONTRACT.md), [OpenAPI](../contracts/openapi.json), and the executable fixtures in [`../benchmarks`](../benchmarks). The older first milestone below is historical; it described a five-case-only interface and predates the expanded catalog and export.

## Current behavior

- `starter-v1` remains a five-case regression set. `starter-v2` contains 24 synthetic cases across classification, arithmetic, extraction, summarization, reasoning, formatting, and fact retrieval.
- `GET /benchmarks/datasets` reports the selected dataset's case count, supported model configurations, and `max_cases_per_run`. The UI sends at most that count. Spend/request guards can return a lower `details.max_cases_per_run`; the user changes the selection and explicitly resubmits.
- `GET /benchmarks/datasets/{dataset_id}` returns the full versioned case definitions. `GET /benchmarks/runs/{run_id}/export` returns the saved dataset definition, saved results, provenance, assumptions, and `data_completeness` in one JSON document.
- Configured GPT-OSS models and the priced Qwen Preview option are exposed by the backend. Qwen is labeled Preview and can be limited by the conservative per-run cost guard. Catalog presence does not prove account access.
- Paired attempts are serialized and bounded by the existing provider request/spend limits. The adapter records completion/truncation; incomplete outputs do not enter the evaluated pass-rate denominator.
- The deterministic evaluator is an objective, lexical or exact check where specified. It is not an LLM judge or a semantic quality guarantee. Simulation is explicitly labeled and cannot establish model performance.

## Local development

PowerShell from the repository root:

```powershell
# Terminal 1: backend, simulated mode, local SQLite
$env:LIVE_ENABLED = "false"
$env:BENCHMARK_INFERENCE_MODE = "simulated"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1

# Terminal 2: frontend development server with real HTTP transport
$env:VITE_USE_FRONTEND_MOCK = "false"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8000"
npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`, choose Benchmarks, run a bounded selection, then inspect cases and download the JSON analysis. This flow uses real FastAPI/SQLite transport with deterministic simulated inference and makes no provider call. On macOS/Linux use `.venv/bin/python`, `npm`, and the equivalent shell environment syntax.

Production same-origin: `npm run build --prefix frontend` with `VITE_USE_FRONTEND_MOCK=false`, then serve `frontend/dist` from FastAPI. No browser API key or CORS change is needed for same-origin deployment.

## Verification boundaries

- Automated backend tests use fake provider responses. No live Groq request, account check, or billable inference has been made.
- Existing UI tests cover benchmark catalog, case limits, incomplete results, export, and request errors. A full visual responsive/browser walkthrough is still outstanding in this checkout.
- Cross-view active-run 409 navigation is covered by the response's `active_run_kind`; the frontend should be verified against a live local backend before calling that browser flow verified.
- Synthetic expected answers and illustrative energy/carbon values are not real-world performance or emissions evidence.
