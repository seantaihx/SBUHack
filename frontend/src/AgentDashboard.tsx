import { useEffect, useMemo, useState } from 'react';
import { agentApi } from './api/client';
import type { AgentCapabilities, AgentRun, AgentStartRequest } from './api/types';

const lines = (value: string) => Array.from(new Set(value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)));

export default function AgentDashboard({ initialRunId }: { initialRunId: string | null }) {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [type, setType] = useState<'write' | 'code'>('code');
  const [instruction, setInstruction] = useState('');
  const [readPaths, setReadPaths] = useState('');
  const [writePaths, setWritePaths] = useState('');
  const [maxSteps, setMaxSteps] = useState(12);
  const [reviewInterval, setReviewInterval] = useState(5);
  const [elapsedLimit, setElapsedLimit] = useState(3600);
  const [checklistText, setChecklistText] = useState('');
  const [guidance, setGuidance] = useState('');
  const [additionalSteps, setAdditionalSteps] = useState(10);
  const [checkedItems, setCheckedItems] = useState<number[]>([]);
  const [confirmProvider, setConfirmProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([agentApi.capabilities(), initialRunId ? agentApi.get(initialRunId) : Promise.resolve(null)])
      .then(([caps, snapshot]) => {
        if (!alive) return;
        setCapabilities(caps); setRun(snapshot);
        if (snapshot) setInstruction(snapshot.instruction);
      })
      .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load workspace-agent status.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [initialRunId]);

  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status) || run.phase !== 'planning') return;
    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const snapshot = await agentApi.get(run.run_id, controller.signal);
        if (cancelled) return;
        setRun(snapshot); setError(null);
        if (['queued', 'running'].includes(snapshot.status) && snapshot.phase === 'planning') timer = window.setTimeout(poll, 900);
      } catch (reason) {
        if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Could not refresh the workspace run.'); timer = window.setTimeout(poll, 2500); }
      }
    };
    timer = window.setTimeout(poll, 400);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [run?.run_id, run?.status, run?.phase]);

  useEffect(() => { setCheckedItems(run?.completed_items ?? []); }, [run?.run_id, run?.completed_items]);

  const canStart = Boolean(capabilities?.enabled && instruction.trim() && confirmProvider
    && (lines(readPaths).length > 0 || lines(writePaths).length > 0));
  const pending = run?.pending_action ?? null;
  const eventCount = useMemo(() => run?.events.length ?? 0, [run?.events.length]);

  const updateUrl = (id: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('run'); url.searchParams.delete('benchmark');
    if (id) url.searchParams.set('agent', id); else url.searchParams.delete('agent');
    window.history.replaceState({}, '', url);
  };

  const start = async () => {
    if (!canStart || busy) return;
    setBusy(true); setError(null); setNotice(null); setRun(null);
    const payload: AgentStartRequest = {
      task_type: type, instruction: instruction.trim(), confirm_provider_submission: true,
      read_paths: lines(readPaths), write_paths: lines(writePaths), max_steps: maxSteps, review_interval: reviewInterval, max_elapsed_seconds: elapsedLimit, checklist: lines(checklistText),
    };
    try {
      const created = await agentApi.start(payload); setRun(created); updateUrl(created.run_id);
      setNotice('Agent plan started. No file operation runs before you approve it.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the workspace run.');
    } finally { setBusy(false); }
  };

  const decide = async (approved: boolean) => {
    if (!run || !pending || busy) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.approve(run.run_id, pending.action_id, pending.action_hash, approved)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record that approval.'); }
    finally { setBusy(false); }
  };

  const continueRun = async () => {
    if (!run || busy) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.continue(run.run_id, guidance)); setGuidance(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not continue the workspace run.'); }
    finally { setBusy(false); }
  };

  const extend = async () => {
    if (!run || busy || !guidance.trim()) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.extend(run.run_id, additionalSteps, guidance)); setNotice('Budget extended on this run. History and spending limits retained. Continue separately.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not extend the run.'); }
    finally { setBusy(false); }
  };

  const review = async (accept: boolean) => {
    if (!run || busy || !guidance.trim()) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.review(run.run_id, checkedItems, accept, guidance)); setNotice(accept ? 'Completion accepted by operator review.' : 'Checklist review saved.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save review.'); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    if (!run || busy) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.stop(run.run_id)); updateUrl(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop the workspace run.'); }
    finally { setBusy(false); }
  };

  return <section className="agent-dashboard panel" aria-labelledby="agent-title">
    <div className="agent-heading"><div><span className="section-kicker">BOUNDED WORKSPACE AGENT</span><h1 id="agent-title">Writing and code with permission checks</h1><p>Model-generated changes stay proposals until you approve each exact file operation.</p></div><span className={`agent-status-pill ${capabilities?.enabled ? 'enabled' : ''}`}>{capabilities?.enabled ? `WORKSPACE · ${capabilities.workspace_name}` : 'DISABLED'}</span></div>
    {loading && <p role="status">Checking backend agent capability…</p>}
    {capabilities && !capabilities.enabled && <div className="agent-warning" role="status">{capabilities.disabled_reason}</div>}
    <div className="agent-safety-note"><strong>Safety boundary:</strong> this prototype can only read or write exact paths you list below, and each operation needs approval. Shell commands, network tools, deletes, deployments, git operations, and permissions changes are not available. Code is not executed or tested.</div>
    <div className="agent-form">
      <label>Task type<select value={type} onChange={(event) => setType(event.target.value as 'write' | 'code')} disabled={!capabilities?.enabled || busy}><option value="code">Code generation/edit</option><option value="write">Writing</option></select></label>
      <label>What should the agent do?<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={5000} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} placeholder="Describe one bounded writing or code task." /></label>
      <label>Allowed read paths <span>One exact workspace-relative path per line</span><textarea value={readPaths} onChange={(event) => setReadPaths(event.target.value)} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} placeholder={'frontend/src/App.tsx\nREADME.md'} /></label>
      <label>Allowed write paths <span>One exact workspace-relative path per line</span><textarea value={writePaths} onChange={(event) => setWritePaths(event.target.value)} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} placeholder="frontend/src/AgentDashboard.tsx" /></label>
      <label>Maximum model calls <input type="number" min={1} max={capabilities?.max_steps ?? 100} value={maxSteps} onChange={(event) => setMaxSteps(Math.max(1, Math.min(capabilities?.max_steps ?? 100, Number(event.target.value))))} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} /></label>
      <label>Review progress every (model calls)<input type="number" min={1} max={20} value={reviewInterval} onChange={(e) => setReviewInterval(Math.max(1, Math.min(20, Number(e.target.value))))} disabled={busy || run?.status === 'running'} /></label>
      <label>Elapsed-time limit (seconds, includes pauses)<input type="number" min={60} max={86400} value={elapsedLimit} onChange={(e) => setElapsedLimit(Math.max(60, Math.min(86400, Number(e.target.value))))} disabled={busy || run?.status === 'running'} /></label>
      <label>Completion criteria <span>One task or check per line; reviewed by you, not self-certified by the model</span><textarea value={checklistText} onChange={(e) => setChecklistText(e.target.value)} disabled={busy || run?.status === 'running'} placeholder={'Output file exists\nReview output against requirements'} /></label>
      <label className="agent-consent"><input type="checkbox" checked={confirmProvider} onChange={(event) => setConfirmProvider(event.target.checked)} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} /><span>I confirm the instruction and any approved file contents may be sent to the backend-configured model provider.</span></label>
      <button type="button" className="primary-button" disabled={!canStart || busy || Boolean(run && run.status === 'running')} onClick={() => void start()}>{busy ? 'Working…' : 'Start bounded run'}</button>
    </div>

    {error && <div className="agent-warning" role="alert">{error}<button type="button" className="text-button" onClick={() => run && void agentApi.get(run.run_id).then(setRun).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Retry failed.'))}>Retry</button></div>}
    {notice && <p className="agent-notice" role="status">{notice}</p>}
    {run && <section className="agent-run" aria-label="Workspace run status" aria-live="polite">
      <div className="agent-run-head"><div><strong>{run.task_type === 'code' ? 'Code task' : 'Writing task'}</strong><span>{run.workspace_name} · {run.model_calls}/{run.max_steps} model calls · {run.steps_completed} file operations completed</span></div><span className={`status-badge ${run.status}`}>{run.phase.replaceAll('_', ' ')}</span></div>
      {run.stop_reason && run.phase === 'paused' && <p className="agent-warning">Paused: {run.stop_reason.replaceAll('_', ' ').toLowerCase()}. Review the log before continuing.</p>}
      {run.stop_reason === 'STEP_LIMIT_REACHED' && <p className="agent-warning">Call budget exhausted; work is paused, not completed. Approve an extension to continue this same run.</p>}
      <section className="agent-progress" aria-label="Progress checkpoints">
        <h2>Work and budget</h2>
        <p>Tokens: {run.input_tokens ?? 'Unavailable'} input / {run.output_tokens ?? 'Unavailable'} output · Estimated API cost: {run.estimated_cost_usd == null ? 'Unavailable' : `$${run.estimated_cost_usd.toFixed(6)}`} · Provider time: {run.provider_latency_ms == null ? 'Unavailable' : `${Math.round(run.provider_latency_ms)} ms`}</p>
        <p>Elapsed-time budget: {run.max_elapsed_seconds ?? 3600} seconds including pauses. Request and spending limits apply independently of model-call extensions.</p>
        <p>Checks use observed actions and file versions; they do not prove factual correctness. No additional model calls are used for checks.</p>
        {(run.checkpoints ?? []).length === 0 && <p>No checkpoint yet.</p>}
        <ol>{(run.checkpoints ?? []).map((check) => <li key={check.sequence}><strong>Call {check.model_calls} · {check.assessment.replaceAll('_', ' ')}</strong><p>{check.summary}</p></li>)}</ol>
      </section>
      {run.phase === 'paused' && run.status === 'running' && <section className="agent-review" aria-label="Operator review">
        <h2>Review and next steps</h2>
        {(run.checklist ?? []).map((item, index) => <label key={index} className="agent-consent"><input type="checkbox" checked={checkedItems.includes(index)} onChange={(e) => setCheckedItems(e.target.checked ? [...checkedItems, index] : checkedItems.filter((i) => i !== index))} disabled={busy} />{item}</label>)}
        <label>Review notes / guidance for the next step<textarea maxLength={2000} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="What changed? What remains? Explain a different approach if work has stalled." disabled={busy} /></label>
        {run.review_required && <p className="agent-warning">No reliable progress was established. Guidance is required before another model call.</p>}
        <div className="agent-actions">
          {(run.checklist ?? []).length > 0 && <button type="button" className="secondary-button" disabled={busy || !guidance.trim() || guidance.length > 1000} onClick={() => void review(false)}>Save checklist review</button>}
          {run.stop_reason === 'COMPLETION_REVIEW_REQUIRED' && <button type="button" className="primary-button" disabled={busy || !guidance.trim() || guidance.length > 1000 || checkedItems.length !== (run.checklist ?? []).length} onClick={() => void review(true)}>Accept reviewed completion</button>}
        </div>
        {run.max_steps < (capabilities?.max_steps ?? 100) && run.stop_reason !== 'TIME_LIMIT_REACHED' && <div className="agent-extension"><label>Additional model calls<input type="number" min={1} max={(capabilities?.max_steps ?? 100) - run.max_steps} value={additionalSteps} onChange={(e) => setAdditionalSteps(Math.max(1, Math.min((capabilities?.max_steps ?? 100) - run.max_steps, Number(e.target.value))))} disabled={busy} /></label><button type="button" className="secondary-button" disabled={busy || !guidance.trim() || guidance.length > 500 || run.max_steps + additionalSteps > (capabilities?.max_steps ?? 100)} onClick={() => void extend()}>Approve additional calls</button></div>}
      </section>}
      {pending && <div className="agent-pending panel"><span className="section-kicker">PENDING YOUR APPROVAL</span><h2>{pending.operation.replace('_', ' ')} · <code>{pending.path}</code></h2><p>{pending.summary}</p>
        {pending.operation === 'write_file' && <><details open><summary>Proposed change diff</summary><pre>{pending.diff ?? 'Diff unavailable'}</pre></details><div className="agent-preview-grid"><div><strong>Current file</strong><pre>{pending.before_text ?? '(new file)'}</pre></div><div><strong>Proposed content</strong><pre>{pending.content}</pre></div></div><p>Base SHA-256: {pending.base_sha256 ?? 'New file'} · The backend rejects the write if the file changes before approval.</p></>}
        {pending.operation === 'read_file' && <p>Preview: <code>{pending.before_text?.slice(0, 500) ?? ''}{(pending.before_text?.length ?? 0) > 500 ? '…' : ''}</code></p>}
        <div className="agent-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void decide(true)}>Approve this exact action</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void decide(false)}>Deny</button></div>
      </div>}
      {!pending && run.status === 'running' && <div className="agent-actions">{run.phase === 'paused' && <button type="button" className="primary-button" disabled={busy || run.model_calls >= run.max_steps || run.stop_reason === 'TIME_LIMIT_REACHED' || ((run.review_required || run.stop_reason === 'COMPLETION_REVIEW_REQUIRED') && !guidance.trim())} onClick={() => void continueRun()}>Continue one step</button>}<button type="button" className="secondary-button" disabled={busy} onClick={() => void stop()}>Stop run</button></div>}
      {run.final_text && <div className="agent-final"><strong>Agent response</strong><pre>{run.final_text}</pre></div>}
      {(run.revisions ?? []).length > 0 && <details className="agent-log"><summary>Retained file revisions · {run.revisions.length}</summary>{run.revisions.map((revision, i) => <details key={i}><summary>{revision.path} · {revision.created_at}</summary><p>Prior content (reference for a separately approved restore)</p><pre>{revision.before_text ?? '(new file)'}</pre><p>Approved content</p><pre>{revision.after_text}</pre></details>)}</details>}
      <details className="agent-log" open><summary>Action log · {eventCount} events</summary><ol>{run.events.map((event) => <li key={event.sequence}><div><strong>{event.actor} · {event.operation}</strong>{event.target && <code>{event.target}</code>}<span className={`agent-decision ${event.decision}`}>{event.decision.replaceAll('_', ' ')}</span></div><p>{event.summary}</p>{event.details && <details><summary>View file/tool detail</summary><pre>{event.details}</pre></details>}</li>)}</ol></details>
    </section>}
  </section>;
}
