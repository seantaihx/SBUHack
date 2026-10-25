import { useEffect, useRef, useState } from 'react';
import { ApiError, api, benchmarkApi } from './api/client';
import type { BenchmarkCase, BenchmarkDataset, BenchmarkRun, StartBenchmarkRequest } from './api/types';

const missing = 'Unavailable';
const done = (status: BenchmarkRun['status']) => ['completed', 'partial', 'failed', 'cancelled'].includes(status);
const metric = (value: number | null, suffix = '') => value === null ? missing : `${Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3)}${suffix}`;
const money = (value: number | null) => value === null ? missing : `$${value.toFixed(4)}`;
const statusText: Record<BenchmarkRun['status'], string> = { queued: 'Queued', running: 'Running', completed: 'Completed', partial: 'Partial', failed: 'Failed', cancelled: 'Cancelled' };

export default function BenchmarkDashboard({ initialRunId = null, onOpenComparisonRun = () => {}, onOpenProviderSettings }: { initialRunId?: string | null; onOpenComparisonRun?: (runId: string) => void; onOpenProviderSettings?: () => void } = {}) {
  const [datasets, setDatasets] = useState<BenchmarkDataset[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [runsCursor, setRunsCursor] = useState<string | null>(null);
  const [casesCursor, setCasesCursor] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState('');
  const [baselineModel, setBaselineModel] = useState('');
  const [candidateModel, setCandidateModel] = useState('eco-auto');
  const [maxCases, setMaxCases] = useState(20);
  const [maxCasesInput, setMaxCasesInput] = useState('20');
  const [run, setRun] = useState<BenchmarkRun | null>(null);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loadingCases, setLoadingCases] = useState(false);
  const [showStopActiveAction, setShowStopActiveAction] = useState(false);
  const [stoppingRun, setStoppingRun] = useState(false);
  const lock = useRef(false);
  const openedInitialRun = useRef<string | null>(null);
  const selectedDataset = datasets.find((item) => item.dataset_id === datasetId);

  useEffect(() => {
    let active = true;
    Promise.all([benchmarkApi.listDatasets(), benchmarkApi.listRuns()]).then(([data, history]) => {
      if (!active) return;
      setDatasets(data.datasets); setRuns(history.items); setRunsCursor(history.next_cursor);
      const initialDataset = data.datasets.find((item) => item.dataset_id === 'starter-v2') ?? data.datasets[0];
      setDatasetId(initialDataset?.dataset_id ?? '');
      setBaselineModel(initialDataset?.supported_models[1] ?? initialDataset?.supported_models[0] ?? '');
      const initialMax = Math.min(initialDataset?.max_cases_per_run ?? 20, initialDataset?.case_count ?? 1);
      setMaxCases(initialMax);
      setMaxCasesInput(String(initialMax));
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load benchmark data.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!run || done(run.status)) return;
    let active = true;
    let timer = 0;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const snapshot = await benchmarkApi.getRun(run.run_id, controller.signal);
        if (!active) return;
        setRun(snapshot); setRuns((items) => items.map((item) => item.run_id === snapshot.run_id ? snapshot : item));
        if (!done(snapshot.status)) timer = window.setTimeout(poll, 2000);
      } catch (reason) {
        if (!active) return;
        setPollError(reason instanceof Error ? reason.message : 'Could not refresh benchmark progress.');
      }
    };
    timer = window.setTimeout(poll, 1500);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [run?.run_id, run?.status]);

  useEffect(() => {
    if (!run || !done(run.status)) return;
    const controller = new AbortController();
    setLoadingCases(true);
    benchmarkApi.getCases(run.run_id, 50, undefined, controller.signal)
      .then((response) => { setCases(response.items); setCasesCursor(response.next_cursor); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load individual case results.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCases(false); });
    return () => controller.abort();
  }, [run?.run_id, run?.status]);

  const updateBenchmarkUrl = (runId: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('run');
    if (runId) url.searchParams.set('benchmark', runId); else url.searchParams.delete('benchmark');
    window.history.replaceState({}, '', url);
  };

  const openRun = async (runId: string, showNotice = false) => {
    setError(null); setPollError(null); setPendingRunId(null); setCases([]); setCasesCursor(null);
    try {
      const snapshot = await benchmarkApi.getRun(runId);
      setRun(snapshot);
      updateBenchmarkUrl(runId);
      if (showNotice) setNotice('Opened the active benchmark identified by the backend.');
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open this benchmark run.'); }
  };

  useEffect(() => {
    if (!initialRunId || loading || openedInitialRun.current === initialRunId) return;
    openedInitialRun.current = initialRunId;
    void openRun(initialRunId, true);
  }, [initialRunId, loading]);

  const retryProgress = async () => {
    const runId = pendingRunId ?? run?.run_id;
    if (!runId) return;
    setPollError(null); setError(null);
    try {
      const snapshot = await benchmarkApi.getRun(runId);
      setPendingRunId(null); setRun(snapshot);
      setRuns((items) => [snapshot, ...items.filter((item) => item.run_id !== snapshot.run_id)]);
    } catch (reason) { setPollError(reason instanceof Error ? reason.message : 'Could not refresh benchmark progress.'); }
  };

  const loadMoreRuns = async () => {
    if (!runsCursor) return;
    try { const page = await benchmarkApi.listRuns(20, runsCursor); setRuns((items) => [...items, ...page.items]); setRunsCursor(page.next_cursor); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load more benchmark history.'); }
  };

  const loadMoreCases = async () => {
    if (!run || !casesCursor) return;
    try { const page = await benchmarkApi.getCases(run.run_id, 50, casesCursor); setCases((items) => [...items, ...page.items]); setCasesCursor(page.next_cursor); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load more case results.'); }
  };

  const exportAnalysis = async () => {
    if (!run) return;
    try {
      const analysis = await benchmarkApi.exportRun(run.run_id);
      const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      link.download = `ecoagent-benchmark-${run.run_id}-${analysis.data_completeness}.json`;
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setNotice(`Exported ${analysis.data_completeness} analysis JSON with authored cases, expected checks, outputs, measurements, and pricing assumptions.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not export benchmark analysis JSON.'); }
  };

  const start = async () => {
    if (lock.current || !selectedDataset || !baselineModel) return;
    lock.current = true; setSubmitting(true); setError(null); setShowStopActiveAction(false); setPollError(null); setCases([]); setCasesCursor(null);
    const config: StartBenchmarkRequest = {
      dataset_id: selectedDataset.dataset_id,
      baseline: { model_id: baselineModel, optimization_enabled: false },
      candidate: { model_id: candidateModel, optimization_enabled: candidateModel === 'eco-auto' },
      max_cases: maxCases,
    };
    try {
      const created = await benchmarkApi.startRun(config);
      setPendingRunId(created.run_id);
      const initial = await benchmarkApi.getRun(created.run_id);
      setPendingRunId(null); setRun(initial); setRuns((items) => [initial, ...items.filter((item) => item.run_id !== initial.run_id)]);
      updateBenchmarkUrl(initial.run_id);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const activeId = reason.details?.active_run_id;
        const activeKind = reason.details?.active_run_kind;
        if (typeof activeId === 'string' && activeKind === 'benchmark') await openRun(activeId, true);
        else if (typeof activeId === 'string' && activeKind === 'comparison') onOpenComparisonRun(activeId);
        else {
          try {
            const active = await api.activeRun();
            if (active?.kind === 'benchmark') await openRun(active.id, true);
            else if (active?.kind === 'comparison') onOpenComparisonRun(active.id);
            else if (active?.kind === 'agent') setError('A Workspace Agent run is active. Open that page to review or stop it.');
            else setError('The backend reports no active run now. Refresh the page and try again; no request was resubmitted.');
          } catch {
            setError(`${reason.message} The active run could not be looked up. You can ask the backend to stop its current run, then retry.`);
            setShowStopActiveAction(true);
          }
        }
      } else if (reason instanceof ApiError && reason.status === 422 && typeof reason.details?.max_cases_per_run === 'number') {
        const allowed = Math.max(0, Math.trunc(reason.details.max_cases_per_run));
        setMaxCases(allowed); setMaxCasesInput(String(Math.max(1, allowed)));
        setError(allowed === 0
          ? 'The selected models do not fit the remaining request and spending budgets. Choose a lower-cost model or wait for the daily budget to reset.'
          : `The selected models and current server budgets allow at most ${allowed} cases. Your selection was updated; review it and submit again.`);
      } else setError(reason instanceof Error ? reason.message : 'Could not start the benchmark.');
    }
    finally { lock.current = false; setSubmitting(false); }
  };

  const stopActiveRun = async (expectedId?: string) => {
    setStoppingRun(true);
    try {
      const active = expectedId ? await api.activeRun() : null;
      if (expectedId && !active) { setShowStopActiveAction(false); setError('There is no active run to stop. Refresh the page and try again.'); return; }
      if (expectedId && active?.id !== expectedId) { setError('The active run changed. Refresh before stopping it.'); return; }
      const stopped = await api.stopActiveRun(expectedId);
      setShowStopActiveAction(false);
      if (stopped.kind === 'benchmark') await openRun(stopped.id, true);
      else if (stopped.kind === 'comparison') onOpenComparisonRun(stopped.id);
      else setError('The Workspace Agent run was stopped. Open its page to review the run log.');
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 404
        ? 'The backend is running an older version without Stop active run. Stop it with Ctrl+C in its terminal, then restart the backend from the current project folder.'
        : reason instanceof Error ? reason.message : 'Could not stop the active run.');
    }
    finally { setStoppingRun(false); }
  };

  const costBase = run?.baseline_metrics?.total_cost_usd ?? null;
  const costCandidate = run?.candidate_metrics?.total_cost_usd ?? null;
  const costSavedPct = costBase !== null && costBase > 0 && costCandidate !== null ? ((costBase - costCandidate) / costBase) * 100 : null;
  const numberOfCases = Math.min(selectedDataset?.case_count ?? 1, selectedDataset?.max_cases_per_run ?? 1, Math.max(1, maxCases));

  return <section className="benchmark-page" aria-labelledby="benchmark-title">
    {benchmarkApi.isMock && <div className="benchmark-mock" role="status">SIMULATED BENCHMARK FIXTURES · NO INFERENCE REQUESTS</div>}
    <div className="benchmark-intro"><div><span className="section-kicker">BENCHMARK LAB</span><h1 id="benchmark-title">Compare model configurations</h1><p>Submit workloads to the EcoAgent backend and review its evaluation results. Provider credentials remain on the backend; hosted providers and configured local Ollama models use the same benchmark controls.</p></div><span className={`provenance-pill ${run?.measurement_source ?? (benchmarkApi.isMock ? 'simulated' : 'pending')}`}><span />{run?.measurement_source.toUpperCase() ?? (benchmarkApi.isMock ? 'SIMULATED FIXTURES' : 'SOURCE PENDING')}</span></div>

    {error && <div className="error-box compact" role="alert"><span>{error}</span>{showStopActiveAction && <button className="agent-stop-button" type="button" disabled={stoppingRun || benchmarkApi.isMock} onClick={() => void stopActiveRun()}>{stoppingRun ? 'Stopping…' : 'Stop active run'}</button>}{onOpenProviderSettings && /API key is missing|provider credentials|inference is not configured/i.test(error) && <button className="inline-settings-link" type="button" onClick={onOpenProviderSettings}>Provider setup</button>}{pendingRunId && <button className="text-button" onClick={() => void retryProgress()}>Check submitted run</button>}</div>}
    {notice && <div className="notice-strip" role="status">{notice}</div>}
    {pollError && <div className="error-box compact" role="alert"><span>{pollError}</span><button className="text-button" onClick={() => void retryProgress()}>Retry progress</button></div>}
    {loading ? <div className="loading-row" role="status">Loading benchmark datasets…</div> : datasets.length === 0 ? <div className="empty-state"><p>NO DATASETS AVAILABLE</p><span>The benchmark API returned no datasets.</span></div> : <>
      <section className="benchmark-config panel" aria-labelledby="benchmark-config-title"><div className="panel-heading"><div><div className="section-kicker">01 / CONFIGURE</div><h2 id="benchmark-config-title">Benchmark workload</h2></div><span className="policy-chip">{selectedDataset?.case_count ?? 0} cases · up to {selectedDataset?.max_cases_per_run ?? 0} per run</span></div>
        <div className="benchmark-fields">
          <label>Dataset<select value={datasetId} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => { setDatasetId(event.target.value); const next = datasets.find((item) => item.dataset_id === event.target.value); const nextMax = Math.min(next?.max_cases_per_run ?? 1, next?.case_count ?? 1); setMaxCases(nextMax); setMaxCasesInput(String(nextMax)); }}>
            {datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.name} · v{dataset.version}</option>)}
          </select><small>{selectedDataset?.description}</small></label>
          <label>Baseline model<select value={baselineModel} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => setBaselineModel(event.target.value)}>{selectedDataset?.supported_models.map((model) => <option key={model} value={model}>{model}{selectedDataset.preview_models?.includes(model) ? ' · preview' : ''}</option>)}</select><small>Optimization disabled. Preview model access may depend on your provider account.</small></label>
          <label>Candidate<select value={candidateModel} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => setCandidateModel(event.target.value)}><option value="eco-auto">EcoAgent AI auto-route</option>{selectedDataset?.supported_models.map((model) => <option key={model} value={model}>{model}{selectedDataset.preview_models?.includes(model) ? ' · preview' : ''}</option>)}</select><small>{candidateModel === 'eco-auto' ? 'Live uses a bounded AI routing call before the selected task model; simulated runs use a labeled route fixture.' : 'Optimization disabled'}</small></label>
          <label>Maximum cases<input type="number" min="1" max={Math.min(selectedDataset?.case_count ?? 1, selectedDataset?.max_cases_per_run ?? 1)} step="1" value={maxCasesInput} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => {
            const raw = event.target.value;
            setMaxCasesInput(raw);
            if (raw !== '') {
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) setMaxCases(Math.min(selectedDataset?.case_count ?? 1, selectedDataset?.max_cases_per_run ?? 1, Math.max(1, Math.trunc(parsed))));
            }
          }} onBlur={() => {
            const parsed = Number(maxCasesInput);
            const normalized = Math.min(selectedDataset?.case_count ?? 1, selectedDataset?.max_cases_per_run ?? 1, Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : 1));
            setMaxCases(normalized); setMaxCasesInput(String(normalized));
          }} /><small>{numberOfCases} case requests for each configuration</small></label>
        </div>
        <div className="benchmark-actions"><span>Results depend on the same dataset and evaluation criteria for both configurations.</span><button className="compare-button" type="button" onClick={() => void start()} disabled={loading || submitting || !!pendingRunId || !baselineModel || (!!run && !done(run.status))}>{submitting ? 'Starting…' : 'Run benchmark'}</button></div>
      </section>

      {run && <section className="benchmark-results"><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Benchmark status: {statusText[run.status]}, {run.progress.completed} of {run.progress.total} cases completed.</p><div className="benchmark-run-heading"><div><span className="section-kicker">02 / RUN {run.run_id}</span><h2>{statusText[run.status]}</h2></div><div className="run-badges"><span className={`provenance-pill ${run.measurement_source}`}><span />{run.measurement_source.toUpperCase()}</span><span className={`status-badge ${run.status}`}>{statusText[run.status]}</span>{!done(run.status) && !benchmarkApi.isMock && <button className="agent-stop-button" type="button" disabled={stoppingRun} onClick={() => void stopActiveRun(run.run_id)}>{stoppingRun ? 'Stopping…' : 'Stop run'}</button>}{done(run.status) && <button className="secondary-button export-button" type="button" disabled={benchmarkApi.isMock} onClick={() => void exportAnalysis()}>{benchmarkApi.isMock ? 'Export requires backend' : 'Download analysis JSON'}</button>}</div></div>
        <div className="benchmark-progress panel"><div><strong>{run.progress.completed}</strong> of {run.progress.total} cases completed</div><div className="progress-track" role="progressbar" aria-label="Benchmark progress" aria-valuemin={0} aria-valuemax={run.progress.total} aria-valuenow={run.progress.completed}><div className={`progress-fill ${run.status}`} style={{ width: `${run.progress.total ? Math.min(100, run.progress.completed / run.progress.total * 100) : 0}%` }} /></div>{run.error && <p role="alert">{run.error.code}: {run.error.message}</p>}</div>
        {run.baseline_metrics && run.candidate_metrics && <>
          <div className="benchmark-provenance">{run.measurement_source === 'simulated' ? 'Simulated fixture results; not measured model performance.' : 'Backend reported observed provider usage and timing. Cost is an estimate unless confirmed by provider billing.'} Evaluation: deterministic authored checks, not semantic answer-quality evaluation. This run covers {run.max_cases} cases; use Download analysis JSON for the exact definitions and pass/fail rules.</div>
          <div className="benchmark-metrics">
            <BenchmarkMetric title="Cases passed" baseline={metric(run.baseline_metrics.passed_cases)} candidate={metric(run.candidate_metrics.passed_cases)} baselineValue={run.baseline_metrics.passed_cases} candidateValue={run.candidate_metrics.passed_cases} />
            <BenchmarkMetric title="Cases failed" baseline={metric(run.baseline_metrics.failed_cases)} candidate={metric(run.candidate_metrics.failed_cases)} baselineValue={run.baseline_metrics.failed_cases} candidateValue={run.candidate_metrics.failed_cases} />
            <BenchmarkMetric title="Pass rate of evaluated cases" baseline={metric(run.baseline_metrics.pass_rate === null ? null : run.baseline_metrics.pass_rate * 100, '%')} candidate={metric(run.candidate_metrics.pass_rate === null ? null : run.candidate_metrics.pass_rate * 100, '%')} baselineValue={run.baseline_metrics.pass_rate === null ? null : run.baseline_metrics.pass_rate * 100} candidateValue={run.candidate_metrics.pass_rate === null ? null : run.candidate_metrics.pass_rate * 100} />
            <BenchmarkMetric title="Incomplete / truncated" baseline={`${metric(run.baseline_metrics.incomplete_cases ?? null)} / ${metric(run.baseline_metrics.total_cases)}`} candidate={`${metric(run.candidate_metrics.incomplete_cases ?? null)} / ${metric(run.candidate_metrics.total_cases)}`} />
            <BenchmarkMetric title="Mean latency" baseline={metric(run.baseline_metrics.mean_latency_ms, ' ms')} candidate={metric(run.candidate_metrics.mean_latency_ms, ' ms')} baselineValue={run.baseline_metrics.mean_latency_ms} candidateValue={run.candidate_metrics.mean_latency_ms} />
            <BenchmarkMetric title="Estimated total cost" baseline={money(run.baseline_metrics.total_cost_usd)} candidate={money(run.candidate_metrics.total_cost_usd)} baselineValue={run.baseline_metrics.total_cost_usd} candidateValue={run.candidate_metrics.total_cost_usd} />
            <BenchmarkMetric title="Input / output tokens" baseline={`${metric(run.baseline_metrics.input_tokens)} / ${metric(run.baseline_metrics.output_tokens)}`} candidate={`${metric(run.candidate_metrics.input_tokens)} / ${metric(run.candidate_metrics.output_tokens)}`} />
            <BenchmarkMetric title="Requests / errors" baseline={`${metric(run.baseline_metrics.total_requests)} / ${metric(run.baseline_metrics.error_count)}`} candidate={`${metric(run.candidate_metrics.total_requests)} / ${metric(run.candidate_metrics.error_count)}`} />
          </div>
          <p className="benchmark-cost-delta">Cost change: {costSavedPct === null ? missing : `${Math.abs(costSavedPct).toFixed(1)}% ${costSavedPct >= 0 ? 'lower' : 'higher'} for candidate`} · returned configuration metrics remain authoritative.</p>
          <section className="benchmark-cases panel"><div className="table-heading"><div><span className="section-kicker">03 / CASES</span><h3 id="benchmark-cases-title">Individual test results</h3></div><span className="table-side-note">{loadingCases ? 'Loading…' : `${cases.length} shown`}</span></div><div className="table-scroll" role="region" aria-labelledby="benchmark-cases-title" tabIndex={0}><table><thead><tr><th>Case</th><th>Category</th><th>Evaluation</th><th>Expected</th><th>Baseline route / output</th><th>Candidate route / output</th><th>Status</th></tr></thead><tbody>{cases.map((item) => <tr key={item.case_id}><td>{item.case_id}</td><td>{item.category}</td><td>{item.evaluation_method}</td><td>{item.expected ?? missing}</td><td>{item.baseline ? <><strong>{item.baseline.provider_id} · {item.baseline.model_id}</strong><br /><small>{item.baseline.routing_reason ?? missing}</small><br />{item.baseline.output ?? missing}{item.baseline.output_truncated && <small className="source-warning"> Truncated ({item.baseline.finish_reason ?? 'length'}); excluded from pass rate.</small>}</> : missing}</td><td>{item.candidate ? <><strong>{item.candidate.provider_id} · {item.candidate.model_id}</strong><br /><small>{item.candidate.routing_reason ?? missing}</small>{item.candidate.router_model_id && <><br /><small>AI router: {item.candidate.router_model_id} · {metric(item.candidate.router_latency_ms, ' ms')} · {item.candidate.request_count} requests including routing</small></>}<br />{item.candidate.output ?? missing}{item.candidate.output_truncated && <small className="source-warning"> Truncated ({item.candidate.finish_reason ?? 'length'}); excluded from pass rate.</small>}</> : missing}</td><td>{item.status}</td></tr>)}</tbody></table></div>{!loadingCases && cases.length === 0 && <p className="benchmark-empty-cases">No individual cases returned for this run.</p>}{casesCursor && <button type="button" className="load-more" onClick={() => void loadMoreCases()}>Load more cases</button>}</section>
        </>}
      </section>}
      <section className="benchmark-history panel"><div className="table-heading"><div><span className="section-kicker">HISTORY</span><h3>Previous benchmark runs</h3></div><span className="table-side-note">{runs.length} shown</span></div>{runs.length ? <ul>{runs.map((item) => <li key={item.run_id}><button type="button" onClick={() => void openRun(item.run_id)}><span>{item.run_id}</span><span>{item.dataset_id} · {statusText[item.status]}</span><span className={`provenance-pill ${item.measurement_source}`}><span />{item.measurement_source}</span></button></li>)}</ul> : <p className="benchmark-empty-cases">No previous runs returned by the backend.</p>}{runsCursor && <button type="button" className="load-more" onClick={() => void loadMoreRuns()}>Load more runs</button>}</section>
    </>}
  </section>;
}

function BenchmarkMetric({ title, baseline, candidate, baselineValue, candidateValue }: { title: string; baseline: string; candidate: string; baselineValue?: number | null; candidateValue?: number | null }) {
  const max = Math.max(baselineValue ?? 0, candidateValue ?? 0);
  const width = (value: number | null | undefined) => value === null || value === undefined || max === 0 ? '0%' : `${Math.max(4, value / max * 100)}%`;
  const showBars = baselineValue !== undefined && candidateValue !== undefined;
  return <article className="benchmark-metric panel"><span>{title}</span><div><small>Baseline</small><strong>{baseline}</strong></div><div><small>Candidate</small><strong>{candidate}</strong></div>{showBars && <div className="benchmark-bar-pair" aria-hidden="true"><i className="baseline-bar" style={{ width: width(baselineValue) }} /><i className="candidate-bar" style={{ width: width(candidateValue) }} /></div>}</article>;
}
