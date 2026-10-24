# Continue the shared EcoAgent repository

The kit has been adopted at the repository root on Sean_branch, and main's frontend/benchmark work at a7e3767 has been merged into this branch without frontend source edits. Read README.md for verified setup and docs/backend-handoff.md for current behavior and limitations.

1. Review the backend changes on Sean_branch and the accepted extension in docs/API_CONTRACT.md. Original comparison contracts remain valid.
2. Follow the team's reviewed-PR process before updating main or Muffin_branch; neither has been modified by this local integration.
3. Run the backend and built frontend on port 8000, or use the documented Vite proxy with frontend mocks false.
4. Keep BENCHMARK_INFERENCE_MODE=simulated unless you intentionally configure authorized live inference. Put GROQ_API_KEY only in private root .env or the backend environment; api.env is not loaded.
5. Test the real UI/API flow, preserve provenance labels, and reserve submission time before October 25, 2026 at 9 AM Eastern.
