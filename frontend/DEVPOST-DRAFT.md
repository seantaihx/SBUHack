# EcoAgent — Devpost draft

**Status:** Draft for the team. The frontend is implemented; the API/backend integration has not been verified in this checkout. Update this draft only after an end-to-end run against Sean's backend.

## Inspiration

AI inference requests can have different levels of complexity, yet a routing policy can send simpler work to a smaller model and retain a larger model for tasks such as summarization. We wanted to make that policy and its tradeoffs visible.

## What it does

EcoAgent is a single-screen comparison UI for a baseline policy and a task-aware routing policy. It is designed to fetch configured capabilities and sample tasks from an API, submit one comparison, poll its run status, and present the backend's routing decisions, outputs, latency, token usage, and estimates side by side.

The current frontend includes Demo and Live controls, exact sample-task selection, a Live task editor, run restoration by URL, progress and error states, cohort-labeled metric cards, an attempt table, plain-text response comparison, and an assumptions disclosure. These are frontend capabilities; actual completed comparison results depend on the backend API.

## How it was built

React, TypeScript, Vite, and plain CSS. The browser client calls relative `/api/v1` paths and the Vite development server proxies `/api` to `http://localhost:8000`. All routing decisions and aggregate metrics are expected from the backend.

## What is measured and what is estimated

Demo outputs, token counts, and latency are simulated fixtures. The energy coefficients are hypothetical demonstration assumptions. Carbon intensity is a scenario input, not live grid data. Live mode is shown as unavailable whenever the API reports it disabled. No screen claims that paired responses have equal quality or that estimated values are measured emissions.

## Current verification and limitations

- Frontend TypeScript check and Vite production build pass.
- The fixture-backed UI path is available only when `VITE_USE_FRONTEND_MOCK=true`.
- The real FastAPI endpoints and a browser walkthrough against Sean's backend have not been verified from this checkout.
- No real inference provider, electricity telemetry, quality evaluation, public deployment, or Devpost submission is claimed.

## Team and links

- Team: add both teammates' names and profiles.
- Repository: https://github.com/seantaihx/SBUHack
- Demo video / hosted demo: add only after created and verified.
- Track: choose only after checking current event eligibility and submission form.
