# Benchmark frontend integration

## Current state

The benchmark view is a frontend integration scaffold. It uses a centralized `benchmarkApi`, TypeScript response types, and an explicit fixture mode. It does not call Groq and makes no claim that the proposed API is implemented. The benchmark endpoints/schemas in [`API_CONTRACT.md`](API_CONTRACT.md#proposed-benchmark-api-not-yet-agreed-or-implemented) need Sean's review before backend implementation.

## Proposed request flow

1. The view loads dataset catalog and the first page of prior runs.
2. The user picks a dataset, supported baseline model, candidate model or `eco-auto` policy, and case cap.
3. Submit exactly once to `POST /api/v1/benchmarks/runs`. The backend owns limits, Groq calls, evaluation, and stored run data.
4. Retain the returned `run_id`; poll `GET /api/v1/benchmarks/runs/{run_id}` every two seconds while active. Polling stops on terminal state or component unmount and exposes a manual retry after network errors.
5. On terminal status, request `GET /api/v1/benchmarks/runs/{run_id}/cases` and render returned cases as text.
6. Read history from `GET /api/v1/benchmarks/runs?limit=20`; cursor pagination is part of the proposal and needs UI follow-through before server pagination is enabled.

The current service inherits `VITE_API_BASE_URL` (default `/api/v1`) and `VITE_USE_FRONTEND_MOCK`. Mock mode is explicit and visibly labeled. Its progress changes only when the UI polls fixture-backed mock responses; no timer claims to perform inference. In API mode, errors never switch transport to mock. Frontend environment variables must contain only public backend location/configuration, never `GROQ_API_KEY`.

## Backend checklist for Sean

- Confirm proposed routes use `/api/v1/benchmarks` or provide the agreed prefix (the attached brief initially says `/api/benchmarks`).
- Confirm all schemas, model IDs, whether `eco-auto` is a supported candidate, and dataset catalog format.
- Confirm run states, cancellation behavior, conflict handling, error codes/envelope, pagination, and authentication.
- Define evaluator types and exact meanings for pass rate, total cases, cost, average latency, tokens, requests, and errors; return null when unavailable.
- Return measurement provenance and sanitized per-case provider errors/outputs.
- Enforce task caps, rate limits, and budget controls on the server. Frontend controls are convenience only.
- Keep Groq credentials in private backend configuration, not this frontend or the shared root `api.env` placeholder. Configure the backend's actual local secret file in its own ignored location.
- Add agreed routes/schemas to shared OpenAPI and provide success, partial, rate-limit, timeout, unavailable, and validation examples.

## Try fixture mode

From `frontend/`, create `.env.local` from `.env.example` and set `VITE_USE_FRONTEND_MOCK=true`, then run `npm.cmd run dev`. Select **Benchmarks**, submit a fixture run, and inspect its simulated progress and case results. Stop and restart Vite with the flag false for real API mode. The fixture numbers are illustrative and are not measured Groq/EcoAgent performance.
