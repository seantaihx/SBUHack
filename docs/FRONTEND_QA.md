# Frontend QA and outstanding work

## Checks run in this checkout

Run from `frontend/`:

```powershell
npm ci
npm run test
npm run typecheck
npm run build
```

The Vitest component suite exercises startup capability and sample loading, disabled Live mode, exact demo selection payload, POST submission and run polling, terminal result rendering and provenance, `409` active-run recovery, partial/failure presentation, live task editing and payload, `?run=` restoration, polling retry without duplicate POST, per-task disclosure, carbon scenario payload, `503` without mode fallback, and safe plain-text output rendering.

## Verification boundaries

- Component tests use mocked fetch responses. They do not establish compatibility with a running FastAPI service.
- Backend end-to-end smoke test and browser walkthrough remain outstanding until Sean's API is available on port 8000 or another agreed URL.
- Automated tests do not assess screenshot quality, visual contrast by pixel measurement, or actual keyboard behavior in a browser.
- Desktop, tablet, and phone viewport review remains outstanding. Check long prompts/answers and the attempt table at narrow widths.
- No issue tracker entries are represented as filed unless linked below.

## Outstanding issues

### Functional

1. Run the integrated browser walkthrough against the agreed backend, checking `/capabilities`, `/sample-tasks`, `POST /runs`, and repeated `GET /runs/{id}` including a `409` and a provider failure case.
2. Verify the production frontend is served by the backend at the configured same-origin path and that `/api` failures remain JSON.

### Visual and interaction review

1. Capture and review screenshots at desktop, tablet, and phone sizes while keeping Demo/Live and simulated/observed provenance labels visible.
2. Walk the page with keyboard-only navigation and a screen reader; verify focus order and announcements for loading, errors, and run status.

GitHub issue links: not filed from this checkout. The connected GitHub integration did not grant issue-write access in the previous attempt; create separate Functional and Visual issues when write access is available.
