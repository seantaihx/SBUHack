# EcoAgent: five-minute judge walkthrough

Budget: **3:00 presentation and demo + 2:00 Q&A = 5:00 total.** One person speaks, one controls the app. Rehearse once with a stopwatch. If interrupted, answer briefly and skip the optional segment; finish the presentation at 3:00.

## Before judges arrive

- Start the current backend and production frontend build. Use the integrated app, not the frontend mock. Confirm health, sample tasks and a completed Demo comparison.
- Keep a completed Demo run URL ready in a second tab, and a completed simulated benchmark ready in another. Label both simulated. Do not depend on waiting for a hosted provider during the presentation.
- Choose starter-v1 with 5 cases for the benchmark. The 26-case starter-v2 catalog has a default 10-case run cap; do not say one default run evaluated all 26.
- If showing a Live result, verify that exact provider/model first and retain its provenance and errors. Use synthetic prompts. Keep credentials out of view.
- The Workspace Agent is optional: prepare a disposable workspace and a reviewed pending proposal ahead of time. Skip it if it has not been rehearsed. No setup or key entry during judging.

## Timed script and clicks

### 0:00–0:25 — Problem and value

**Say:** “Not every AI request needs the largest model. A simple classification and a complex writing task have different needs, but developers often use one default. We built EcoAgent to make that choice inspectable: compare a fixed large-model baseline with task-based routing, then look at the answers and resource tradeoffs together.”

**Show:** Compare page and the policy diagram. Keep the cursor still while introducing the problem.

### 0:25–1:20 — Main demo

**Click:** Keep Demo selected, select the three sample tasks, then **Compare policies**. Show progress, Routing breakdown, and Response comparison.

**Say:** “This is our integrated Demo: the browser is calling our FastAPI backend, while the model responses, token counts and timing are deterministic simulations. The baseline sends every task to the large model. Our current routing policy sends classification and extraction to the small model, while summarization stays on the large model. The backend records the selected route and the reason. Here are the two answers side by side, so a lower resource estimate does not hide the actual result.”

**Point:** One classify/extract row and its two outputs. Do not narrate every table column. If submission takes more than ten seconds, open the prepared completed run and say, “Here is a previously completed simulated run.”

### 1:20–1:45 — Environmental view

**Click:** Show the footprint map and briefly move the carbon-intensity scenario slider.

**Say:** “These energy figures use illustrative per-token coefficients. Carbon changes with the scenario intensity; this slider is a what-if calculation, not live grid data. We keep missing measurements unavailable; a smaller estimate alone does not establish an equally good answer.”

Do not quote a fixture percentage as achieved real-world savings. If no GPU data is present, leave it at that.

### 1:45–2:20 — Evaluation evidence

**Click:** Open the prepared Benchmarks tab/run. Show one case with its expected result and actual outputs, then point to **Download analysis JSON**.

**Say:** “A cheaper answer is useful only if it meets the task. Our benchmark lab compares configurations on the same authored cases, shows the exact evaluation rules and outputs, and exports the analysis. We have a five-case starter dataset and a broader 26-case catalog. These checks cover exact answers, JSON values and required phrases; they do not prove general reasoning quality. Live comparisons can also escalate an eligible failed small-model validation once to the larger model.”

### 2:20–2:45 — Optional agent OR architecture

**If an agent demo is already prepared:** show its pending write preview without improvising a new workflow.

**Say:** “We also apply explicit control to local agents. A Manager can assign writing, coding and review tasks to configured models, executed serially. Every file action needs approval for this exact path and content. We track limits and leave a durable handoff. The agent writes code as text; it does not execute it.”

**Otherwise say:** “The frontend is React and TypeScript. FastAPI owns routing, validation, job state and aggregates, and SQLite preserves the runs. We also support document and webpage source previews, local human review labels and exports. Our strongest verified path today is the integrated simulated comparison and benchmark workflow.”

### 2:45–3:00 — Close and invite questions

**Say:** “EcoAgent makes model-selection tradeoffs visible instead of assuming that one model fits every request. Our next validation step is representative Live workloads with independent quality review and calibrated energy measurements. We’d be happy to answer your questions.”

**Stop speaking at 3:00.** Leave the paired outputs or benchmark evidence visible for Q&A.

## 3:00–5:00 — Short Q&A answers

**What is the optimization algorithm?**
A transparent rule-based policy by task type, not a learned router: classify/extract go small, summarize/write/code go large. Optional deterministic validation can trigger one large-model fallback for eligible small-model failures.

**Does the comparison itself save resources?**
It runs both policies, so the evaluation costs extra inference. The purpose is to evaluate a routing choice before adopting it for a workload. We have not demonstrated net production savings.

**How much energy do you save?**
We cannot claim a verified percentage yet. Demo numbers are synthetic; token-based energy and carbon are illustrative estimates. Representative Live runs and calibrated measurement are needed.

**Do you measure energy?**
For a configured local Ollama comparison, we can sample NVIDIA device power when available. It includes idle and other GPU activity and excludes the rest of the system. Hosted-provider energy and emissions are not measured by this app.

**How do you know quality is preserved?**
We expose both answers, human review labels and authored deterministic checks. These detect specific failures; they do not establish semantic equivalence. Broader claims need held-out workloads and independent review.

**What is real versus simulated?**
The integrated Demo exercises real HTTP, routing, persistence and the UI with simulated inference. Provider adapters exist and have fake-transport tests. Only call a Live provider “verified” if we have actually exercised it on this machine; a dropdown option is not evidence of access.

**How is it different from just using a small model?**
It compares the choice against a baseline, retains larger-model routing for the other task types, and makes outputs, validation, routing reasons and available resource metrics reviewable together.

**Is the agent autonomous / parallel?**
It is bounded and approval-gated. It can propose local reads and writes, and a Manager can delegate to serial specialists. It has no shell, network, delete or code-execution tools. It does not control unrelated agents.

**Is it production-ready?**
It is a local hackathon prototype. Core simulated paths and automated tests are verified. Authentication, multi-user isolation, deployment hardening, representative model-quality evaluation and hardware/provider validation remain.

## If the demo breaks

1. Open the prepared completed run; say it is a saved run.
2. If the backend is unavailable, use a clearly labeled saved screenshot/export and explain that it is a recorded result. Never call a frontend fixture a live backend run.
3. Skip the agent and advanced controls. Preserve the paired-answer explanation and the two-minute Q&A window.
