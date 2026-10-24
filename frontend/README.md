# Frontend setup and deployment handoff

## Requirements

- Node.js compatible with the versions in `package-lock.json` and npm.
- The checked-in frontend mock can run without a backend. Normal development expects the agreed FastAPI service on port 8000.

## Install and run

```powershell
npm.cmd ci
npm.cmd run dev
```

Vite prints the local URL. By default, `/api` requests are proxied to `http://localhost:8000` and the UI calls `/api/v1`.

For a fixture-only preview, set `VITE_USE_FRONTEND_MOCK=true` in an untracked `.env.local`, then restart Vite. The banner identifies the frontend mock. Remove the setting or set it to false for API integration. The mock is a UI development aid and is not evidence of backend behavior.

## Configuration

Copy `.env.example` to `.env.local` for local overrides:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | API base consumed by the typed client; use the same-origin path for deployment. |
| `VITE_API_PROXY_TARGET` | `http://localhost:8000` | Vite development proxy destination for `/api`. |
| `VITE_USE_FRONTEND_MOCK` | `false` | Explicitly opt in to checked-in fixture responses. |

Vite exposes `VITE_` values to the browser bundle. Never place credentials, provider keys, or secrets in them.

## Checks and production bundle

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run preview
```

The build output is `dist/`. The shared project design has the API/backend serve the built frontend on the same origin; confirm the static mount and `/api/v1` routing with the backend owner before deployment. A standalone frontend container is not included because it would duplicate the agreed same-origin deployment and proxy configuration. `npm run preview` is a local static preview, not a production server.

See [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) for endpoint schemas and [`../docs/FRONTEND_QA.md`](../docs/FRONTEND_QA.md) for verification boundaries and outstanding checks.

## Comparison exports

For a loaded comparison run, **Export JSON** downloads the full available snapshot plus a separate local human-review annotation object. **Export CSV** creates one row per available task/policy attempt. The CSV quotes fields and doubles embedded quotes; potentially formula-leading text cells get a leading apostrophe for spreadsheet safety. Empty metric cells mean unavailable, not zero. Comparison v1 has no per-attempt cost or source references, so those fields are empty/unavailable.

**Print / Save PDF** opens the browser's print dialog and lets the user choose Save as PDF. It is a print workflow, not a direct PDF download. The report includes run state/provenance, workload/routing, available metrics, attempts, local review labels, and methodology limitations. Browser print pagination should be visually checked before treating the report as submission-ready.

Downloads contain supplied prompts and model outputs and may contain user-provided data. Never share them without reviewing their contents.

Source import and URL retrieval are not implemented in this frontend milestone. The proposed source API is [`../docs/proposals/source-import-export.md`](../docs/proposals/source-import-export.md); existing v1 remains text only.
