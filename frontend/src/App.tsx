import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './api/client';
import type { Capabilities, CreateRun, Mode, Run, SampleTasks, Task, TaskType } from './api/types';

const terminal = (status: Run['status']) => ['completed', 'partial', 'failed'].includes(status);
const typeNames: Record<TaskType, string> = { classify: 'Classification', extract: 'Data extraction', summarize: 'Summarization' };
const missing = 'Unavailable';
const fixed = (value: number | null, digits: number) => value === null ? missing : value > 0 && value < 10 ** -digits ? `<${(10 ** -digits).toFixed(digits)}` : value.toFixed(digits);
const pct = (value: number | null) => value === null ? missing : `${Math.abs(value).toFixed(1)}% ${value < 0 ? 'increase' : 'saved'}`;
const integer = (value: number | null) => value === null ? missing : Math.round(value).toLocaleString();

function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [samples, setSamples] = useState<SampleTasks | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('demo');
  const [customTasks, setCustomTasks] = useState<Task[]>([{ id: 'live-1', type: 'classify', prompt: '' }]);
  const [carbon, setCarbon] = useState(400);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(0);
  const requestLock = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.capabilities(), api.sampleTasks()]).then(([caps, sample]) => {
      if (!alive) return;
      setCapabilities(caps); setSamples(sample); setSelected(sample.tasks.map((task) => task.id)); setCarbon(caps.energy_profile.default_carbon_intensity_g_per_kwh);
      const runId = new URLSearchParams(window.location.search).get('run');
      if (runId) void api.getRun(runId).then((snapshot) => { if (alive) { setRun(snapshot); setCarbon(snapshot.carbon_intensity_g_per_kwh); } }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not restore this run.'); });
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not connect to the EcoAgent API.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!run || terminal(run.status)) return;
    let cancelled = false;
    let timeout = 0;
    const controller = new AbortController(); abortRef.current = controller;
    const poll = async () => {
      try {
        if (api.isMock) { await new Promise((resolve) => window.setTimeout(resolve, 650)); if (cancelled) return; api.advanceMock(run.id); }
        const snapshot = await api.getRun(run.id, controller.signal);
        if (cancelled) return;
        setRun(snapshot); setNetworkError(null);
        if (!terminal(snapshot.status)) timeout = window.setTimeout(poll, 1000);
      } catch (e) {
        if (cancelled) return;
        setNetworkError(e instanceof Error ? e.message : 'Connection lost while checking progress.');
        timeout = window.setTimeout(poll, 2500);
      }
    };
    timeout = window.setTimeout(poll, 1000);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!run || terminal(run.status)) return;
    const timer = window.setInterval(() => setNow((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status]);

  const selectedTasks = useMemo(() => samples?.tasks.filter((task) => selected.includes(task.id)) ?? [], [samples, selected]);
  const updateUrl = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('run', id); else url.searchParams.delete('run');
    window.history.replaceState({}, '', url);
  }, []);

  const start = async () => {
    if (requestLock.current || !capabilities) return;
    if (mode === 'live' && !capabilities.live_enabled) { setError(capabilities.live_disabled_reason ?? 'Live inference is unavailable.'); return; }
    if (mode === 'demo' && selectedTasks.length === 0) { setError('Select at least one sample task to compare.'); return; }
    if (api.isMock && mode === 'demo' && selectedTasks.length !== (samples?.tasks.length ?? 0)) { setError('The frontend mock only contains the complete sample run. Select all sample tasks or turn off VITE_USE_FRONTEND_MOCK.'); return; }
    if (mode === 'live' && (customTasks.length === 0 || customTasks.some((task) => !task.prompt.trim()))) { setError('Add a prompt for every live task.'); return; }
    requestLock.current = true; setSubmitting(true); setError(null); setNetworkError(null); setNotice(null); setRun(null); updateUrl(null);
    const payload: CreateRun = { mode, tasks: mode === 'demo' ? selectedTasks : customTasks.map((task) => ({ ...task, prompt: task.prompt.trim() })), carbon_intensity_g_per_kwh: carbon };
    try {
      const created = await api.createRun(payload); setRun(created); updateUrl(created.id); setNow(0);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const activeId = e.details?.active_run_id;
        if (typeof activeId === 'string') {
          try { const active = await api.getRun(activeId); setRun(active); updateUrl(active.id); setNotice('An active comparison already exists. Reopened that run.'); }
          catch { setError(e.message); }
        } else setError(e.message);
      } else if (e instanceof ApiError && e.status === 503) setError(e.message);
      else setError(`${e instanceof Error ? e.message : 'The request failed.'} It may have started; check the active run before submitting again.`);
    } finally { requestLock.current = false; setSubmitting(false); }
  };

  const retry = async () => {
    if (!run) return;
    try { setNetworkError(null); setRun(await api.getRun(run.id)); }
    catch (e) { setNetworkError(e instanceof Error ? e.message : 'Could not reconnect to the run.'); }
  };

  const reset = () => { setRun(null); setError(null); setNetworkError(null); setNotice(null); updateUrl(null); };
  const updateTask = (index: number, change: Partial<Task>) => setCustomTasks((tasks) => tasks.map((task, i) => i === index ? { ...task, ...change } : task));
  const statusLabel = run ? ({ queued: 'Queued', running: 'In progress', completed: 'Completed', partial: 'Partial results', failed: 'Failed' } as const)[run.status] : '';

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="EcoAgent home"><span className="brand-mark"><LeafIcon /></span><span>ecoagent<span className="brand-period">.</span></span></a><div className="topbar-right"><span className="topbar-note"><span className="live-dot" /> SYSTEM ONLINE</span><span className="topbar-divider" /><span className="version">MVP&nbsp; / &nbsp;v1.0</span></div></header>
    {api.isMock && <div className="mock-banner" role="status"><span className="mock-banner-dot" /> FRONTEND MOCK ACTIVE <span>Static contract fixtures · no backend requests</span></div>}
    <div className="content" id="top">
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> INTELLIGENT ROUTING, MADE VISIBLE</div><h1>Better inference.<br /><span>Less overhead.</span></h1><p className="hero-description">Compare how a task-routing policy changes model choice, response, latency and illustrative energy estimates.</p></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="orbit-core"><LeafIcon /></div><div className="orbit-node node-one" /><div className="orbit-node node-two" /><span className="orbit-caption">ROUTE<br />WITH INTENT</span></div></section>

      <section className="control-panel panel" aria-labelledby="controls-title">
        <div className="panel-heading"><div><div className="section-kicker">01 / CONFIGURE</div><h2 id="controls-title">Set up a comparison</h2></div><span className="policy-chip"><span className="tiny-dot" /> task-routing-v1</span></div>
        {loading ? <div className="loading-row" role="status"><span className="spinner" />Connecting to API…</div> : error && !capabilities ? <div className="error-box" role="alert"><AlertIcon /> <span>{error}</span><button className="text-button" onClick={() => window.location.reload()}>Retry connection</button></div> : <>
          <div className="mode-row"><div className="mode-label"><span className="label-main">Execution mode</span><span className="label-sub">Choose how this comparison runs</span></div><div className="mode-switch" role="group" aria-label="Execution mode"><button className={mode === 'demo' ? 'mode-option selected' : 'mode-option'} onClick={() => { setMode('demo'); setError(null); }} aria-pressed={mode === 'demo'}><span className="mode-icon"><PlayIcon /></span>Demo <span className="mode-mini">OFFLINE</span></button><button className={mode === 'live' ? 'mode-option selected' : 'mode-option'} onClick={() => { setMode('live'); setError(null); }} aria-pressed={mode === 'live'}><span className="mode-icon"><BoltIcon /></span>Live {!capabilities?.live_enabled && <span className="mode-mini disabled-text">UNAVAILABLE</span>}</button></div></div>
          {mode === 'live' && !capabilities?.live_enabled && <div className="info-strip"><LockIcon /><span>{capabilities?.live_disabled_reason ?? 'Live inference is unavailable.'}</span></div>}
          <div className="workload-heading"><div><span className="label-main">{mode === 'demo' ? 'Sample workload' : 'Your workload'}</span><span className="label-sub">{mode === 'demo' ? 'Select the requests to include in this run.' : 'Prompts are sent to the configured inference service.'}</span></div><span className={`provenance-pill ${mode === 'demo' ? 'simulated' : 'observed'}`}><span />{mode === 'demo' ? 'SIMULATED' : 'OBSERVED'}</span></div>
          {mode === 'demo' ? <div className="task-list">{(samples?.tasks ?? []).map((task, index) => <label className={`task-option ${selected.includes(task.id) ? 'checked' : ''}`} key={task.id}><input type="checkbox" checked={selected.includes(task.id)} onChange={() => setSelected((ids) => ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id])} /><span className="custom-checkbox"><CheckIcon /></span><span className="task-number">0{index + 1}</span><span className="task-info"><span className="task-name">{typeNames[task.type]}</span><span className="task-prompt">{task.prompt}</span></span><span className="task-type">{task.type}</span></label>)}</div> : <div className="live-editor">{customTasks.map((task, index) => <div className="live-task" key={task.id}><label>Task {index + 1}<select value={task.type} disabled={!capabilities?.live_enabled} onChange={(e) => updateTask(index, { type: e.target.value as TaskType })}><option value="classify">Classify</option><option value="extract">Extract</option><option value="summarize">Summarize</option></select></label><label className="prompt-label">Prompt<textarea disabled={!capabilities?.live_enabled} maxLength={capabilities?.max_prompt_chars ?? 2000} value={task.prompt} onChange={(e) => updateTask(index, { prompt: e.target.value })} placeholder="Enter a synthetic sample prompt…" /></label>{customTasks.length > 1 && <button className="remove-task" type="button" disabled={!capabilities?.live_enabled} onClick={() => setCustomTasks((items) => items.filter((item) => item.id !== task.id))} aria-label={`Remove task ${index + 1}`}>×</button>}</div>)}<button className="add-task-button" type="button" disabled={!capabilities?.live_enabled || customTasks.length >= (capabilities?.max_tasks ?? 10)} onClick={() => setCustomTasks((items) => [...items, { id: `live-${Date.now()}`, type: 'classify', prompt: '' }])}>+ Add task <span>{customTasks.length}/{capabilities?.max_tasks ?? 10}</span></button><p className="privacy-note"><LockIcon /> Use synthetic samples. Do not submit sensitive prompts.</p></div>}
          <div className="carbon-control"><label htmlFor="carbon-intensity"><span className="label-main">Scenario carbon intensity</span><span className="label-sub">Illustrative input, not live grid data</span></label><div className="range-value"><input id="carbon-intensity" type="number" min="0" max="2000" step="25" value={carbon} onChange={(e) => setCarbon(Math.max(0, Math.min(2000, Number(e.target.value))))} disabled={!!run || submitting} /><span>gCO₂e / kWh</span></div></div>
          {error && <div className="error-box compact" role="alert"><AlertIcon />{error}</div>}
          <div className="panel-footer"><div className="selection-note"><span className="tiny-dot" />{mode === 'demo' ? `${selectedTasks.length} of ${samples?.tasks.length ?? 0} tasks selected` : `${customTasks.length} task${customTasks.length === 1 ? '' : 's'} ready`}</div><div className="actions">{run && <button className="secondary-button" onClick={reset}>New comparison</button>}<button className="compare-button" onClick={() => void start()} disabled={loading || submitting || !capabilities?.demo_enabled || (mode === 'live' && !capabilities.live_enabled) || !!run}><span>{submitting ? 'Starting…' : 'Compare policies'}</span>{submitting ? <span className="button-spinner" /> : <ArrowIcon />}</button></div></div>
        </>}
      </section>

      {notice && <div className="notice-strip" role="status"><CheckIcon />{notice}</div>}
      {run && <section className="results-section" aria-live="polite"><div className="results-heading"><div><div className="section-kicker">02 / RESULTS</div><h2>Your comparison</h2><p className="run-meta">Run <span>{run.id.slice(0, 8)}</span> · {run.tasks.length} tasks · {new Date(run.created_at).toLocaleString()}</p></div><div className="run-badges"><span className={`mode-badge ${run.mode}`}><span />{run.mode === 'demo' ? 'DEMO' : 'LIVE'}</span><span className={`provenance-pill ${run.measurement_source === 'simulated' ? 'simulated' : 'observed'}`}><span />{run.measurement_source === 'simulated' ? 'SIMULATED' : 'OBSERVED'}</span><span className={`status-badge ${run.status}`}><span className="status-dot" />{statusLabel}</span></div></div>
        {networkError && <div className="error-box compact" role="alert"><AlertIcon /><span>{networkError}</span><button className="text-button" onClick={() => void retry()}>Retry now</button></div>}
        {run.run_error && <div className="error-box compact" role="alert"><AlertIcon />{run.run_error.message} <span className="error-code">{run.run_error.code}</span></div>}
        <div className="progress-panel panel"><div className="progress-top"><div><span className="label-main">Run progress</span><span className="label-sub">{run.completed_attempts} of {run.total_attempts} attempts completed</span></div><span className="progress-time"><span className="clock-icon">◷</span> {terminal(run.status) ? 'Finished' : `Running ${Math.floor(now / 60).toString().padStart(2, '0')}:${(now % 60).toString().padStart(2, '0')}`}</span></div><div className="progress-track"><div className={`progress-fill ${run.status}`} style={{ width: `${run.total_attempts ? Math.min(100, run.completed_attempts / run.total_attempts * 100) : 0}%` }} /></div>{run.status === 'partial' && <p className="progress-caption">Some attempts failed. Metrics use only backend-defined matching cohorts.</p>}</div>
        <div className="metrics-heading"><div><h3>Impact overview</h3><span className="incomplete-note">{run.status === 'completed' ? 'Backend-provided comparison · answer quality not evaluated' : 'Incomplete comparison · values update as attempts finish'}</span></div><span className="metrics-count">{run.comparison.successful_pairs} matched pairs</span></div>
        <div className="metric-grid"><MetricCard title="Illustrative energy" unit="Wh" values={run.comparison.energy_wh} count={run.comparison.energy_pairs} cohort="complete usage pairs" format={(v) => fixed(v, 6)} icon={<EnergyIcon />} tint="sage" /><MetricCard title="Illustrative carbon" unit="gCO₂e" values={run.comparison.carbon_g} count={run.comparison.energy_pairs} cohort="complete usage pairs" format={(v) => fixed(v, 6)} icon={<LeafIcon />} tint="mint" /><MetricCard title={run.mode === 'demo' ? 'Simulated latency' : 'Observed latency'} unit="ms" values={run.comparison.latency_ms} count={run.comparison.latency_pairs} cohort="successful pairs" format={integer} icon={<ClockIcon />} tint="blue" /></div>
        <div className="metric-caveat"><InfoIcon /><span>{run.mode === 'demo' ? 'Demo latency, token usage and outputs are simulated fixtures. Energy and carbon figures are illustrative estimates; they are not provider telemetry or measured emissions.' : 'Latency is client timing and token counts are provider usage where available. Energy and carbon are illustrative estimates, not electrical telemetry or verified emissions.'}</span><span className="caveat-tag">ESTIMATE ONLY</span></div>
        <section className="comparison-panel panel"><div className="table-heading"><div><span className="section-kicker">03 / ATTEMPTS</span><h3>Routing breakdown</h3></div><span className="table-side-note">Policy decisions per task</span></div><div className="table-scroll"><table><thead><tr><th>Task</th><th>Policy</th><th>Model</th><th>Route reason</th><th>Latency</th><th>Tokens in / out</th><th>Energy · estimate</th><th>Carbon · estimate</th><th>Status</th></tr></thead><tbody>{run.tasks.flatMap((task) => (['baseline', 'optimized'] as const).map((policy) => {
          const result = run.results.find((item) => item.task_id === task.id && item.policy === policy);
          return <tr key={`${task.id}-${policy}`}><td><span className="table-task-id">{task.id}</span><span className="table-task-type">{task.type}</span></td><td><span className={`policy-label ${policy}`}>{policy}</span></td><td><span className={`model-label ${result?.model_role ?? ''}`}>{result ? result.model_role : missing}</span><span className="model-id">{result?.model_id ?? 'Pending'}</span></td><td className="route-reason">{result?.routing_reason ?? missing}</td><td>{result ? `${integer(result.latency_ms)} ms` : missing}</td><td>{result ? `${integer(result.input_tokens)} / ${integer(result.output_tokens)}` : missing}</td><td>{result ? fixed(result.estimated_energy_wh, 6) : missing}</td><td>{result ? fixed(result.estimated_carbon_g, 6) : missing}</td><td>{result ? <span className={`attempt-status ${result.status}`}>{result.status === 'succeeded' ? 'Succeeded' : 'Failed'}</span> : <span className="pending-status">Pending</span>}{result?.error && <span className="attempt-error">{result.error.code}: {result.error.message}</span>}</td></tr>;
        }))}</tbody></table></div></section>
        <section className="answer-section"><div className="answer-heading"><div><span className="section-kicker">04 / OUTPUTS</span><h3>Response comparison</h3></div><p>Plain text only · review outputs manually</p></div><div className="answer-grid">{run.tasks.map((task, i) => { const baseline = run.results.find((r) => r.task_id === task.id && r.policy === 'baseline'); const optimized = run.results.find((r) => r.task_id === task.id && r.policy === 'optimized'); return <article className="answer-card" key={task.id}><div className="answer-card-head"><span className="answer-index">0{i + 1}</span><div><strong>{typeNames[task.type]}</strong><span>{task.id}</span></div><span className="manual-review">MANUAL REVIEW</span></div><div className="answer-pair"><Answer policy="baseline" result={baseline} /><Answer policy="optimized" result={optimized} /></div><button className="disclosure-button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? 'Hide' : 'Show'} task prompt <ChevronIcon open={expanded} /></button>{expanded && <p className="prompt-disclosure">{task.prompt}</p>}</article>; })}</div></section>
        <details className="assumptions panel"><summary><span><span className="section-kicker">METHODOLOGY</span><strong>What these estimates mean</strong></span><ChevronIcon /></summary><div className="assumption-content"><p>The backend supplied all displayed aggregates. The <strong>illustrative-v1</strong> profile uses hypothetical coefficients and does not measure provider electricity use.</p><div className="coefficient-grid">{(['small', 'large'] as const).map((role) => <div key={role} className="coefficient-card"><span>{role} model</span><code>{capabilities?.energy_profile.models[role].input_wh_per_token ?? missing} Wh / input token</code><code>{capabilities?.energy_profile.models[role].output_wh_per_token ?? missing} Wh / output token</code></div>)}</div><p>Carbon intensity is the scenario value selected for this run: <strong>{run.carbon_intensity_g_per_kwh} gCO₂e/kWh</strong>. It is not live grid data. Coefficients omit hardware, utilization, cooling, networking, location and time variation. Successful HTTP responses do not establish equal answer quality. Negative savings mean an increase.</p></div></details>
      </section>}
      {!run && !loading && capabilities && <section className="empty-state"><div className="empty-icon"><LeafIcon /></div><p>SELECT A WORKLOAD TO BEGIN</p><span>Your comparison will appear here. Backend responses determine all routing, metrics and results.</span></section>}
      <footer className="footer"><span>ecoagent<span className="brand-period">.</span> <span className="footer-separator">/</span> Inference, considered.</span><span>ESTIMATES ARE ILLUSTRATIVE. RESULTS ARE NOT QUALITY EVALUATIONS.</span></footer>
    </div>
  </main>;
}

function MetricCard({ title, unit, values, count, cohort, format, icon, tint }: { title: string; unit: string; values: { baseline: number | null; optimized: number | null; saved: number | null; savings_pct: number | null }; count: number; cohort: string; format: (value: number | null) => string; icon: React.ReactNode; tint: string }) {
  return <article className={`metric-card panel ${tint}`}><div className="metric-card-top"><span>{title}</span><span className="metric-icon">{icon}</span></div><div className="metric-main"><strong>{format(values.saved)}</strong><span>{unit} {values.saved !== null && values.saved < 0 ? 'increase' : 'saved'}</span></div><div className="metric-comparison"><div><span>BASELINE</span><strong>{format(values.baseline)} <i>{unit}</i></strong></div><span className="metric-arrow">→</span><div><span>OPTIMIZED</span><strong>{format(values.optimized)} <i>{unit}</i></strong></div></div><div className="metric-foot"><span>{count} {cohort}</span><span className={values.saved !== null && values.saved < 0 ? 'increase-pct' : ''}>{pct(values.savings_pct)}</span></div></article>;
}

function Answer({ policy, result }: { policy: 'baseline' | 'optimized'; result: Run['results'][number] | undefined }) {
  return <div className={`answer-output ${policy}`}><div className="answer-output-label"><span className={`policy-dot ${policy}`} />{policy}<span className="answer-model">{result?.model_role ?? missing}</span></div><div className="answer-text">{!result ? <span className="muted">Waiting for backend output…</span> : result.status === 'failed' ? <span className="failed-answer"><AlertIcon /> {result.error?.message ?? 'Attempt failed.'}</span> : result.output_text === null ? missing : result.output_text}</div></div>;
}

function LeafIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.5 3.5C12 3.4 5.2 5 4.1 10.9c-.8 4.3 3 7.1 6.6 6.3 5.8-1.3 8.2-7.6 9.8-13.7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 21c2.8-6.1 7.2-9.2 12.7-11.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function PlayIcon() { return <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.7c0-.6.7-1 1.2-.7l6.1 4.3a.9.9 0 0 1 0 1.4l-6.1 4.3c-.5.4-1.2 0-1.2-.7V3.7Z"/></svg>; }
function BoltIcon() { return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m9.1 1.7-5 7h3.5l-.7 5.6 5-7H8.4l.7-5.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 9h10M9 4.5 13.5 9 9 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function CheckIcon() { return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8.5 3.1 3L13 4.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function AlertIcon() { return <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M9 5.2v4.1m0 2.8h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function LockIcon() { return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5.3 7V4.8a2.7 2.7 0 0 1 5.4 0V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>; }
function InfoIcon() { return <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/><path d="M9 8v4m0-6h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
function EnergyIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11.4 2.2 4.6 10h4.7l-.7 7.8 6.8-8h-4.7l.7-7.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ClockIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 5.8v4.5l3 1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronIcon({ open = false }: { open?: boolean }) { return <svg className={open ? 'chevron open' : 'chevron'} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

export default App;
