import { useEffect, useMemo, useRef, useState } from 'react';
import { agentApi } from './api/client';
import './agent-reliability.css';
import type { AgentCapabilities, AgentCompletionCheck, AgentRun, AgentStartRequest } from './api/types';

const lines = (value: string) => Array.from(new Set(value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)));

export default function AgentDashboard({ initialRunId, onOpenProviderSettings }: { initialRunId: string | null; onOpenProviderSettings?: () => void }) {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [type, setType] = useState<'write' | 'code'>('code');
  const [instruction, setInstruction] = useState('');
  const [readPaths, setReadPaths] = useState('');
  const [writePaths, setWritePaths] = useState('');
  const [maxSteps, setMaxSteps] = useState('8');
  const [completionChecks, setCompletionChecks] = useState<AgentCompletionCheck[]>([]);
  const nextCheckId = useRef(1);
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

  const maxCalls = Number(maxSteps);
  const canStart = Boolean(capabilities?.enabled && instruction.trim() && confirmProvider
    && (lines(readPaths).length > 0 || lines(writePaths).length > 0)
    && Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= (capabilities?.max_steps ?? 20)
    && completionChecks.every((check) => lines(writePaths).includes(check.path)
      && (check.kind !== 'contains_text' || Boolean(check.expected_text?.trim()))));
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
      read_paths: lines(readPaths), write_paths: lines(writePaths), max_steps: maxCalls, completion_checks: completionChecks,
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
    try { setRun(await agentApi.continue(run.run_id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not continue the workspace run.'); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    if (!run || busy) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.stop(run.run_id)); updateUrl(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop the workspace run.'); }
    finally { setBusy(false); }
  };

  const updateCheck = (index: number, patch: Partial<AgentCompletionCheck>) => {
    setCompletionChecks((checks) => checks.map((check, i) => i === index ? { ...check, ...patch } : check));
  };
  const addCheck = () => {
    const paths = lines(writePaths);
    if (!paths.length || completionChecks.length >= 10) return;
    const checkId = `check-${nextCheckId.current++}`;
    setCompletionChecks((checks) => [...checks, {
      check_id: checkId, kind: 'file_exists', path: paths[0], expected_text: null,
    }]);
  };

  return <section className="agent-dashboard panel" aria-labelledby="agent-title">
    <div className="agent-heading"><div><span className="section-kicker">BOUNDED WORKSPACE AGENT</span><h1 id="agent-title">Writing and code with permission checks</h1><p>Model-generated changes stay proposals until you approve each exact file operation.</p></div><span className={`agent-status-pill ${capabilities?.enabled ? 'enabled' : ''}`}>{capabilities?.enabled ? `WORKSPACE · ${capabilities.workspace_name}` : 'DISABLED'}</span></div>
    {loading && <p role="status">Checking backend agent capability…</p>}
    {capabilities && !capabilities.enabled && <div className="agent-warning" role="status">{capabilities.disabled_reason}{onOpenProviderSettings && <> <button className="inline-settings-link" type="button" onClick={onOpenProviderSettings}>Provider setup</button></>}</div>}
    <div className="agent-safety-note"><strong>Safety boundary:</strong> this prototype can only read or write exact paths you list below, and each operation needs approval. Shell commands, network tools, deletes, deployments, git operations, and permissions changes are not available. Code is not executed or tested.</div>
    <div className="agent-form">
      <label>Task type<select value={type} onChange={(event) => setType(event.target.value as 'write' | 'code')} disabled={!capabilities?.enabled || busy}><option value="code">Code generation/edit</option><option value="write">Writing</option></select></label>
      <label>What should the agent do?<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={5000} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} placeholder="Describe one bounded writing or code task." /></label>
      <label>Allowed read paths <span>One exact workspace-relative path per line</span><textarea value={readPaths} onChange={(event) => setReadPaths(event.target.value)} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} placeholder={'frontend/src/App.tsx\nREADME.md'} /></label>
      <label>Allowed write paths <span>One exact workspace-relative path per line</span><textarea value={writePaths} onChange={(event) => setWritePaths(event.target.value)} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} placeholder="frontend/src/AgentDashboard.tsx" /></label>
      <label>Maximum model calls <input type="number" min={1} max={capabilities?.max_steps ?? 20} value={maxSteps} onChange={(event) => setMaxSteps(event.target.value)} onBlur={() => setMaxSteps(String(Math.max(1, Math.min(capabilities?.max_steps ?? 20, Number(maxSteps) || 1))))} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} /></label>
      <fieldset className="agent-completion-checks" disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')}>
        <legend>Independent completion checks <span>(optional, up to 10)</span></legend>
        <p>Checks verify file state or format, not answer meaning. EcoAgent does not run generated code.</p>
        {completionChecks.map((check, index) => <div className="agent-check-row" key={check.check_id}>
          <label>Check type<select value={check.kind} onChange={(event) => {
            const kind = event.target.value as AgentCompletionCheck['kind'];
            updateCheck(index, { kind, expected_text: kind === 'contains_text' ? '' : null });
          }}>
            <option value="file_exists">File exists</option><option value="file_changed">File changed</option>
            <option value="contains_text">Contains exact text</option><option value="valid_json">Valid JSON</option>
          </select></label>
          <label>Output path<select value={check.path} onChange={(event) => updateCheck(index, { path: event.target.value })}>{lines(writePaths).map((path) => <option key={path} value={path}>{path}</option>)}</select></label>
          {check.kind === 'contains_text' && <label>Required literal text<input value={check.expected_text ?? ''} maxLength={500} onChange={(event) => updateCheck(index, { expected_text: event.target.value })} /></label>}
          <button type="button" className="text-button" aria-label={`Remove ${check.check_id}`} onClick={() => setCompletionChecks((checks) => checks.filter((_, i) => i !== index))}>Remove check</button>
        </div>)}
        <button type="button" className="secondary-button" disabled={!lines(writePaths).length || completionChecks.length >= 10} onClick={addCheck}>Add completion check</button>
      </fieldset>
      <label className="agent-consent"><input type="checkbox" checked={confirmProvider} onChange={(event) => setConfirmProvider(event.target.checked)} disabled={!capabilities?.enabled || busy || Boolean(run && run.status === 'running')} /><span>I confirm the instruction and any approved file contents may be sent to the backend-configured model provider.</span></label>
      <button type="button" className="primary-button" disabled={!canStart || busy || Boolean(run && run.status === 'running')} onClick={() => void start()}>{busy ? 'Working…' : 'Start bounded run'}</button>
    </div>

    {error && <div className="agent-warning" role="alert">{error}<button type="button" className="text-button" onClick={() => run && void agentApi.get(run.run_id).then(setRun).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Retry failed.'))}>Retry</button></div>}
    {notice && <p className="agent-notice" role="status">{notice}</p>}
    {run && <section className="agent-run" aria-label="Workspace run status"><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Workspace agent status: {run.status.replaceAll('_', ' ')}. {run.model_calls} of {run.max_steps} model calls used.</p>
      <div className="agent-run-head"><div><strong>{run.task_type === 'code' ? 'Code task' : 'Writing task'}</strong><span>{run.workspace_name} · {run.model_calls}/{run.max_steps} model calls ({Math.max(0, run.max_steps - run.model_calls)} remaining) · {run.steps_completed} file operations completed</span><span>Checkpoint {run.checkpoint_sequence} · saved {new Date(run.checkpoint_at).toLocaleString()}</span></div><span className={`status-badge ${run.status}`}>{run.phase.replaceAll('_', ' ')}</span></div>
      <p className={`agent-verification ${run.verification_status}`}><strong>Completion:</strong> {run.verification_status === 'verified' ? 'Independent checks passed.' : run.verification_status === 'pending' ? 'Independent checks are configured and will run when the agent reports completion.' : run.verification_status === 'failed' ? 'Checks did not pass; review and continue or stop.' : 'No independent completion checks were requested; the agent response is not independently verified.'}</p>
      {run.completion_check_results.length > 0 && <ul className="agent-check-results">{run.completion_check_results.map((check) => <li key={check.check_id}><strong>{check.status.replaceAll('_', ' ')}</strong> · <code>{check.path}</code> — {check.message}</li>)}</ul>}
      {run.stop_reason && run.phase === 'paused' && <p className="agent-warning">Paused: {run.stop_reason.replaceAll('_', ' ').toLowerCase()}. Review the log before continuing.</p>}
      {run.stop_reason === 'STEP_LIMIT_REACHED' && <p className="agent-warning">Configured step limit reached. Start a new bounded run for additional work.</p>}
      {run.stop_reason === 'REPEATED_PROVIDER_FAILURE' && <p className="agent-warning">The same provider or response failure repeated three times. This run stopped; review the failure and adjust the task before starting another run.</p>}
      {pending && <div className="agent-pending panel"><span className="section-kicker">PENDING YOUR APPROVAL</span><h2>{pending.operation.replace('_', ' ')} · <code>{pending.path}</code></h2><p>{pending.summary}</p>
        {pending.operation === 'write_file' && <><div className="agent-preview-grid"><div><strong>Current file</strong><pre tabIndex={0} aria-label="Current file preview">{pending.before_text ?? '(new file)'}</pre></div><div><strong>Proposed content</strong><pre tabIndex={0} aria-label="Proposed file content">{pending.content}</pre></div></div><p>Base SHA-256: {pending.base_sha256 ?? 'New file'} · The backend rejects the write if the file changes before approval.</p></>}
        {pending.operation === 'read_file' && <p>Preview: <code>{pending.before_text?.slice(0, 500) ?? ''}{(pending.before_text?.length ?? 0) > 500 ? '…' : ''}</code></p>}
        <div className="agent-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void decide(true)}>Approve this exact action</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void decide(false)}>Deny</button></div>
      </div>}
      {!pending && run.status === 'running' && <div className="agent-actions">{run.phase === 'paused' && run.model_calls < run.max_steps && <button type="button" className="primary-button" disabled={busy} onClick={() => void continueRun()}>Continue one step</button>}<button type="button" className="secondary-button" disabled={busy} onClick={() => void stop()}>Stop run</button></div>}
      {run.final_text && <div className="agent-final"><strong>Agent response</strong><pre tabIndex={0} aria-label="Workspace agent response">{run.final_text}</pre></div>}
      <details className="agent-log" open><summary>Action log · {eventCount} events</summary><ol>{run.events.map((event) => <li key={event.sequence}><div><strong>{event.actor} · {event.operation}</strong>{event.target && <code>{event.target}</code>}<span className={`agent-decision ${event.decision}`}>{event.decision.replaceAll('_', ' ')}</span></div><p>{event.summary}</p>{event.details && <details><summary>View file/tool detail</summary><pre tabIndex={0} aria-label={`Details for action ${event.sequence}`}>{event.details}</pre></details>}</li>)}</ol></details>
    </section>}
  </section>;
}
