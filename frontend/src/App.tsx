import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './api/client';
import BenchmarkDashboard from './BenchmarkDashboard';
import AgentDashboard from './AgentDashboard';
import SourceInput from './SourceInput';
import ProviderKeySettings from './ProviderKeySettings';
import EcoImpactPanel from './EcoImpactPanel';
import type { Capabilities, ComparisonMetric, CreateRun, Mode, Run, SampleTasks, SourceSnapshot, Task, TaskConstraints, TaskType } from './api/types';
import { clearTaskReviews, createRunCsv, createRunExport, latencyChange, promptContainsUrl, readTaskReviews, reviewChoices, taskReview, writeTaskReviews, type ReviewChoice, type ReviewSide, type TaskReviews } from './comparisonUtils';

const terminal = (status: Run['status']) => ['completed', 'partial', 'failed', 'cancelled'].includes(status);
const typeNames: Record<TaskType, string> = { classify: 'Classification', extract: 'Data extraction', summarize: 'Summarization', write: 'Writing', code: 'Code generation' };
const missing = 'Unavailable';
const fixed = (value: number | null, digits: number) => value === null ? missing : value > 0 && value < 10 ** -digits ? `<${(10 ** -digits).toFixed(digits)}` : value.toFixed(digits);
const pct = (value: number | null) => value === null ? missing : `${Math.abs(value).toFixed(1)}% ${value < 0 ? 'increase' : 'saved'}`;
const integer = (value: number | null) => value === null ? missing : Math.round(value).toLocaleString();

function App() {
  const [page, setPage] = useState<'compare' | 'benchmarks' | 'agent'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('benchmark') ? 'benchmarks' : params.has('agent') ? 'agent' : 'compare';
  });
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [benchmarkRunToOpen, setBenchmarkRunToOpen] = useState<string | null>(() => new URLSearchParams(window.location.search).get('benchmark'));
  const [agentRunToOpen, setAgentRunToOpen] = useState<string | null>(() => new URLSearchParams(window.location.search).get('agent'));
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [smallModelId, setSmallModelId] = useState('');
  const [largeModelId, setLargeModelId] = useState('');
  const [samples, setSamples] = useState<SampleTasks | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('demo');
  const [qualityFallback, setQualityFallback] = useState(false);
  const [customTasks, setCustomTasks] = useState<Task[]>([{ id: 'live-1', type: 'classify', prompt: '' }]);
  const [carbon, setCarbon] = useState(400);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStopActiveAction, setShowStopActiveAction] = useState(false);
  const [stoppingRun, setStoppingRun] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualReviews, setManualReviews] = useState<TaskReviews>({});
  const [reviewStorageAvailable, setReviewStorageAvailable] = useState(true);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [sourceSelected, setSourceSelected] = useState(false);
  const [sourceSnapshot, setSourceSnapshot] = useState<SourceSnapshot | null>(null);
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [outputSearch, setOutputSearch] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const requestLock = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const onSourceChange = useCallback((snapshot: SourceSnapshot | null, selected: boolean, confirmed: boolean) => {
    setSourceSnapshot(snapshot); setSourceSelected(selected); setSourceConfirmed(confirmed);
  }, []);

  const refreshCapabilities = useCallback(async () => { setCapabilities(await api.capabilities()); }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([api.capabilities(), api.sampleTasks()]).then(([caps, sample]) => {
      if (!alive) return;
      setCapabilities(caps); setSmallModelId(caps.models.find((model) => model.role === 'small')?.live_model_id ?? ''); setLargeModelId(caps.models.find((model) => model.role === 'large')?.live_model_id ?? ''); setSamples(sample); setSelected(sample.tasks.map((task) => task.id)); setCarbon(caps.energy_profile.default_carbon_intensity_g_per_kwh);
      const query = new URLSearchParams(window.location.search);
      const benchmarkId = query.get('benchmark');
      if (benchmarkId) setPage('benchmarks');
      const agentId = query.get('agent');
      if (agentId) setPage('agent');
      const runId = benchmarkId ? null : query.get('run');
      if (runId) void api.getRun(runId).then((snapshot) => { if (alive) { setRun(snapshot); setCarbon(snapshot.carbon_intensity_g_per_kwh); } }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not restore this run.'); });
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not connect to the EcoAgent API.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!run) { setManualReviews({}); return; }
    const loaded = readTaskReviews(run.id);
    setManualReviews(loaded.reviews);
    setReviewStorageAvailable(loaded.storageAvailable);
  }, [run?.id]);

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
    url.searchParams.delete('benchmark');
    url.searchParams.delete('agent');
    if (id) url.searchParams.set('run', id); else url.searchParams.delete('run');
    window.history.replaceState({}, '', url);
  }, []);

  const navigateToBenchmark = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('run');
    url.searchParams.delete('agent');
    url.searchParams.set('benchmark', id);
    window.history.replaceState({}, '', url);
    setError(null);
    setPage('benchmarks');
    setBenchmarkRunToOpen(id);
  }, []);

  const navigateToAgent = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('run'); url.searchParams.delete('benchmark');
    url.searchParams.set('agent', id);
    window.history.replaceState({}, '', url);
    setError(null); setPage('agent'); setAgentRunToOpen(id);
  }, []);

  const openComparisonRun = useCallback(async (id: string, confirmation = 'Opened the active comparison.') => {
    setPage('compare');
    setBenchmarkRunToOpen(null);
    updateUrl(id);
    setError(null);
    setNotice(null);
    try {
      const active = await api.getRun(id);
      setRun(active);
      setCarbon(active.carbon_intensity_g_per_kwh);
      setNotice(confirmation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open the active comparison.');
    }
  }, [updateUrl]);

  const updateManualReview = (taskId: string, side: ReviewSide, choice: ReviewChoice) => {
    if (!run) return;
    const current = taskReview(manualReviews, taskId);
    const next = { ...manualReviews, [taskId]: { ...current, [side]: choice } };
    setManualReviews(next);
    setReviewStorageAvailable(writeTaskReviews(run.id, next));
  };

  const resetManualReviews = () => {
    if (!run) return;
    setManualReviews({});
    setReviewStorageAvailable(clearTaskReviews(run.id));
  };

  const copyOutput = async (taskId: string, policy: 'baseline' | 'optimized', output: string | null) => {
    if (output === null) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(output);
      setCopyFeedback(`Copied ${policy} output for ${taskId}.`);
    } catch {
      setCopyFeedback('Could not copy output. Select the response text and copy it manually.');
    }
  };

  const exportSnapshot = () => {
    if (!run) return;
    try {
      const contents = JSON.stringify(createRunExport(run, manualReviews), null, 2);
      downloadFile(contents, `ecoagent-run-${run.id}-${run.status}.json`, 'application/json;charset=utf-8');
      setExportNotice(`Exported the ${run.status} snapshot. Prompts and outputs may contain user-supplied data.`);
    } catch {
      setExportNotice('Could not create the JSON export in this browser.');
    }
  };

  const exportCsv = () => {
    if (!run) return;
    try {
      downloadFile(createRunCsv(run, manualReviews), `ecoagent-run-${run.id}-${run.status}.csv`, 'text/csv;charset=utf-8');
      setExportNotice(`Exported ${run.results.length} available attempt rows from the ${run.status} snapshot. Empty cells mean unavailable; prompts and outputs may contain user-supplied data.`);
    } catch {
      setExportNotice('Could not create the CSV export in this browser.');
    }
  };

  const printReport = () => {
    if (!run) return;
    try {
      setExportNotice('Print report opened. Choose “Save as PDF” in the browser print dialog. This is a print workflow, not a direct PDF download.');
      window.print();
    } catch {
      setExportNotice('Could not open the browser print dialog.');
    }
  };

  const start = async () => {
    if (requestLock.current || !capabilities) return;
    if (sourceSelected && !sourceSnapshot) { setError('Parse or fetch the selected source successfully before starting.'); return; }
    if (sourceSnapshot && mode !== 'live') { setError('Source-backed comparisons require Live mode.'); return; }
    if (sourceSnapshot && !sourceConfirmed) { setError('Confirm that the source may be sent to the configured inference provider.'); return; }
    if (mode === 'live' && !capabilities.live_enabled) { setError(capabilities.live_disabled_reason ?? 'Live inference is unavailable.'); return; }
    if (mode === 'demo' && selectedTasks.length === 0) { setError('Select at least one sample task to compare.'); return; }
    if (api.isMock && mode === 'demo' && selectedTasks.length !== (samples?.tasks.length ?? 0)) { setError('The frontend mock only contains the complete sample run. Select all sample tasks or turn off VITE_USE_FRONTEND_MOCK.'); return; }
    if (mode === 'live' && (customTasks.length === 0 || customTasks.some((task) => !task.prompt.trim()))) { setError('Add a prompt for every live task.'); return; }
    requestLock.current = true; setSubmitting(true); setError(null); setShowStopActiveAction(false); setNetworkError(null); setNotice(null); setRun(null); updateUrl(null);
    const payload: CreateRun = { mode, tasks: mode === 'demo' ? selectedTasks : customTasks.map((task) => ({ ...task, prompt: task.prompt.trim() })), carbon_intensity_g_per_kwh: carbon, quality_fallback: mode === 'live' && qualityFallback,
      ...(mode === 'live' ? { small_model_id: smallModelId, large_model_id: largeModelId } : {}),
      ...(sourceSnapshot ? { source_snapshot_id: sourceSnapshot.source_id, confirm_source_submission: true } : {}) };
    try {
      const created = await api.createRun(payload); setRun(created); updateUrl(created.id); setNow(0);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const activeId = e.details?.active_run_id;
        const activeKind = e.details?.active_run_kind;
        if (typeof activeId === 'string' && activeKind === 'comparison') {
          await openComparisonRun(activeId, 'An active comparison already exists. Reopened that run.');
        } else if (typeof activeId === 'string' && activeKind === 'benchmark') {
          navigateToBenchmark(activeId);
        } else if (typeof activeId === 'string' && activeKind === 'agent') {
          navigateToAgent(activeId);
        } else {
          try {
            const active = await api.activeRun();
            if (active?.kind === 'comparison') await openComparisonRun(active.id, 'Reopened the active comparison identified by the backend.');
            else if (active?.kind === 'benchmark') navigateToBenchmark(active.id);
            else if (active?.kind === 'agent') navigateToAgent(active.id);
            else setError('The backend reports no active run now. Refresh the page and try again; no request was resubmitted.');
          } catch {
            setError(`${e.message} The active run could not be looked up. You can ask the backend to stop its current run, then retry.`);
            setShowStopActiveAction(true);
          }
        }
      } else if (e instanceof ApiError && e.status === 503) setError(e.message);
      else setError(`${e instanceof Error ? e.message : 'The request failed.'} It may have started; check the active run before submitting again.`);
    } finally { requestLock.current = false; setSubmitting(false); }
  };

  const stopActiveRun = async (expectedId?: string) => {
    setStoppingRun(true);
    try {
      const active = expectedId ? await api.activeRun() : null;
      if (expectedId && !active) { setShowStopActiveAction(false); setError('There is no active run to stop. Refresh the page and try again.'); return; }
      if (expectedId && active?.id !== expectedId) { setError('The active run changed. Refresh before stopping it.'); return; }
      const stopped = await api.stopActiveRun(expectedId);
      setShowStopActiveAction(false);
      if (stopped.kind === 'comparison') await openComparisonRun(stopped.id, 'The active comparison was stopped.');
      else if (stopped.kind === 'benchmark') navigateToBenchmark(stopped.id);
      else navigateToAgent(stopped.id);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 404
        ? 'The backend is running an older version without Stop active run. Stop it with Ctrl+C in its terminal, then restart the backend from the current project folder.'
        : reason instanceof Error ? reason.message : 'Could not stop the active run.');
    } finally { setStoppingRun(false); }
  };

  const retry = async () => {
    if (!run) return;
    try { setNetworkError(null); setRun(await api.getRun(run.id)); }
    catch (e) { setNetworkError(e instanceof Error ? e.message : 'Could not reconnect to the run.'); }
  };

  const reset = () => { setRun(null); setError(null); setNetworkError(null); setNotice(null); setSourceSelected(false); setSourceSnapshot(null); setSourceConfirmed(false); updateUrl(null); };
  const updateTask = (index: number, change: Partial<Task>) => setCustomTasks((tasks) => tasks.map((task, i) => i === index ? { ...task, ...change } : task));
  const statusLabel = run ? ({ queued: 'Queued', running: 'In progress', completed: 'Completed', partial: 'Partial results', failed: 'Failed', cancelled: 'Stopped' } as const)[run.status] : '';

  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar"><a className="brand" href="#top" aria-label="EcoAgent home" onClick={() => setPage('compare')}><span className="brand-mark"><EcoAgentMark /></span><span>ecoagent<span className="brand-period">.</span></span></a><nav className="main-nav" aria-label="Main navigation"><button type="button" aria-current={page === 'compare' ? 'page' : undefined} onClick={() => setPage('compare')}>Compare</button><button type="button" aria-current={page === 'benchmarks' ? 'page' : undefined} onClick={() => setPage('benchmarks')}>Benchmarks</button><button type="button" aria-current={page === 'agent' ? 'page' : undefined} onClick={() => setPage('agent')}>Workspace agent</button></nav><div className="topbar-right"><span className="topbar-note"><span className={`live-dot ${!api.isMock && !capabilities ? 'offline-dot' : ''}`} />{api.isMock ? 'FIXTURE MOCK' : loading ? 'CONNECTING' : capabilities ? 'API READY' : 'API UNAVAILABLE'}</span><span className="topbar-divider" /><span className="version">API&nbsp; / &nbsp;{capabilities?.api_version ?? 'v1'}</span><button className="provider-settings-trigger" type="button" onClick={() => setProviderSettingsOpen(true)}>Provider settings</button></div></header>
    <ProviderKeySettings open={providerSettingsOpen} onClose={() => setProviderSettingsOpen(false)} onSaved={refreshCapabilities} />
    {api.isMock && <div className="mock-banner" role="status"><span className="mock-banner-dot" /> FRONTEND MOCK ACTIVE <span>Static contract fixtures · no backend requests</span></div>}
    <main id="main-content">
    <div className="content" id="top" hidden={page !== 'compare'}>
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> INTELLIGENT ROUTING, MADE VISIBLE</div><h1>Better inference.<br /><span>Less overhead.</span></h1><p className="hero-description">Compare how a task-routing policy changes model choice, response, latency and illustrative energy estimates.</p></div><RoutePolicyGraphic /></section>

      <section className="control-panel panel" aria-labelledby="controls-title">
        <div className="panel-heading"><div><div className="section-kicker">01 / CONFIGURE</div><h2 id="controls-title">Set up a comparison</h2></div><span className="policy-chip"><span className="tiny-dot" /> {capabilities?.policy_version ?? 'Policy unavailable'}</span></div>
        {loading ? <div className="loading-row" role="status"><span className="spinner" />Connecting to API…</div> : error && !capabilities ? <div className="error-box" role="alert"><AlertIcon /> <span>{error}</span><button className="text-button" onClick={() => window.location.reload()}>Retry connection</button></div> : <>
          <div className="mode-row"><div className="mode-label"><span className="label-main">Execution mode</span><span className="label-sub">Choose how this comparison runs</span></div><div className="mode-switch" role="group" aria-label="Execution mode"><button className={mode === 'demo' ? 'mode-option selected' : 'mode-option'} onClick={() => { setMode('demo'); setError(null); }} aria-pressed={mode === 'demo'}><span className="mode-icon"><PlayIcon /></span>Demo <span className="mode-mini">SIMULATED</span></button><button className={mode === 'live' ? 'mode-option selected' : 'mode-option'} onClick={() => { setMode('live'); setError(null); }} aria-pressed={mode === 'live'}><span className="mode-icon"><BoltIcon /></span>Live {!capabilities?.live_enabled && <span className="mode-mini disabled-text">UNAVAILABLE</span>}</button></div></div>
          <div className="mode-explanation"><p><strong>Frontend transport:</strong> {api.isMock ? 'Fixture mock is active: checked-in JSON is used without backend requests.' : 'The browser sends requests to the EcoAgent backend.'}</p><p><strong>Inference:</strong> Demo uses simulated backend answers and latency. Live sends prompt and any confirmed source text to the configured inference service and reports timing and usage when available. A successful response does not prove correctness.</p><p><strong>Routing:</strong> The backend selects the optimized model and returns its route reason; the frontend displays those results without choosing or predicting the destination. Baseline uses the large model. Coding and writing outputs are generated for review and are not executed here.</p><p><strong>Sources:</strong> Parsed source references describe locations in the input. The model does not return validated answer citations; verify claims against the preview.</p></div>
          {mode === 'live' && capabilities?.live_enabled && <label className="quality-fallback-setting"><input type="checkbox" checked={qualityFallback} onChange={(event) => setQualityFallback(event.target.checked)} /> Escalate optimized classify/extract to the large model if deterministic validation fails <span>May add one provider call per affected task. Truncated responses and provider errors are never retried.</span></label>}
          {mode === 'live' && capabilities?.live_enabled && <div className="model-selection-grid"><label htmlFor="small-route-model">Small-route model<select id="small-route-model" value={smallModelId} onChange={(event) => setSmallModelId(event.target.value)}>{(capabilities.supported_models ?? []).map((id) => <option key={id} value={id} disabled={id === largeModelId}>{id}</option>)}</select></label><label htmlFor="large-route-model">Large-route model<select id="large-route-model" value={largeModelId} onChange={(event) => setLargeModelId(event.target.value)}>{(capabilities.supported_models ?? []).map((id) => <option key={id} value={id} disabled={id === smallModelId}>{id}</option>)}</select></label><p>The backend still selects the route for each task. These choices set the provider model used for each backend-selected role.</p></div>}
          {mode === 'live' && !capabilities?.live_enabled && <div className="info-strip"><LockIcon /><span>{capabilities?.live_disabled_reason ?? 'Live inference is unavailable.'} {!api.isMock && <button className="inline-settings-link" type="button" onClick={() => setProviderSettingsOpen(true)}>Provider setup</button>}</span></div>}
          <SourceInput key={run?.id ?? 'new'} fixtureMode={api.isMock} onSourceChange={onSourceChange} initialSource={run?.source_snapshot ?? null} />
          <div className="workload-heading"><div><span className="label-main">{mode === 'demo' ? 'Sample workload' : 'Your workload'}</span><span className="label-sub">{mode === 'demo' ? 'Select the requests to include in this run.' : 'Prompts are sent to the configured inference service.'}</span></div><span className={`provenance-pill ${mode === 'demo' ? 'simulated' : 'observed'}`}><span />{mode === 'demo' ? 'SIMULATED' : 'OBSERVED'}</span></div>
          {mode === 'demo' ? <div className="task-list">{(samples?.tasks ?? []).map((task, index) => <label className={`task-option ${selected.includes(task.id) ? 'checked' : ''}`} key={task.id}><input type="checkbox" checked={selected.includes(task.id)} onChange={() => setSelected((ids) => ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id])} /><span className="custom-checkbox"><CheckIcon /></span><span className="task-number">0{index + 1}</span><span className="task-info"><span className="task-name">{typeNames[task.type]}</span><span className="task-prompt">{task.prompt}</span></span><span className="task-type">{task.type}</span></label>)}</div> : <div className="live-editor">{customTasks.map((task, index) => <div className="live-task" key={task.id}><label>Task {index + 1} type<select value={task.type} disabled={!capabilities?.live_enabled} onChange={(e) => updateTask(index, { type: e.target.value as TaskType, constraints: null })}><option value="classify">Classify</option><option value="extract">Extract</option><option value="summarize">Summarize</option><option value="write">Writing</option><option value="code">Code generation</option></select></label><label className="prompt-label">Prompt<textarea aria-describedby={`prompt-guidance${promptContainsUrl(task.prompt) ? ` prompt-url-${task.id}` : ''}`} disabled={!capabilities?.live_enabled} maxLength={capabilities?.max_prompt_chars ?? 2000} value={task.prompt} onChange={(e) => updateTask(index, { prompt: e.target.value })} placeholder="Enter a task or question about your source…" /></label><TaskConstraintFields task={task} disabled={!capabilities?.live_enabled} onChange={(constraints) => updateTask(index, { constraints })} />{customTasks.length > 1 && <button className="remove-task" type="button" disabled={!capabilities?.live_enabled} onClick={() => setCustomTasks((items) => items.filter((item) => item.id !== task.id))} aria-label={`Remove task ${index + 1}`}>×</button>}</div>)}<div className="task-text-guidance" id="prompt-guidance"><strong>Attach a source above, or include synthetic text in your prompt.</strong><span>Routing follows task type: classify/extract use small; summarize uses large. Attached source text is sent as untrusted context.</span></div>{customTasks.map((task) => promptContainsUrl(task.prompt) && <p className="url-reminder" id={`prompt-url-${task.id}`} role="status" key={`url-${task.id}`}>A URL inside the prompt is not fetched. Add it as a public webpage source above if retrieval is intended.</p>)}<button className="add-task-button" type="button" disabled={!capabilities?.live_enabled || customTasks.length >= (capabilities?.max_tasks ?? 10)} onClick={() => setCustomTasks((items) => [...items, { id: `live-${Date.now()}`, type: 'classify', prompt: '' }])}>+ Add task <span>{customTasks.length}/{capabilities?.max_tasks ?? 10}</span></button><p className="privacy-note"><LockIcon /> Use synthetic samples. Do not submit sensitive prompts.</p></div>}
          <div className="carbon-control"><label htmlFor="carbon-intensity"><span className="label-main">Scenario carbon intensity</span><span className="label-sub">Illustrative input, not live grid data</span></label><div className="range-value"><input id="carbon-intensity" type="number" min="0" max="2000" step="25" value={carbon} onChange={(e) => setCarbon(Math.max(0, Math.min(2000, Number(e.target.value))))} disabled={!!run || submitting} /><span>gCO₂e / kWh</span></div></div>
          {error && <div className="error-box compact" role="alert"><AlertIcon />{error}{showStopActiveAction && <button className="agent-stop-button" type="button" disabled={stoppingRun} onClick={() => void stopActiveRun()}>{stoppingRun ? 'Stopping…' : 'Stop active run'}</button>}</div>}
          <div className="panel-footer"><div className="selection-note"><span className="tiny-dot" />{mode === 'demo' ? `${selectedTasks.length} of ${samples?.tasks.length ?? 0} tasks selected` : `${customTasks.length} task${customTasks.length === 1 ? '' : 's'} ready`}</div><div className="actions">{run && <button className="secondary-button" onClick={reset}>New comparison</button>}<button className="compare-button" onClick={() => void start()} disabled={loading || submitting || !capabilities?.demo_enabled || (mode === 'live' && !capabilities.live_enabled) || !!run || (sourceSelected && (!sourceSnapshot || mode !== 'live' || !sourceConfirmed))}><span>{submitting ? 'Starting…' : sourceSelected && !sourceSnapshot ? 'Preview source first' : sourceSnapshot && mode !== 'live' ? 'Switch to Live' : sourceSnapshot && !sourceConfirmed ? 'Confirm source first' : 'Compare policies'}</span>{submitting ? <span className="button-spinner" /> : <ArrowIcon />}</button></div></div>
        </>}
      </section>

      {notice && <div className="notice-strip" role="status"><CheckIcon />{notice}</div>}
      {run && <section className="results-section"><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Comparison status: {statusLabel}.</p><div className="results-heading"><div><div className="section-kicker">02 / RESULTS</div><h2>Your comparison</h2><p className="run-meta">Run <span>{run.id.slice(0, 8)}</span> · {run.tasks.length} tasks · {new Date(run.created_at).toLocaleString()}</p></div><div className="results-actions"><div className="run-badges"><span className={`mode-badge ${run.mode}`}><span />{run.mode === 'demo' ? 'DEMO' : 'LIVE'}</span><span className={`provenance-pill ${run.measurement_source === 'simulated' ? 'simulated' : 'observed'}`}><span />{run.measurement_source === 'simulated' ? 'SIMULATED' : 'OBSERVED'}</span><span className={`status-badge ${run.status}`}><span className="status-dot" />{statusLabel}</span></div><div className="export-actions">{!terminal(run.status) && <button className="agent-stop-button" type="button" disabled={stoppingRun} onClick={() => void stopActiveRun(run.id)}>{stoppingRun ? 'Stopping…' : 'Stop run'}</button>}<button className="secondary-button export-button" type="button" onClick={exportSnapshot}>Export JSON</button><button className="secondary-button export-button" type="button" onClick={exportCsv}>Export CSV</button><button className="secondary-button export-button" type="button" onClick={printReport}>Print / Save PDF</button></div></div></div>
        {networkError && <div className="error-box compact" role="alert"><AlertIcon /><span>{networkError}</span><button className="text-button" onClick={() => void retry()}>Retry now</button></div>}
        {run.run_error && <div className="error-box compact" role="alert"><AlertIcon />{run.run_error.message} <span className="error-code">{run.run_error.code}</span></div>}
        <div className="progress-panel panel"><div className="progress-top"><div><span className="label-main">Run progress</span><span className="label-sub">{run.completed_attempts} of {run.total_attempts} attempts completed</span></div><span className="progress-time"><span className="clock-icon" aria-hidden="true">◷</span> {terminal(run.status) ? 'Finished' : `Running ${Math.floor(now / 60).toString().padStart(2, '0')}:${(now % 60).toString().padStart(2, '0')}`}</span></div><div className="progress-track" role="progressbar" aria-label="Comparison progress" aria-valuemin={0} aria-valuemax={run.total_attempts} aria-valuenow={run.completed_attempts}><div className={`progress-fill ${run.status}`} style={{ width: `${run.total_attempts ? Math.min(100, run.completed_attempts / run.total_attempts * 100) : 0}%` }} /></div>{run.status === 'partial' && <p className="progress-caption">Some attempts failed. Metrics use only backend-defined matching cohorts.</p>}</div>
        <ActualRoutingTrace run={run} fixtureMode={api.isMock} />
        <div className="metrics-heading"><div><h3>Impact overview</h3><span className="incomplete-note">{run.status === 'completed' ? 'Backend-provided comparison · answer quality not evaluated' : 'Incomplete comparison · values update as attempts finish'}</span></div><span className="metrics-count">{run.comparison.successful_pairs} matched pairs</span></div>
        <div className="metric-grid"><MetricCard title="Illustrative energy" unit="Wh" values={run.comparison.energy_wh} count={run.comparison.energy_pairs} cohort="complete usage pairs" format={(v) => fixed(v, 6)} icon={<EnergyIcon />} tint="sage" /><MetricCard title="GPU energy · call window" unit="Wh" values={run.comparison.measured_gpu_energy_wh} count={run.comparison.measured_gpu_energy_pairs} cohort="paired local Ollama calls" format={(v) => fixed(v, 6)} icon={<EnergyIcon />} tint="blue" /><MetricCard title="Illustrative carbon" unit="gCO₂e" values={run.comparison.carbon_g} count={run.comparison.energy_pairs} cohort="complete usage pairs" format={(v) => fixed(v, 6)} icon={<LeafIcon />} tint="mint" /><MetricCard title={run.mode === 'demo' ? 'Simulated latency' : 'Observed latency'} unit="ms" values={run.comparison.latency_ms} count={run.comparison.latency_pairs} cohort="successful pairs" format={integer} icon={<ClockIcon />} tint="blue" changeType="latency" /></div>
        {run.mode === 'live' && run.results.some((result) => result.model_id.startsWith('ollama::')) && <section className="gpu-call-readings panel" aria-labelledby="gpu-call-readings-title"><div><span className="section-kicker">LOCAL DEVICE TELEMETRY</span><h3 id="gpu-call-readings-title">GPU readings by Ollama call</h3><p>These are backend measurements for each local model call, not an estimate attributed only to the model.</p></div><ul>{run.results.filter((result) => result.model_id.startsWith('ollama::')).map((result) => <li key={`${result.task_id}-${result.policy}`}><strong>{result.policy} · {result.task_id}</strong><span>{result.status === 'succeeded' && result.measured_gpu_energy_wh !== null ? `${fixed(result.measured_gpu_energy_wh, 6)} Wh` : 'GPU reading unavailable'}</span><small>{result.model_id} · {result.gpu_device_name ?? 'NVIDIA device unavailable'} · call {result.gpu_sample_count ?? 0} samples{result.gpu_utilization_pct !== null ? ` · ${fixed(result.gpu_utilization_pct, 1)}% utilization` : ''}{result.gpu_average_power_w !== null ? ` · ${fixed(result.gpu_average_power_w, 1)} W call power` : ''}{result.gpu_idle_baseline_power_w !== null ? ` · ${fixed(result.gpu_idle_baseline_power_w, 1)} W pre-call device baseline (${fixed(result.gpu_idle_baseline_duration_ms, 0)} ms, ${result.gpu_idle_baseline_sample_count ?? 0} samples)` : ''}{result.gpu_power_delta_w !== null ? ` · ${result.gpu_power_delta_w >= 0 ? '+' : ''}${fixed(result.gpu_power_delta_w, 1)} W vs pre-call baseline` : ''}</small></li>)}</ul><p className="gpu-call-pair-note">The paired GPU savings card requires both baseline and optimized calls for a task to have local GPU readings. It can show Unavailable even when individual local readings are present.</p></section>}
        <div className="metric-caveat"><InfoIcon /><span>{run.mode === 'demo' ? 'Demo latency, token usage and outputs are simulated fixtures. Coefficient-based energy and scenario carbon are illustrative, not measured emissions.' : 'Latency is client timing and token counts are provider usage where available. Ollama output speed uses its eval_count/eval_duration counters. Coefficient-based energy and scenario carbon are illustrative estimates. Local Ollama calls may include NVIDIA GPU device utilization, power and integrated energy over each call window. These include idle and shared GPU activity and are not attributed to the inference process or a user; CPU energy is excluded.'} Latency totals sum successful attempt timings and are not necessarily elapsed job duration.</span><span className="caveat-tag">LOCAL DEVICE TELEMETRY WHEN AVAILABLE</span></div>
        <EcoImpactPanel run={run} />
        <section className="comparison-panel panel"><div className="table-heading"><div><span className="section-kicker">03 / ATTEMPTS</span><h3 id="routing-breakdown-title">Routing breakdown</h3></div><span className="table-side-note">Policy decisions per task</span></div><div className="table-scroll" role="region" aria-labelledby="routing-breakdown-title" tabIndex={0}><table><thead><tr><th>Task</th><th>Policy</th><th>Model</th><th>Route reason</th><th>Latency</th><th>Tokens in / out</th><th>Output tok/s</th><th>Energy · estimate</th><th>GPU device</th><th>GPU util · window</th><th>GPU power · window</th><th>GPU energy · window</th><th>Carbon · scenario</th><th>Status</th></tr></thead><tbody>{run.tasks.flatMap((task) => (['baseline', 'optimized'] as const).map((policy) => {
          const result = run.results.find((item) => item.task_id === task.id && item.policy === policy);
          return <tr key={`${task.id}-${policy}`}><td><span className="table-task-id">{task.id}</span><span className="table-task-type">{task.type}</span></td><td><span className={`policy-label ${policy}`}>{policy}</span></td><td><span className={`model-label ${result?.model_role ?? ''}`}>{result ? result.model_role : missing}</span><span className="model-id">{result?.model_id ?? 'Pending'}</span></td><td className="route-reason">{result?.routing_reason ?? missing}</td><td>{result ? `${integer(result.latency_ms)} ms` : missing}</td><td>{result ? `${integer(result.input_tokens)} / ${integer(result.output_tokens)}` : missing}</td><td>{result?.output_tokens_per_second != null ? `${fixed(result.output_tokens_per_second, 1)} · Ollama` : missing}</td><td>{result ? fixed(result.estimated_energy_wh, 6) : missing}</td><td>{result?.gpu_device_name ? <><span>GPU {result.gpu_device_index}: {result.gpu_device_name}</span><small className="table-measurement-source">Device-wide call window</small></> : missing}</td><td>{result?.gpu_utilization_pct != null ? `${fixed(result.gpu_utilization_pct, 1)}%` : missing}</td><td>{result?.gpu_average_power_w != null ? `${fixed(result.gpu_average_power_w, 1)} W` : missing}</td><td>{result ? fixed(result.measured_gpu_energy_wh, 6) : missing}{result?.gpu_energy_measurement && <small className="table-measurement-source">{result.gpu_sample_count ?? 0} samples · whole device</small>}</td><td>{result ? fixed(result.estimated_carbon_g, 6) : missing}</td><td>{result ? <span className={`attempt-status ${result.status}`}>{result.status === 'succeeded' ? 'Succeeded' : 'Failed'}</span> : <span className="pending-status">Pending</span>}{result?.error && <span className="attempt-error">{result.error.code}: {result.error.message}</span>}</td></tr>;
        }))}</tbody></table></div></section>
        {exportNotice && <p className="export-notice" role="status">{exportNotice}</p>}
        <section className="answer-section"><div className="answer-heading"><div><span className="section-kicker">04 / OUTPUTS</span><h3>Response comparison</h3><p className="review-explanation">Human judgments only; these annotations are not automated quality scores.</p></div><button className="secondary-button reset-reviews" type="button" onClick={resetManualReviews}>Reset reviews</button></div><p className="review-storage-note">Review labels are stored only in this browser for this run. They do not change backend results.{!reviewStorageAvailable && ' Browser storage is unavailable; labels will last only until this page is closed.'}</p><p className="export-data-note">Export includes this loaded run snapshot and review labels. Prompts and outputs may contain user-supplied data.</p><div className="output-tools"><label htmlFor="output-search">Find in responses<input id="output-search" type="search" value={outputSearch} onChange={(event) => setOutputSearch(event.target.value)} placeholder="Search response text" /></label><span>Matches are highlighted; complete returned text stays visible.</span></div>{copyFeedback && <p className="output-feedback" role="status">{copyFeedback}</p>}<div className="answer-grid">{run.tasks.map((task, i) => { const baseline = run.results.find((r) => r.task_id === task.id && r.policy === 'baseline'); const optimized = run.results.find((r) => r.task_id === task.id && r.policy === 'optimized'); const isExpanded = expandedTaskId === task.id; const reviewed = taskReview(manualReviews, task.id); return <article className="answer-card" key={task.id}><div className="answer-card-head"><span className="answer-index">0{i + 1}</span><div><strong>{typeNames[task.type]}</strong><span>{task.id}</span></div><span className="manual-review">MANUAL REVIEW</span></div><div className="answer-pair"><div className="reviewed-answer"><Answer policy="baseline" result={baseline} searchTerm={outputSearch} onCopy={(text) => void copyOutput(task.id, 'baseline', text)} /><label className="review-control" htmlFor={`review-${task.id}-baseline`}>Human review · baseline · {task.id}<select id={`review-${task.id}-baseline`} value={reviewed.baseline} onChange={(event) => updateManualReview(task.id, 'baseline', event.target.value as ReviewChoice)}>{reviewChoices.map((choice) => <option key={choice} value={choice}>{choice === 'not_reviewed' ? 'Not reviewed' : choice[0].toUpperCase() + choice.slice(1)}</option>)}</select></label></div><div className="reviewed-answer"><Answer policy="optimized" result={optimized} searchTerm={outputSearch} onCopy={(text) => void copyOutput(task.id, 'optimized', text)} /><label className="review-control" htmlFor={`review-${task.id}-optimized`}>Human review · optimized · {task.id}<select id={`review-${task.id}-optimized`} value={reviewed.optimized} onChange={(event) => updateManualReview(task.id, 'optimized', event.target.value as ReviewChoice)}>{reviewChoices.map((choice) => <option key={choice} value={choice}>{choice === 'not_reviewed' ? 'Not reviewed' : choice[0].toUpperCase() + choice.slice(1)}</option>)}</select></label></div></div><button className="disclosure-button" onClick={() => setExpandedTaskId(isExpanded ? null : task.id)} aria-expanded={isExpanded}>{isExpanded ? 'Hide' : 'Show'} task prompt <ChevronIcon open={isExpanded} /></button>{isExpanded && <p className="prompt-disclosure">{task.prompt}</p>}</article>; })}</div></section>
        <details className="assumptions panel"><summary><span><span className="section-kicker">METHODOLOGY</span><strong>What these estimates mean</strong></span><ChevronIcon /></summary><div className="assumption-content"><p>The backend supplied all displayed aggregates. The <strong>illustrative-v1</strong> profile uses hypothetical token-energy coefficients and does not measure provider electricity use.</p><div className="coefficient-grid">{(['small', 'large'] as const).map((role) => <div key={role} className="coefficient-card"><span>{role} model</span><code>{capabilities?.energy_profile.models[role].input_wh_per_token ?? missing} Wh / input token</code><code>{capabilities?.energy_profile.models[role].output_wh_per_token ?? missing} Wh / output token</code></div>)}</div><p><strong>GPU device telemetry · call window</strong> is available only for local Ollama requests when NVIDIA telemetry works. Before each local comparison call, EcoAgent samples whole-device power and utilization for GPU_IDLE_BASELINE_SECONDS (default 3 seconds), then reports call-window power and energy plus the power difference from that pre-call baseline when both readings are available. The baseline wait is excluded from provider latency. The device may already be doing other work during the sample, so it is not guaranteed to be idle. These figures describe the whole GPU, not energy attributable to the model, process or user; they include unrelated GPU activity and exclude CPU, memory and system power. Telemetry may be unavailable when readings do not closely cover a request. Ollama output tokens/s comes from its native generated-token count and generation duration; other providers report Unavailable.</p><p>Carbon remains a scenario calculation using the selected value: <strong>{run.carbon_intensity_g_per_kwh} gCO₂e/kWh</strong>. It is not live grid data or measured emissions. The illustrative coefficients omit hardware, utilization, cooling, networking, location and time variation. Successful HTTP responses do not establish equal answer quality. Negative savings mean an increase.</p></div></details>
        <PrintRunReport run={run} reviews={manualReviews} />
      </section>}
      {!run && !loading && capabilities && <section className="empty-state"><div className="empty-icon"><LeafIcon /></div><p>SELECT A WORKLOAD TO BEGIN</p><span>Your comparison will appear here. Backend responses determine all routing, metrics and results.</span></section>}
      <footer className="footer"><span>ecoagent<span className="brand-period">.</span> <span className="footer-separator">/</span> Inference, considered.</span><span>ESTIMATES ARE ILLUSTRATIVE. RESULTS ARE NOT QUALITY EVALUATIONS.</span></footer>
    </div>
    {page === 'benchmarks' && <div className="content"><BenchmarkDashboard initialRunId={benchmarkRunToOpen} onOpenComparisonRun={(id) => { void openComparisonRun(id, 'A comparison run is active. Opened it from the benchmark conflict response.'); }} onOpenProviderSettings={() => setProviderSettingsOpen(true)} /></div>}
    {page === 'agent' && <div className="content"><AgentDashboard initialRunId={agentRunToOpen} onOpenProviderSettings={() => setProviderSettingsOpen(true)} onOpenActiveRun={navigateToAgent} /></div>}
    </main>
  </div>;
}

function downloadFile(contents: string, filename: string, mimeType: string) {
  const objectUrl = window.URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
}

function displayValue(value: string | number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? missing : `${value}${suffix}`;
}

function PrintRunReport({ run, reviews }: { run: Run; reviews: TaskReviews }) {
  const taskTypes = new Map(run.tasks.map((task) => [task.id, task.type]));
  const summaryRows: { label: string; metric: ComparisonMetric; unit: string; count: number; cohort: string }[] = [
    { label: 'Latency', metric: run.comparison.latency_ms, unit: 'ms', count: run.comparison.latency_pairs, cohort: 'successful pairs' },
    { label: 'Illustrative energy', metric: run.comparison.energy_wh, unit: 'Wh', count: run.comparison.energy_pairs, cohort: 'complete usage pairs' },
    { label: 'Illustrative carbon', metric: run.comparison.carbon_g, unit: 'gCO₂e', count: run.comparison.energy_pairs, cohort: 'complete usage pairs' },
  ];
  return <article className="print-report" aria-hidden="true">
    <header className="print-report-header"><h1>EcoAgent comparison report</h1><p>Run {run.id} · {run.created_at}</p><p>{run.mode.toUpperCase()} · {run.measurement_source === 'simulated' ? 'SIMULATED' : 'OBSERVED'} · {run.status.toUpperCase()}</p></header>
    {!terminal(run.status) && <p className="print-warning">This is a nonterminal snapshot. Results may be incomplete.</p>}
    {run.status === 'partial' && <p className="print-warning">This run is partial. Review failed and pending attempts before interpreting aggregates.</p>}
    {run.status === 'failed' && <p className="print-warning">This run failed. The snapshot may contain only partial attempt data.</p>}
    {run.run_error && <p className="print-warning">Run error: {run.run_error.code} · {run.run_error.message}</p>}
    <section className="print-section"><h2>Workload and routing</h2>{run.tasks.map((task) => <div className="print-task" key={task.id}><h3>{task.id} · {taskTypes.get(task.id)}</h3><pre className="print-prompt">{task.prompt}</pre>{(['baseline', 'optimized'] as const).map((policy) => {
      const result = run.results.find((item) => item.task_id === task.id && item.policy === policy);
      return <p key={policy}><strong>{policy}:</strong> {result ? `${result.model_id} (${result.routing_reason}) · ${result.status}` : 'Unavailable'}</p>;
    })}</div>)}</section>
    <section className="print-section"><h2>{run.mode === 'demo' ? 'Simulated latency' : 'Observed latency'}</h2><table className="print-table"><thead><tr><th>Metric</th><th>Baseline</th><th>Optimized</th><th>Saved / change</th><th>Cohort</th></tr></thead><tbody>{summaryRows.filter(({ label }) => label === 'Latency').map(({ label, metric, unit, count, cohort }) => <tr key={label}><th>{label}</th><td>{displayValue(metric.baseline, ` ${unit}`)}</td><td>{displayValue(metric.optimized, ` ${unit}`)}</td><td>{displayValue(metric.saved, ` ${unit}`)} · {displayValue(metric.savings_pct, '%')}</td><td>{count} {cohort}</td></tr>)}</tbody></table><p>Latency is a sum of successful attempt timings, not necessarily elapsed job duration. Token counts appear per attempt below and follow the run provenance.</p></section>
    <section className="print-section"><h2>Illustrative estimates</h2><table className="print-table"><thead><tr><th>Metric</th><th>Baseline</th><th>Optimized</th><th>Saved / change</th><th>Cohort</th></tr></thead><tbody>{summaryRows.filter(({ label }) => label !== 'Latency').map(({ label, metric, unit, count, cohort }) => <tr key={label}><th>{label}</th><td>{displayValue(metric.baseline, ` ${unit}`)}</td><td>{displayValue(metric.optimized, ` ${unit}`)}</td><td>{displayValue(metric.saved, ` ${unit}`)} · {displayValue(metric.savings_pct, '%')}</td><td>{count} {cohort}</td></tr>)}</tbody></table><p>Negative savings indicate an increase.</p></section>
    <section className="print-section"><h2>Attempts and answer review</h2>{run.tasks.map((task) => <div className="print-task" key={task.id}><h3>{task.id} · {task.type}</h3>{(['baseline', 'optimized'] as const).map((policy) => {
      const result = run.results.find((item) => item.task_id === task.id && item.policy === policy);
      const review = taskReview(reviews, task.id)[policy];
      return <div className="print-answer" key={policy}><h4>{policy} · {result?.model_id ?? 'Unavailable'} · {result?.status ?? 'pending'}</h4><p>Human review: {review.replace('_', ' ')}</p><pre className="print-output">{result?.output_text ?? (result?.status === 'failed' ? result.error?.message : null) ?? missing}</pre><p>Route: {result?.routing_reason ?? missing}; latency: {displayValue(result?.latency_ms, ' ms')}; tokens in/out: {displayValue(result?.input_tokens)} / {displayValue(result?.output_tokens)}; output speed: {displayValue(result?.output_tokens_per_second, ' tokens/s')}; GPU: {result?.gpu_device_name ?? missing}; utilization: {displayValue(result?.gpu_utilization_pct, '%')}; pre-call baseline power: {displayValue(result?.gpu_idle_baseline_power_w, ' W')}; average call power: {displayValue(result?.gpu_average_power_w, ' W')}; power delta vs baseline: {displayValue(result?.gpu_power_delta_w, ' W')}; GPU energy: {displayValue(result?.measured_gpu_energy_wh, ' Wh')}; estimated energy: {displayValue(result?.estimated_energy_wh, ' Wh')}; estimated carbon: {displayValue(result?.estimated_carbon_g, ' gCO₂e')}.</p></div>;
    })}</div>)}</section>
    <section className="print-section"><h2>Method and limitations</h2><p>Latency and token figures follow the run's provenance above. Energy and carbon are illustrative estimates using profile {run.energy_estimation_profile} and scenario carbon intensity {run.carbon_intensity_g_per_kwh} gCO₂e/kWh; neither is measured electricity or verified emissions. A successful response does not establish answer correctness or equal answer quality. Human review labels are subjective local annotations, not automated evaluation.</p><p>Source snapshot: {run.source_snapshot ? `${run.source_snapshot.kind} · ${run.source_snapshot.name} · SHA-256 ${run.source_snapshot.content_sha256} · ${run.source_snapshot.character_count} characters. This snapshot was confirmed for provider submission.` : 'None attached.'} Source references locate input text only. The model does not return validated answer citations.</p><p>This report contains supplied prompts and outputs. Handle it as user-provided content. It includes no API credentials.</p></section>
    <p className="print-footer">Print workflow: choose “Save as PDF” in the browser print dialog. This page does not create a direct PDF download.</p>
  </article>;
}

function ActualRoutingTrace({ run, fixtureMode }: { run: Run; fixtureMode: boolean }) {
  return <section className="routing-trace" aria-labelledby="routing-trace-heading">
    <div className="routing-trace-heading"><div><span className="section-kicker">BACKEND TRACE</span><h3 id="routing-trace-heading">Routes returned for this run</h3></div><p>{fixtureMode ? 'Destinations and reasons come from the labeled fixture.' : 'Destinations and reasons come from the backend response.'} The moving packet is decorative, not run progress.</p></div>
    <div className="routing-trace-tasks">{run.tasks.map((task) => {
      const baseline = run.results.find((result) => result.task_id === task.id && result.policy === 'baseline');
      const optimized = run.results.find((result) => result.task_id === task.id && result.policy === 'optimized');
      return <article className="routing-trace-task" key={task.id}>
        <h4><span>{task.id}</span><small>{task.type}</small></h4>
        <RouteTrace policy="Baseline" result={baseline} />
        <RouteTrace policy="Optimized" result={optimized} />
      </article>;
    })}</div>
  </section>;
}

function RouteTrace({ policy, result }: { policy: string; result: Run['results'][number] | undefined }) {
  const destination = result?.model_role ?? missing;
  const reason = result?.routing_reason ?? missing;
  return <div className="route-trace-row">
    <span className="route-trace-policy">{policy}</span>
    <div className={`route-trace-track ${result ? 'has-result' : ''}`} aria-hidden="true"><span className="route-trace-origin" /><span className="route-trace-line" />{result && <span key={`${result.model_role}-${result.routing_reason}`} className="route-trace-packet" />}<span className={`route-trace-node ${result?.model_role ?? ''}`} /></div>
    <span className="route-trace-destination">{destination}</span><span className="route-trace-reason">{reason}</span>
  </div>;
}

function EcoAgentMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.5 4.5c-7.6.1-12.8 2.7-13.7 8.1-.6 3.6 1.6 6.2 4.8 6.2 5.6 0 8.9-6.2 8.9-14.3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M5 20c2.7-4.3 5.7-6.8 10.8-9.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="m10.2 15.9 4.1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
}

function RoutePolicyGraphic() {
  return <div className="policy-graphic" role="img" aria-label="Policy overview. The baseline sends every task to the large model. EcoAgent sends the task to its backend, which selects a model and returns the routing reason.">
    <div className="policy-graphic-heading"><span>POLICY OVERVIEW</span><span className="policy-live-indicator"><i /> BACKEND DECIDES</span></div>
    <div className="policy-flow-row baseline-flow"><span className="flow-policy-label">BASELINE</span><span className="flow-task-node">Every task</span><span className="flow-connector" aria-hidden="true" /><span className="flow-model-node large-model"><span className="model-node-icon" aria-hidden="true">L</span><span><strong>Large model</strong><small>Fixed destination</small></span></span></div>
    <div className="policy-flow-row optimized-flow"><span className="flow-policy-label">OPTIMIZED</span><span className="flow-task-node">Task type</span><span className="flow-connector branching-connector" aria-hidden="true"><i /><i /></span><span className="flow-model-stack"><span className="flow-model-node small-model"><span className="model-node-icon" aria-hidden="true">S</span><span><strong>Small model</strong><small>Backend selected</small></span></span><span className="flow-model-node large-model"><span className="model-node-icon" aria-hidden="true">L</span><span><strong>Large model</strong><small>Backend selected</small></span></span></span></div>
    <p className="policy-graphic-footnote">Actual model and routing reason appear in each run result.</p>
  </div>;
}

function MetricCard({ title, unit, values, count, cohort, format, icon, tint, changeType = 'savings' }: { title: string; unit: string; values: { baseline: number | null; optimized: number | null; saved: number | null; savings_pct: number | null }; count: number; cohort: string; format: (value: number | null) => string; icon: React.ReactNode; tint: string; changeType?: 'savings' | 'latency' }) {
  const latency = changeType === 'latency' ? latencyChange(values) : null;
  const increase = changeType === 'latency' ? latency?.direction === 'slower' : values.saved !== null && values.saved < 0;
  const value = changeType === 'latency' ? latency?.magnitude ?? null : values.saved;
  const label = changeType === 'latency'
    ? latency?.direction ?? ''
    : values.saved === null ? '' : values.saved < 0 ? 'increase' : 'saved';
  const changePct = changeType === 'latency'
    ? latency?.percentage === null || latency?.percentage === undefined || latency.direction === null ? missing : `${latency.percentage.toFixed(1)}% ${latency.direction}`
    : pct(values.savings_pct);
  return <article className={`metric-card panel ${tint}`}><div className="metric-card-top"><span>{title}</span><span className="metric-icon">{icon}</span></div><div className="metric-main"><strong>{format(value)}</strong><span>{unit} {label}</span></div><div className="metric-comparison"><div><span>BASELINE</span><strong>{format(values.baseline)} <i>{unit}</i></strong></div><span className="metric-arrow">→</span><div><span>OPTIMIZED</span><strong>{format(values.optimized)} <i>{unit}</i></strong></div></div><div className="metric-foot"><span>{count} {cohort}</span><span className={increase ? 'increase-pct' : ''}>{changePct}</span></div></article>;
}

function TaskConstraintFields({ task, disabled, onChange }: { task: Task; disabled: boolean; onChange: (constraints: TaskConstraints | null) => void }) {
  if (task.type === 'classify') return <label className="task-constraint">Allowed labels for deterministic validation (comma-separated)<input disabled={disabled} value={task.constraints?.allowed_labels?.join(', ') ?? ''} onChange={(event) => { const labels = event.target.value.split(',').map((value) => value.trim()).filter(Boolean); onChange(labels.length ? { allowed_labels: labels } : null); }} placeholder="billing, technical, general" /></label>;
  if (task.type === 'extract') return <label className="task-constraint">Required JSON fields for deterministic validation (comma-separated)<input disabled={disabled} value={task.constraints?.required_json_fields?.join(', ') ?? ''} onChange={(event) => { const fields = event.target.value.split(',').map((value) => value.trim()).filter(Boolean); onChange(fields.length ? { required_json_fields: fields } : null); }} placeholder="order_id, total_usd" /></label>;
  if (task.type === 'code') return <p className="task-constraint-note">Generated code is shown as text. It is not executed or tested in a workspace.</p>;
  if (task.type === 'write') return <p className="task-constraint-note">Generated writing is shown as text for human review.</p>;
  return null;
}

function Answer({ policy, result, searchTerm, onCopy }: { policy: 'baseline' | 'optimized'; result: Run['results'][number] | undefined; searchTerm: string; onCopy: (output: string | null) => void }) {
  const output = result?.status === 'succeeded' ? result.output_text : null;
  return <div className={`answer-output ${policy}`}><div className="answer-output-label"><span className={`policy-dot ${policy}`} />{policy}<span className="answer-model">{result?.model_role ?? missing}</span><button type="button" className="copy-output" aria-label={`Copy ${policy} output for ${result?.task_id ?? 'pending task'}`} disabled={output === null} onClick={() => onCopy(output)}>Copy</button></div>{result?.output_truncated === true && <p className="source-warning" role="status">Provider ended generation at its output limit (finish reason: {result.provider_finish_reason ?? 'length'}). This answer may be incomplete. It was not automatically retried.</p>}{result?.output_validation === 'failed' && <p className="source-warning" role="status">Deterministic validation failed: {result.validation_notes.join(' ') || 'Review this output against the task requirements.'}</p>}{result?.fallback_used && <details className="fallback-details"><summary>Validation fallback · {result.attempt_count} provider calls</summary><p>Initial small-model answer ({result.initial_attempt?.model_id ?? missing}): {result.initial_attempt?.output_text ?? result.initial_attempt?.error?.message ?? missing}</p><p>Large-model fallback ({result.fallback_attempt?.model_id ?? missing}): {result.fallback_attempt?.output_text ?? result.fallback_attempt?.error?.message ?? missing}</p><p>Displayed metrics include both attempts; estimate values remain illustrative.</p></details>}{result?.output_truncated === null && result.status === 'succeeded' && <p className="source-warning" role="status">Provider completion status is unavailable; response completeness has not been verified.</p>}<div className="answer-text">{!result ? <span className="muted">Waiting for backend output…</span> : result.status === 'failed' ? <span className="failed-answer"><AlertIcon /> {result.error?.message ?? 'Attempt failed.'}</span> : result.output_text === null ? missing : highlightOutput(result.output_text, searchTerm)}</div></div>;
}

function highlightOutput(text: string, query: string): React.ReactNode {
  const term = query.trim();
  if (!term) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) => index % 2 === 1 ? <mark className="output-match" key={index}>{part}</mark> : part);
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
