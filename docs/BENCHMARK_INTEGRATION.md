# Benchmark frontend integration

The proposed frontend contract was accepted by Sean on October 24, 2026 and implemented under `/api/v1/benchmarks`. See [API_CONTRACT.md](API_CONTRACT.md#accepted-benchmark-api-october-24-2026), [OpenAPI](../contracts/openapi.json), and [backend handoff](backend-handoff.md). Existing frontend source and package files are unchanged from main a7e3767.

## Real transport, simulated inference

`VITE_USE_FRONTEND_MOCK=false` selects the real API (also the frontend's default). `BENCHMARK_INFERENCE_MODE=simulated` selects the backend's deterministic inference adapter independently. The browser loads datasets and history, POSTs once, polls the run, and fetches cases when terminal. Pagination uses the existing Load more controls; cursors are scoped and validated by the backend.

On macOS with Node 24 on PATH:

```sh
# Repository root, first terminal
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
# Second terminal
cd frontend
VITE_USE_FRONTEND_MOCK=false VITE_API_PROXY_TARGET=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Production same-origin: `VITE_USE_FRONTEND_MOCK=false npm run build --prefix frontend`, then open port 8000 directly. No CORS changes or frontend keys are required.

## Verified walkthrough

Against real FastAPI/SQLite with simulated backend inference: original comparison completed and restored after refresh; benchmark catalog loaded; submission and polling reached Completed; all five case outputs/routes/evaluations rendered; history survived refresh and backend restart. A deliberately stopped temporary backend produced a visible HTTP 502 through the Vite proxy without fixture fallback. The built frontend also submitted a benchmark on the backend origin. These are integration checks, not measured Groq performance.

## Limits and follow-up

- Live adapter tests use mocked HTTP responses. No Groq key is configured, and no billable inference was run.
- Root `.env` is loaded by the backend; `api.env` is not loaded. GROQ_API_KEY must never appear in any VITE_* setting.
- The current wire request lacks mode; backend mode is an explicit server setting and the run's simulated/observed field is authoritative. Before submission the current UI says SOURCE PENDING.
- Comparison and benchmark endpoints share one active slot. The comparison view currently treats active_run_id from 409 as a comparison ID; it cannot automatically reopen a benchmark. Switch to Benchmarks/history; coordinate a future active_run_kind-aware frontend improvement.
- Required-facts evaluation is explicitly lexical, not an LLM judge or semantic correctness guarantee. Simulated outputs equal expected answers by construction.
