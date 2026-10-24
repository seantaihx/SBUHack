import { useEffect, useRef, useState } from 'react';
import { ApiError, benchmarkApi } from './api/client';
import type { BenchmarkCase, BenchmarkDataset, BenchmarkRun, StartBenchmarkRequest } from './api/types';

const missing = 'Unavailable';
const done = (status: BenchmarkRun['status']) => ['completed', 'partial', 'failed', 'cancelled'].includes(status);
const metric = (value: number | null, suffix = '') => value === null ? missing : `${Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3)}${suffix}`;
const money = (value: number | null) => value === null ? missing : `$${value.toFixed(4)}`;
const statusText: Record<BenchmarkRun['status'], string> = { queued: 'Queued', running: 'Running', completed: 'Completed', partial: 'Partial', failed: 'Failed', cancelled: 'Cancelled' };

export default function BenchmarkDashboard({ initialRunId = null, onOpenComparisonRun = () => {} }: { initialRunId?: string | null; onOpenComparisonRun?: (runId: string) => void } = {}) {
  const [datasets, setDatasets] = useState<BenchmarkDataset[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [runsCursor, setRunsCursor] = useState<string | null>(null);
  const [casesCursor, setCasesCursor] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState('');
  const [baselineModel, setBaselineModel] = useState('');
  const [candidateModel, setCandidateModel] = useState('eco-auto');
  const [maxCases, setMaxCases] = useState(5);
  const [run, setRun] = useState<BenchmarkRun | null>(null);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loadingCases, setLoadingCases] = useState(false);
  const lock = useRef(false);
  const openedInitialRun = useRef<string | null>(null);
  const selectedDataset = datasets.find((item) => item.dataset_id === datasetId);

  useEffect(() => {
    let active = true;
    Promise.all([benchmarkApi.listDatasets(), benchmarkApi.listRuns()]).then(([data, history]) => {
      if (!active) return;
      setDatasets(data.datasets); setRuns(history.items); setRunsCursor(history.next_cursor);
      setDatasetId(data.datasets[0]?.dataset_id ?? '');
      setBaselineModel(data.datasets[0]?.supported_models[1] ?? data.datasets[0]?.supported_models[0] ?? '');
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

  const start = async () => {
    if (lock.current || !selectedDataset || !baselineModel) return;
    lock.current = true; setSubmitting(true); setError(null); setPollError(null); setCases([]); setCasesCursor(null);
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
        else setError(`${reason.message} The backend did not identify the active run type, so it cannot be opened safely. No request was resubmitted. This contract gap is documented for Sean.`);
      } else setError(reason instanceof Error ? reason.message : 'Could not start the benchmark.');
    }
    finally { lock.current = false; setSubmitting(false); }
  };

  const costBase = run?.baseline_metrics?.total_cost_usd ?? null;
  const costCandidate = run?.candidate_metrics?.total_cost_usd ?? null;
  const costSavedPct = costBase !== null && costBase > 0 && costCandidate !== null ? ((costBase - costCandidate) / costBase) * 100 : null;
  const numberOfCases = Math.min(selectedDataset?.case_count ?? 1, Math.max(1, maxCases));

  return <section className="benchmark-page" aria-labelledby="benchmark-title">
    {benchmarkApi.isMock && <div className="benchmark-mock" role="status">SIMULATED BENCHMARK FIXTURES · NO INFERENCE REQUESTS</div>}
    <div className="benchmark-intro"><div><span className="section-kicker">BENCHMARK LAB</span><h1 id="benchmark-title">Compare model configurations</h1><p>Submit workloads to the EcoAgent backend and review its evaluation results. The browser never calls Groq directly.</p></div><span className={`provenance-pill ${run?.measurement_source ?? (benchmarkApi.isMock ? 'simulated' : 'pending')}`}><span />{run?.measurement_source.toUpperCase() ?? (benchmarkApi.isMock ? 'SIMULATED FIXTURES' : 'SOURCE PENDING')}</span></div>

    {error && <div className="error-box compact" role="alert"><span>{error}</span>{pendingRunId && <button className="text-button" onClick={() => void retryProgress()}>Check submitted run</button>}</div>}
    {notice && <div className="notice-strip" role="status">{notice}</div>}
    {pollError && <div className="error-box compact" role="alert"><span>{pollError}</span><button className="text-button" onClick={() => void retryProgress()}>Retry progress</button></div>}
    {loading ? <div className="loading-row" role="status">Loading benchmark datasets…</div> : datasets.length === 0 ? <div className="empty-state"><p>NO DATASETS AVAILABLE</p><span>The benchmark API returned no datasets.</span></div> : <>
      <section className="benchmark-config panel" aria-labelledby="benchmark-config-title"><div className="panel-heading"><div><div className="section-kicker">01 / CONFIGURE</div><h2 id="benchmark-config-title">Benchmark workload</h2></div><span className="policy-chip">{selectedDataset?.case_count ?? 0} cases available</span></div>
        <div className="benchmark-fields">
          <label>Dataset<select value={datasetId} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => { setDatasetId(event.target.value); const next = datasets.find((item) => item.dataset_id === event.target.value); setMaxCases(Math.min(maxCases, next?.case_count ?? 1)); }}>
            {datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.name} · v{dataset.version}</option>)}
          </select><small>{selectedDataset?.description}</small></label>
          <label>Baseline model<select value={baselineModel} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => setBaselineModel(event.target.value)}>{selectedDataset?.supported_models.map((model) => <option key={model} value={model}>{model}</option>)}</select><small>Optimization disabled</small></label>
          <label>Candidate<select value={candidateModel} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => setCandidateModel(event.target.value)}><option value="eco-auto">EcoAgent auto-routing</option>{selectedDataset?.supported_models.map((model) => <option key={model} value={model}>{model}</option>)}</select><small>{candidateModel === 'eco-auto' ? 'EcoAgent policy, not a provider model ID' : 'Optimization disabled'}</small></label>
          <label>Maximum cases<input type="number" min="1" max={selectedDataset?.case_count ?? 1} value={maxCases} disabled={!!pendingRunId || (!!run && !done(run.status))} onChange={(event) => setMaxCases(Math.min(selectedDataset?.case_count ?? 1, Math.max(1, Number(event.target.value) || 1)))} /><small>{numberOfCases} case requests for each configuration</small></label>
        </div>
        <div className="benchmark-actions"><span>Results depend on the same dataset and evaluation criteria for both configurations.</span><button className="compare-button" type="button" onClick={() => void start()} disabled={loading || submitting || !!pendingRunId || !baselineModel || (!!run && !done(run.status))}>{submitting ? 'Starting…' : 'Run benchmark'}</button></div>
      </section>

      {run && <section className="benchmark-results" aria-live="polite"><div className="benchmark-run-heading"><div><span className="section-kicker">02 / RUN {run.run_id}</span><h2>{statusText[run.status]}</h2></div><div className="run-badges"><span className={`provenance-pill ${run.measurement_source}`}><span />{run.measurement_source.toUpperCase()}</span><span className={`status-badge ${run.status}`}>{statusText[run.status]}</span></div></div>
        <div className="benchmark-progress panel"><div><strong>{run.progress.completed}</strong> of {run.progress.total} cases completed</div><div className="progress-track"><div className={`progress-fill ${run.status}`} style={{ width: `${run.progress.total ? Math.min(100, run.progress.completed / run.progress.total * 100) : 0}%` }} /></div>{run.error && <p role="alert">{run.error.code}: {run.error.message}</p>}</div>
        {run.baseline_metrics && run.candidate_metrics && <>
          <div className="benchmark-provenance">{run.measurement_source === 'simulated' ? 'Simulated fixture results; not measured model performance.' : 'Backend reported observed provider usage and timing. Cost is an estimate unless confirmed by provider billing.'} Evaluation: {run.evaluation_method}.</div>
          <div className="benchmark-metrics">
            <BenchmarkMetric title="Cases passed" baseline={metric(run.baseline_metrics.passed_cases)} candidate={metric(run.candidate_metrics.passed_cases)} baselineValue={run.baseline_metrics.passed_cases} candidateValue={run.candidate_metrics.passed_cases} />
            <BenchmarkMetric title="Cases failed" baseline={metric(run.baseline_metrics.failed_cases)} candidate={metric(run.candidate_metrics.failed_cases)} baselineValue={run.baseline_metrics.failed_cases} candidateValue={run.candidate_metrics.failed_cases} />
            <BenchmarkMetric title="Pass rate" baseline={metric(run.baseline_metrics.pass_rate === null ? null : run.baseline_metrics.pass_rate * 100, '%')} candidate={metric(run.candidate_metrics.pass_rate === null ? null : run.candidate_metrics.pass_rate * 100, '%')} baselineValue={run.baseline_metrics.pass_rate === null ? null : run.baseline_metrics.pass_rate * 100} candidateValue={run.candidate_metrics.pass_rate === null ? null : run.candidate_metrics.pass_rate * 100} />
            <BenchmarkMetric title="Mean latency" baseline={metric(run.baseline_metrics.mean_latency_ms, ' ms')} candidate={metric(run.candidate_metrics.mean_latency_ms, ' ms')} baselineValue={run.baseline_metrics.mean_latency_ms} candidateValue={run.candidate_metrics.mean_latency_ms} />
            <BenchmarkMetric title="Estimated total cost" baseline={money(run.baseline_metrics.total_cost_usd)} candidate={money(run.candidate_metrics.total_cost_usd)} baselineValue={run.baseline_metrics.total_cost_usd} candidateValue={run.candidate_metrics.total_cost_usd} />
            <BenchmarkMetric title="Input / output tokens" baseline={`${metric(run.baseline_metrics.input_tokens)} / ${metric(run.baseline_metrics.output_tokens)}`} candidate={`${metric(run.candidate_metrics.input_tokens)} / ${metric(run.candidate_metrics.output_tokens)}`} />
            <BenchmarkMetric title="Requests / errors" baseline={`${metric(run.baseline_metrics.total_requests)} / ${metric(run.baseline_metrics.error_count)}`} candidate={`${metric(run.candidate_metrics.total_requests)} / ${metric(run.candidate_metrics.error_count)}`} />
          </div>
          <p className="benchmark-cost-delta">Cost change: {costSavedPct === null ? missing : `${Math.abs(costSavedPct).toFixed(1)}% ${costSavedPct >= 0 ? 'lower' : 'higher'} for candidate`} · returned configuration metrics remain authoritative.</p>
          <section className="benchmark-cases panel"><div className="table-heading"><div><span className="section-kicker">03 / CASES</span><h3>Individual test results</h3></div><span className="table-side-note">{loadingCases ? 'Loading…' : `${cases.length} shown`}</span></div><div className="table-scroll"><table><thead><tr><th>Case</th><th>Category</th><th>Evaluation</th><th>Expected</th><th>Baseline route / output</th><th>Candidate route / output</th><th>Status</th></tr></thead><tbody>{cases.map((item) => <tr key={item.case_id}><td>{item.case_id}</td><td>{item.category}</td><td>{item.evaluation_method}</td><td>{item.expected ?? missing}</td><td>{item.baseline ? <><strong>{item.baseline.model_id}</strong><br /><small>{item.baseline.routing_reason ?? missing}</small><br />{item.baseline.output ?? missing}</> : missing}</td><td>{item.candidate ? <><strong>{item.candidate.model_id}</strong><br /><small>{item.candidate.routing_reason ?? missing}</small><br />{item.candidate.output ?? missing}</> : missing}</td><td>{item.status}</td></tr>)}</tbody></table></div>{!loadingCases && cases.length === 0 && <p className="benchmark-empty-cases">No individual cases returned for this run.</p>}{casesCursor && <button type="button" className="load-more" onClick={() => void loadMoreCases()}>Load more cases</button>}</section>
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
