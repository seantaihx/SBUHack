# Frontend and integration QA

## Current implementation

- Centralized typed client uses `VITE_API_BASE_URL` (default `/api/v1`). Multipart uploads leave the boundary to the browser. Fixture mode is explicit and does not pretend to parse/fetch a selected source.
- Source UI supports pasted text, PDF, CSV and public webpage preview through backend APIs. Submission attaches a source snapshot only after a separate Live-mode confirmation. Run refresh retrieves the exact retained source snapshot.
- Run responses preserve provider completion status. Truncated/unknown benchmark output is excluded from pass-rate calculations and displayed as incomplete.
- Benchmarks expose `starter-v1` (5 cases) and `starter-v2` (24 synthetic cases), with a server-reported effective per-run cap, optional priced Qwen Preview model, and a downloadable analysis JSON containing dataset definitions, outcomes and pricing assumptions.
- Comparison 409 responses now include active run kind; frontend routes to the correct comparison or benchmark without resubmitting.

## Checks to run

From the repository root in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend/tests
.\.venv\Scripts\python.exe -m pip check
npm.cmd run typecheck --prefix frontend
npm.cmd run test --prefix frontend
$env:VITE_USE_FRONTEND_MOCK = "false"
npm.cmd run build --prefix frontend
```

The backend source tests use injected DNS/HTTP transports, local SQLite and fake inference. They do not fetch private infrastructure or make provider calls. Frontend tests exercise real-client request construction using mocked HTTP responses.

## Verification limits and follow-up

- No live Groq request or account/model access check was made. `LIVE_ENABLED` and benchmark inference mode remain backend configuration choices; no key was read or displayed.
- No visual browser walkthrough, responsive screenshot set, browser-generated PDF review, keyboard-only session, or screen-reader session is recorded by automated tests. Complete those checks in a real browser before submission.
- PDF text extraction supports selectable text only. Scanned/image-only PDFs return a clear unsupported error because OCR is not installed.
- Source locators are extracted and validated against source snapshots, but the provider does not return validated answer citations or an explicit not-found state. Confirm source claims manually.
- Unbound previews expire after 30 minutes. Bound source content remains in SQLite with its run; this prototype has no source/run deletion or authentication. Use synthetic/public test data only.
- `starter-v2` is 24 cases, but the default per-run paired request cap is 10. Full-dataset evaluation requires explicit bounded runs; exports include all authored definitions and accurately mark subset completeness.
- GitHub issue search found no matching open issue; issue creation was denied by the connected integration with HTTP 403. Copyable functional and visual issue drafts are in [`ISSUES_TO_FILE.md`](ISSUES_TO_FILE.md).

## Source of truth

See [API_CONTRACT.md](API_CONTRACT.md), [OpenAPI](../contracts/openapi.json), [mock-data inventory](MOCK_DATA_INVENTORY.md), and the test modules under `backend/tests/` and `frontend/src/`.
