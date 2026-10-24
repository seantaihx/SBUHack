# Frontend QA and outstanding work

## Checks run in this checkout

Run from `frontend/`:

```powershell
npm.cmd ci
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
```

The 18 Vitest component tests exercise the comparison flow plus benchmark dataset loading, benchmark request payload, queued/running/completed polling, result/case display, null metric display, rate-limit errors, loading errors, and duplicate-submit protection. `npm.cmd ci`, `npm.cmd run test` (18 passed), `npm.cmd run typecheck`, and `npm.cmd run build` passed on October 24, 2026. Benchmark and frontend mock JSON files also parse successfully.

## Verification boundaries

- Component tests use mocked fetch responses. They do not establish compatibility with a running FastAPI service.
- The benchmark view's proposed API is not in shared OpenAPI and must be agreed before the backend implements it.
- Backend end-to-end smoke test and browser walkthrough remain outstanding until Sean's API is available on port 8000 or another agreed URL. Port 8000 was not listening during this verification.
- A browser UI session was unavailable for visual inspection; screenshot review is not complete.
- Automated tests do not assess screenshot quality, visual contrast by pixel measurement, or actual keyboard behavior in a browser.
- Desktop, tablet, and phone viewport review remains outstanding. Check long prompts/answers and the attempt table at narrow widths.
- No issue tracker entries are represented as filed unless linked below.

## Outstanding issues

### Functional

1. Run the integrated browser walkthrough against the agreed backend, checking `/capabilities`, `/sample-tasks`, `POST /runs`, and repeated `GET /runs/{id}` including a `409` and a provider failure case.
2. Verify the production frontend is served by the backend at the configured same-origin path and that `/api` failures remain JSON.
3. After Sean agrees the proposal, test benchmark datasets/history, submit, poll, rate-limit/provider-timeout errors, and case pages against FastAPI.

### Visual and interaction review

1. Capture and review screenshots at desktop, tablet, and phone sizes while keeping Demo/Live and simulated/observed provenance labels visible.
2. Walk the page with keyboard-only navigation and a screen reader; verify focus order and announcements for loading, errors, and run status.

GitHub issue links: not filed from this checkout. The connected GitHub integration did not grant issue-write access in the previous attempt; create separate Functional and Visual issues when write access is available.
