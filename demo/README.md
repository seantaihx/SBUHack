# Demo fixtures

All content, token counts and latency values are synthetic. The demo adapter waits 150 ms per attempt only to expose progress, then returns the fixture's latency rather than measuring the artificial wait. The UI labels this simulated. Both policies' fixed answers are identical by construction; that is not an accuracy finding.

For the three tasks in order: baseline latency total 4700 ms; optimized 2750 ms. Baseline energy 0.0434 Wh; optimized 0.02644 Wh under illustrative-v1. These totals are test oracles for implementation, not factual claims about real models.

Load fixture files relative to the repository/application location, not an accidental working directory. Treat these files as version-controlled inputs, not generated test output. Demo accepts only the exact task definitions (with prompt edge whitespace trimmed) or their subsets.
