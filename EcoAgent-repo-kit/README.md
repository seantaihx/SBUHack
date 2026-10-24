# EcoAgent

A hackathon prototype for comparing AI inference routing policies, with transparent estimates of energy and carbon impact.

**Status: design and contracts only. No application has been implemented or tested yet.** This kit was prepared after inspecting `seantaihx/SBUHack`: on inspection, `main`, `Sean_branch`, and `Muffin_branch` pointed to `1ed6e1b1bd09caa835b9ada3a3ead8bf59753e35`, containing only `# SBUHack` in README.md.

This is a proposed MVP, not a recovered copy of an earlier EcoAgent specification. The repository owner requested a complete shared plan; stack, scope, and assignment choices below are proposed defaults that the team can change together before implementation.

## Start here

1. Read `docs/01-product-and-architecture.md` together. Agree on the demo and scope.
2. Read `docs/02-api-and-data.md` and `contracts/openapi.json`. These define both sides of the app.
3. Sean uses `prompts/SEAN.md`; the collaborator on Muffin_branch uses `prompts/MUFFIN.md`.
4. Follow the milestone order in `docs/03-team-and-integration.md`. Connect the first screen to the backend before building all features.
5. Use `docs/04-acceptance-and-demo.md` before merging and presenting.

## Intended stack

- Frontend: React, TypeScript, Vite, plain CSS, npm.
- Backend: Python 3.11+, FastAPI, Pydantic v2, Uvicorn, HTTPX, standard-library SQLite.
- Demo: deterministic fixtures; runs without credentials or Internet.
- Live: one server-configured OpenAI-compatible chat-completions endpoint, including an accessible company-hosted endpoint. Two configurable model IDs are needed to compare routing choices.
- Deployment: one backend process serves the built frontend and `/api/v1/*`; same origin. Local development uses Vite's proxy.

Pin exact dependency versions and commit lockfiles during implementation. This kit does not prescribe unverified current package versions.

## Planned repository structure

```text
frontend/                 # Muffin owns, including its package.json/lockfile
backend/app/              # Sean owns
backend/tests/            # Sean owns
backend/requirements.txt  # Sean owns; pin resolved versions
contracts/                # Shared API; Sean coordinates approved changes
  openapi.json
  examples/
demo/                     # Versioned sample tasks and estimation profile
prompts/                  # Instructions for each AI assistant
docs/                     # Shared specification, workflow, acceptance
.env.example              # Sean owns; placeholders only
.gitignore                # Sean owns
README.md                 # Sean coordinates shared changes
```

No authentication, multi-tenant production system, fine-tuning, Kubernetes, hardware integration, or automatic movement of customer workloads is included in this MVP. GitHub stores and coordinates the code; an application process must still run the frontend/backend.

## Source event documents

- Hacker Guide: https://drive.google.com/file/d/1weKmgr1ZZYJkYIJuM-0kIzeusaEt84Eu/view
- Opening Ceremony: https://drive.google.com/file/d/183OOo7wZ4AQdFP-hiJfj7NSFzIhl1RJy/view

Both give a Devpost deadline of October 25, 2026 at 9:00 AM Eastern. Judging is 10:30 AM–1:00 PM in SAC Ballroom A. See `docs/05-submission.md` for verified facts, gaps, and recommendations.
