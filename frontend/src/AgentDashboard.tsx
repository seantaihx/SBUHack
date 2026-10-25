import { useEffect, useMemo, useRef, useState } from 'react';
import { agentApi, ApiError } from './api/client';
import './agent-reliability.css';
import type { AgentCapabilities, AgentCompletionCheck, AgentRun, AgentStartRequest, AgentWorkflowStartRequest } from './api/types';

const lines = (value: string) => Array.from(new Set(value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)));

export default function AgentDashboard({ initialRunId, onOpenProviderSettings, onOpenActiveRun }: {
  initialRunId: string | null; onOpenProviderSettings?: () => void; onOpenActiveRun?: (id: string) => void;
}) {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [mode, setMode] = useState<'single' | 'team'>('single');
  const [type, setType] = useState<'write' | 'code'>('code');
  const [instruction, setInstruction] = useState('');
  const [readPaths, setReadPaths] = useState('');
  const [writePaths, setWritePaths] = useState('');
  const [maxSteps, setMaxSteps] = useState('8');
  const [maxTasks, setMaxTasks] = useState('5');
  const [maxTaskCalls, setMaxTaskCalls] = useState('4');
  const [maxRuntime, setMaxRuntime] = useState('1800');
  const [completionChecks, setCompletionChecks] = useState<AgentCompletionCheck[]>([]);
  const nextCheckId = useRef(1);
  const [confirmProvider, setConfirmProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [handoffCopied, setHandoffCopied] = useState(false);

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
    && (mode !== 'team' || (lines(writePaths).length > 0 && Number.isInteger(Number(maxTasks))
      && Number(maxTasks) >= 1 && Number(maxTasks) <= (capabilities?.max_workflow_tasks ?? 8)
      && Number.isInteger(Number(maxTaskCalls)) && Number(maxTaskCalls) >= 1 && Number(maxTaskCalls) <= (capabilities?.max_task_calls ?? 8)
      && Number.isInteger(Number(maxRuntime)) && Number(maxRuntime) >= 60 && Number(maxRuntime) <= (capabilities?.max_runtime_seconds ?? 7200)
      && maxCalls >= 4))
    && completionChecks.every((check) => lines(writePaths).includes(check.path)
      && (check.kind !== 'contains_text' || Boolean(check.expected_text?.trim()))));
  const pending = run?.pending_action ?? null;
  const runActive = run !== null && (run.status === 'queued' || run.status === 'running');
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
    try {
      let created: AgentRun;
      if (mode === 'team') {
        const payload: AgentWorkflowStartRequest = {
          instruction: instruction.trim(), confirm_provider_submission: true,
          read_paths: lines(readPaths), write_paths: lines(writePaths), max_steps: maxCalls,
          max_tasks: Number(maxTasks), max_task_calls: Number(maxTaskCalls),
          max_runtime_seconds: Number(maxRuntime), completion_checks: completionChecks,
        };
        created = await agentApi.startWorkflow(payload);
        setNotice('Manager is preparing a bounded plan. No specialist action or file change runs before plan and action approvals.');
      } else {
        const payload: AgentStartRequest = {
          task_type: type, instruction: instruction.trim(), confirm_provider_submission: true,
          read_paths: lines(readPaths), write_paths: lines(writePaths), max_steps: maxCalls, completion_checks: completionChecks,
        };
        created = await agentApi.start(payload);
        setNotice('Agent plan started. No file operation runs before you approve it.');
      }
      setRun(created); updateUrl(created.run_id);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.code === 'RUN_ALREADY_ACTIVE') {
        const activeRunId = reason.details?.active_run_id;
        const activeRunKind = reason.details?.active_run_kind;
        if (typeof activeRunId === 'string' && activeRunKind === 'agent') {
          try {
            const activeRun = await agentApi.get(activeRunId);
            setRun(activeRun);
            setInstruction(activeRun.instruction);
            updateUrl(activeRunId);
            onOpenActiveRun?.(activeRunId);
            setNotice('An existing Workspace Agent run was reopened. Review its status and checkpoint, then continue or stop it.');
            setError(null);
          } catch (loadReason) {
            setError(`A Workspace Agent run is active, but its status could not be reloaded: ${loadReason instanceof Error ? loadReason.message : 'Request failed.'}`);
          }
        } else if (activeRunKind === 'comparison' || activeRunKind === 'benchmark') {
          const pageName = activeRunKind === 'comparison' ? 'Compare' : 'Benchmarks';
          setError(`${reason.message} Review or stop the active run on the ${pageName} page before starting a Workspace Agent task.`);
        } else {
          setError(`${reason.message} The backend did not identify the active run type, so it could not be reopened safely.`);
        }
      } else {
        setError(reason instanceof Error ? reason.message : 'Could not start the workspace run.');
      }
    } finally { setBusy(false); }
  };

  const approvePlan = async (approved: boolean) => {
    if (!run?.plan_hash || busy) return;
    setBusy(true); setError(null);
    try { setRun(await agentApi.approvePlan(run.run_id, run.plan_hash, approved)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record the workflow plan decision.'); }
    finally { setBusy(false); }
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
    try {
      setRun(await agentApi.stop(run.run_id));
      setNotice('Run stopped. No further agent calls will be made; its checkpoint and activity log remain available.');
    }
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
  const activeWorkflowTask = run?.workflow_tasks.find((task) => task.task_id === run.active_task_id) ?? null;
  const copyHandoff = async () => {
    if (!run?.handoff) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(run.handoff, null, 2));
      setHandoffCopied(true);
      window.setTimeout(() => setHandoffCopied(false), 1800);
    } catch {
      setError('Could not copy the handoff. Select and copy its JSON instead.');
    }
  };

  return <section className="agent-dashboard panel" aria-labelledby="agent-title">
    <div className="agent-heading"><div><span className="section-kicker">BOUNDED WORKSPACE AGENT</span><h1 id="agent-title">Writing and code with permission checks</h1><p>Model-generated changes stay proposals until you approve each exact file operation.</p></div><span className={`agent-status-pill ${capabilities?.enabled ? 'enabled' : ''}`}>{capabilities?.enabled ? `WORKSPACE · ${capabilities.workspace_name}` : 'DISABLED'}</span></div>
    {loading && <p role="status">Checking backend agent capability…</p>}
    {capabilities && !capabilities.enabled && <div className="agent-warning" role="status">{capabilities.disabled_reason}{onOpenProviderSettings && <> <button className="inline-settings-link" type="button" onClick={onOpenProviderSettings}>Provider setup</button></>}</div>}
    <div className="agent-safety-note"><strong>Safety boundary:</strong> every worker stays inside the exact paths you allow. Each file operation needs separate approval. Team tasks run one at a time; this prototype has no shell, network, delete, deployment, git, or code-execution tools.</div>
    <div className="agent-mode-switch" role="group" aria-label="Workspace run mode">
      <button type="button" aria-pressed={mode === 'single'} onClick={() => setMode('single')} disabled={busy || runActive}>Single agent</button>
      <button type="button" aria-pressed={mode === 'team'} onClick={() => setMode('team')} disabled={!capabilities?.team_workflows_enabled || busy || runActive}>Manager + specialists</button>
    </div>
    {mode === 'team' && <p className="agent-team-note"><strong>How the team works:</strong> the Manager creates a reviewable plan. After you approve it, Writer, Coder, and Reviewer roles use their backend-configured models from the priced allowlist. Each hosted provider uses its own backend-held key; Ollama uses the configured local server. Tasks are serialized, never presented as parallel work. Each read/write still requires your approval.</p>}
    <div className="agent-form">
      {mode === 'single' && <label>Task type<select value={type} onChange={(event) => setType(event.target.value as 'write' | 'code')} disabled={!capabilities?.enabled || busy}><option value="code">Code generation/edit</option><option value="write">Writing</option></select></label>}
      <label>{mode === 'team' ? 'What outcome should the Manager coordinate?' : 'What should the agent do?'}<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={5000} disabled={!capabilities?.enabled || busy || runActive} placeholder={mode === 'team' ? 'Describe the overall writing or coding outcome and how you will judge it.' : 'Describe one bounded writing or code task.'} /></label>
      <label>Allowed read paths <span>One exact workspace-relative path per line</span><textarea value={readPaths} onChange={(event) => setReadPaths(event.target.value)} disabled={!capabilities?.enabled || busy || runActive} placeholder={'frontend/src/App.tsx\nREADME.md'} /></label>
      <label>Allowed write paths <span>One exact workspace-relative path per line</span><textarea value={writePaths} onChange={(event) => setWritePaths(event.target.value)} disabled={!capabilities?.enabled || busy || runActive} placeholder="frontend/src/AgentDashboard.tsx" /></label>
      {mode === 'team' && <label>Maximum specialist tasks <input type="number" min={1} max={capabilities?.max_workflow_tasks ?? 8} step={1} value={maxTasks} onChange={(event) => setMaxTasks(event.target.value)} disabled={busy || runActive} /></label>}
      {mode === 'team' && <label>Maximum model calls per specialist <input type="number" min={1} max={capabilities?.max_task_calls ?? 8} step={1} value={maxTaskCalls} onChange={(event) => setMaxTaskCalls(event.target.value)} disabled={busy || runActive} /></label>}
      {mode === 'team' && <label>Workflow time limit <select value={maxRuntime} onChange={(event) => setMaxRuntime(event.target.value)} disabled={busy || runActive}><option value="900">15 minutes</option><option value="1800">30 minutes</option><option value="3600">1 hour</option><option value="7200">2 hours</option></select></label>}
      <label>Maximum model calls <span>{mode === 'team' ? 'Shared by manager planning, all specialists, and final review' : 'Hard limit for this run'}</span><input type="number" min={mode === 'team' ? 4 : 1} max={capabilities?.max_steps ?? 20} step={1} value={maxSteps} onChange={(event) => setMaxSteps(event.target.value)} onBlur={() => setMaxSteps(String(Math.max(mode === 'team' ? 4 : 1, Math.min(capabilities?.max_steps ?? 20, Number(maxSteps) || (mode === 'team' ? 4 : 1)))))} disabled={!capabilities?.enabled || busy || runActive} /></label>
      <fieldset className="agent-completion-checks" disabled={!capabilities?.enabled || busy || runActive}>
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
      <label className="agent-consent"><input type="checkbox" checked={confirmProvider} onChange={(event) => setConfirmProvider(event.target.checked)} disabled={!capabilities?.enabled || busy || runActive} /><span>I confirm the instruction and any approved file contents may be sent to the backend-configured model provider.</span></label>
      <button type="button" className="primary-button" disabled={!canStart || busy || runActive} onClick={() => void start()}>{busy ? 'Working…' : mode === 'team' ? 'Ask Manager for a plan' : 'Start bounded run'}</button>
    </div>

    {error && <div className="agent-warning" role="alert">{error}<button type="button" className="text-button" onClick={() => run && void agentApi.get(run.run_id).then(setRun).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Retry failed.'))}>Retry</button></div>}
    {notice && <p className="agent-notice" role="status">{notice}</p>}
    {run && <section className="agent-run" aria-label="Workspace run status"><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Workspace agent status: {run.status.replaceAll('_', ' ')}. {run.model_calls} model calls used out of a maximum {run.max_steps}.</p>
      <div className="agent-run-head"><div><strong>{run.run_mode === 'team' ? 'Manager-led team workflow' : run.task_type === 'code' ? 'Code task' : 'Writing task'}</strong><span>{run.workspace_name} · {run.model_calls} model calls used (limit {run.max_steps}; {Math.max(0, run.max_steps - run.model_calls)} remaining) · {run.steps_completed} file operations completed</span><span>{run.run_mode === 'team' ? 'Role-specific models are shown for each manager and task · one specialist runs at a time' : `Model: ${run.agent_model_id ?? 'Unavailable'}`}</span><span>Checkpoint {run.checkpoint_sequence} · saved {new Date(run.checkpoint_at).toLocaleString()}</span></div><div className="agent-run-controls"><span className={`status-badge ${run.status}`}>{run.status === 'cancelled' ? 'stopped' : run.phase.replaceAll('_', ' ')}</span>{runActive && <button type="button" className="agent-stop-button" disabled={busy} onClick={() => void stop()}>{busy ? 'Stopping…' : 'Stop run'}</button>}</div></div>
      {run.status === 'cancelled' && <p className="agent-notice" role="status">This run was stopped. No more agent calls will be made. Its checkpoint and activity log are still available.</p>}
      {run.run_mode === 'team' && <>
        <section className="workflow-manager" aria-labelledby="workflow-manager-title">
          <div className="workflow-manager-mark" aria-hidden="true">M</div>
          <div className="workflow-manager-copy"><span className="section-kicker">MANAGER · ORCHESTRATION</span><h2 id="workflow-manager-title">{run.manager_summary ?? 'Preparing a scoped task plan'}</h2><p>{run.workflow_stage === 'planning' ? 'Planning one bounded workflow call…' : run.workflow_stage === 'plan_review' ? 'Plan ready for your review. No specialist task has started.' : run.workflow_stage === 'executing' ? activeWorkflowTask ? `Assigning work to ${activeWorkflowTask.agent_name} · ${activeWorkflowTask.role}` : 'Selecting the next task from approved dependencies.' : run.workflow_stage === 'reviewing' ? 'Checking specialist results and completion evidence.' : run.workflow_stage === 'completed' ? 'All planned tasks and manager review are complete.' : 'Workflow stopped; review the handoff for remaining work.'}</p><div className="workflow-task-meta"><span>Manager model: {run.role_model_ids?.manager ?? run.agent_model_id ?? 'Unavailable'}</span><span>Configured Writer: {run.role_model_ids?.writer ?? 'Unavailable'}</span><span>Configured Coder: {run.role_model_ids?.coder ?? 'Unavailable'}</span><span>Reviewer task model (if assigned): {run.role_model_ids?.reviewer ?? 'Unavailable'}</span><span>Manager model calls: {run.manager_model_calls} · limit {run.max_task_calls} · retries {run.manager_retry_count}</span><span>Manager tokens: {run.manager_input_tokens === null || run.manager_output_tokens === null ? 'Unavailable' : `${run.manager_input_tokens + run.manager_output_tokens} reported / ${run.max_tokens_per_task}`} · {run.manager_reserved_output_tokens} output tokens reserved</span><span>Manager cost: {run.manager_estimated_cost_usd === null ? 'Unavailable' : `$${run.manager_estimated_cost_usd.toFixed(6)} estimate`}</span><span>Deadline: {run.workflow_deadline_at ? new Date(run.workflow_deadline_at).toLocaleString() : 'Unavailable'}</span></div></div>
        </section>
        <div className="workflow-budget" aria-label="Workflow usage and limits">
          <div><span>Model-call budget</span><strong>{run.model_calls} / {run.max_steps}</strong><small>Shared total · {run.max_task_calls} calls per specialist</small></div>
          <div><span>Workflow token usage</span><strong>{run.input_tokens === null || run.output_tokens === null ? 'Unavailable' : `${run.input_tokens + run.output_tokens} reported / ${run.max_tokens_per_run}`}</strong><small>{run.usage_reported_calls} of {run.model_calls} calls returned complete usage · {run.reserved_output_tokens} output tokens reserved when usage is missing</small></div>
          <div><span>Estimated provider cost</span><strong>{run.estimated_cost_usd === null ? 'Unavailable' : `$${run.estimated_cost_usd.toFixed(6)}`}</strong><small>Estimate · run cap {run.max_run_cost_usd === null ? 'Unavailable' : `$${run.max_run_cost_usd.toFixed(2)}`} · task cap {run.max_task_cost_usd === null ? 'Unavailable' : `$${run.max_task_cost_usd.toFixed(2)}`}</small></div>
          <div><span>Carbon estimate</span><strong>Unavailable</strong><small>Agent energy is not measured or estimated</small></div>
        </div>
        {run.workflow_tasks.length > 0 && <section className="workflow-board" aria-label="Manager and specialist task flow">
          <div className="workflow-board-head"><div><span className="section-kicker">SPECIALIST WORKFLOW</span><h2>{run.workflow_tasks.filter((task) => task.status === 'completed').length} of {run.workflow_tasks.length} tasks completed</h2></div><span className="workflow-serial-label">SERIAL EXECUTION · NO PARALLEL CLAIMS</span></div>
          <div className="workflow-manager-node"><span aria-hidden="true">M</span><div><strong>Manager · plan owner</strong><span>{run.plan_approved ? 'Plan approved by you' : 'Plan awaiting your approval'} · {run.role_model_ids?.manager ?? 'Model unavailable'}</span></div></div>
          <ol className="workflow-task-list">{run.workflow_tasks.map((task, index) => <li className={`workflow-task ${task.status}`} key={task.task_id}>
            <span className="workflow-task-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div className="workflow-task-main"><div className="workflow-task-title"><div><strong>{task.title}</strong><span>{task.agent_name} · {task.role}</span></div><span className={`status-badge ${task.status}`}>{task.status.replaceAll('_', ' ')}</span></div>
              {task.depends_on.length > 0 ? <p className="workflow-dependencies">Waits for: {task.depends_on.map((id) => run.workflow_tasks.find((candidate) => candidate.task_id === id)?.title ?? id).join(', ')}</p> : <p className="workflow-dependencies">No task dependency · eligible after you approve the plan</p>}
              <ul className="workflow-criteria">{task.success_criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
              <div className="workflow-task-meta"><span>Model: {task.model_id ?? run.role_model_ids?.[task.role] ?? 'Unavailable'}</span><span>{task.model_calls} / {task.max_model_calls} model calls · {task.retry_count} retries</span><span>{task.steps_completed} approved file operations</span><span>Tokens: {task.input_tokens === null || task.output_tokens === null ? 'Unavailable' : `${task.input_tokens + task.output_tokens} reported / ${task.max_tokens}`}</span><span>{task.reserved_output_tokens} output tokens reserved</span><span>Cost: {task.estimated_cost_usd === null ? 'Unavailable' : `$${task.estimated_cost_usd.toFixed(6)} estimate`}</span></div>
              <details className="workflow-assignment"><summary>Review assignment and permitted paths</summary><p><strong>Task instruction</strong></p><p>{task.instruction}</p><div className="workflow-assignment-paths"><div><strong>Allowed reads</strong><span>{task.read_paths.length ? task.read_paths.join(', ') : 'None'}</span></div><div><strong>Allowed writes</strong><span>{task.write_paths.length ? task.write_paths.join(', ') : 'None'}</span></div></div></details>
              {task.result_summary && <p className="workflow-result-summary">{task.result_summary}</p>}
              {task.final_text && <details className="workflow-task-output"><summary>View {task.agent_name} output</summary><pre tabIndex={0} aria-label={`${task.agent_name} final output`}>{task.final_text}</pre></details>}
              {task.stop_reason && <p className="agent-warning">{task.stop_reason.replaceAll('_', ' ').toLowerCase()}</p>}
            </div>
          </li>)}</ol>
        </section>}
        {run.phase === 'awaiting_plan_approval' && run.plan_hash && <section className="workflow-plan-approval" aria-labelledby="workflow-plan-title">
          <span className="section-kicker">PLAN REVIEW · NO TASK ACTIONS HAVE RUN</span><h2 id="workflow-plan-title">Approve this manager plan?</h2>
          <p>The plan is limited to your allowed paths and the shared model-call budget. Approving the plan does not approve any file read or write.</p>
          <div className="agent-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void approvePlan(true)}>Approve workflow plan</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void approvePlan(false)}>Decline plan</button></div>
        </section>}
        {run.manager_open_items.length > 0 && <section className="workflow-open-items"><strong>Manager review found open items</strong><ul>{run.manager_open_items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>}
        {run.handoff && <details className="workflow-handoff" open={run.status !== 'running' || run.phase === 'paused' || run.phase === 'awaiting_plan_approval'}>
          <summary>Durable handoff · updated {new Date(run.handoff.updated_at).toLocaleString()}</summary>
          <p><strong>Task summary:</strong> {run.handoff.original_task_summary}</p><p>{run.handoff.summary}</p>
          {run.handoff.role_model_ids && Object.keys(run.handoff.role_model_ids).length > 0 && <p className="handoff-measurement-note">Role model assignments: {Object.entries(run.handoff.role_model_ids).map(([role, model]) => `${role} · ${model}`).join(' | ')}</p>}
          <div className="handoff-summary-grid"><div><strong>Tasks</strong><span>{run.handoff.completed_task_ids.length} completed · {run.handoff.remaining_task_ids.length} remaining · {run.handoff.blocked_task_ids.length} blocked</span></div><div><strong>Files read</strong><span>{run.handoff.files_read.length ? run.handoff.files_read.join(', ') : 'None recorded'}</span></div><div><strong>Files changed</strong><span>{run.handoff.files_changed.length ? run.handoff.files_changed.join(', ') : 'None recorded'}</span></div><div><strong>Next steps</strong><span>{run.handoff.next_steps.join(' ')}</span></div></div>
          {run.handoff.tasks && run.handoff.tasks.length > 0 && <details className="handoff-tasks"><summary>Task details and outcomes · {run.handoff.tasks.length}</summary><ol>{run.handoff.tasks.map((task) => <li key={task.task_id}><strong>{task.title}</strong><span>{task.agent_name} · {task.role} · {task.status.replaceAll('_', ' ')} · {task.model_id ?? 'Model unavailable'}</span>{task.instruction_summary && <p>Next-agent context: {task.instruction_summary}</p>}<span>Allowed reads: {task.read_paths?.length ? task.read_paths.join(', ') : 'None'} · allowed writes: {task.write_paths?.length ? task.write_paths.join(', ') : 'None'}</span>{task.result_summary && <p>{task.result_summary}</p>}<span>Calls {task.model_calls}/{task.max_model_calls} · retries {task.retry_count} · tokens {task.input_tokens === null || task.output_tokens === null ? 'Unavailable' : `${task.input_tokens + task.output_tokens} reported`} · cost {task.estimated_cost_usd === null ? 'Unavailable' : `$${task.estimated_cost_usd.toFixed(6)} estimate`}</span>{task.stop_reason && <span>Stop reason: {task.stop_reason.replaceAll('_', ' ').toLowerCase()}</span>}<ul>{task.success_criteria.map((criterion, index) => <li key={`${task.task_id}-criterion-${index}`}>{criterion}</li>)}</ul></li>)}</ol></details>}
          <p className="handoff-measurement-note">Usage counts only calls that returned complete token data ({run.handoff.usage_reported_calls} of {run.handoff.model_calls_used}); {run.handoff.reported_tokens_remaining} tokens remain by reported usage, with {run.handoff.reserved_output_tokens} output tokens reserved where usage was missing. Retries: {run.handoff.retry_count} overall, {run.handoff.manager_retry_count ?? run.manager_retry_count} for the Manager. Cost is an estimate; carbon is {run.handoff.estimated_carbon_g === null ? 'Unavailable' : `${run.handoff.estimated_carbon_g} g estimate`}.</p>
          {run.handoff.actions.length > 0 && <details><summary>Recorded actions · {run.handoff.actions.length}</summary><ol>{run.handoff.actions.map((action) => <li key={action.sequence}>{action.agent_name ?? action.actor}{action.model_id ? ` · ${action.model_id}` : ''} · {action.operation} · {action.target ?? 'workflow'} · {action.decision.replaceAll('_', ' ')} — {action.summary}</li>)}</ol></details>}
          <button type="button" className="secondary-button" onClick={() => void copyHandoff()}>{handoffCopied ? 'Handoff copied' : 'Copy handoff JSON'}</button>
          <details><summary>View structured handoff JSON</summary><pre tabIndex={0} aria-label="Structured workflow handoff">{JSON.stringify(run.handoff, null, 2)}</pre></details>
        </details>}
      </>}
      {run.run_mode === 'single' && run.handoff && <details className="workflow-handoff" open={run.status !== 'running' || run.phase === 'paused'}>
        <summary>Handoff for next agent · updated {new Date(run.handoff.updated_at).toLocaleString()}</summary>
        <p><strong>Task:</strong> {run.handoff.original_task_summary}</p><p>{run.handoff.summary}</p>
        <div className="handoff-summary-grid"><div><strong>Task status</strong><span>{run.handoff.completed_task_ids.length ? 'Completed' : run.handoff.blocked_task_ids.length ? 'Blocked' : run.handoff.remaining_task_ids.length ? 'In progress' : 'Stopped or failed'}</span></div><div><strong>Model and calls</strong><span>{run.handoff.model_id ?? 'Unavailable'} · {run.handoff.model_calls_used} used · {run.handoff.model_calls_remaining} remaining</span></div><div><strong>Files read</strong><span>{run.handoff.files_read.length ? run.handoff.files_read.join(', ') : 'None recorded'}</span></div><div><strong>Files changed</strong><span>{run.handoff.files_changed.length ? run.handoff.files_changed.join(', ') : 'None recorded'}</span></div><div><strong>Next steps</strong><span>{run.handoff.next_steps.join(' ')}</span></div><div><strong>Stop reason</strong><span>{run.handoff.stop_reason?.replaceAll('_', ' ').toLowerCase() ?? 'None'}</span></div></div>
        <p className="handoff-measurement-note">Usage: {run.handoff.input_tokens === null || run.handoff.output_tokens === null ? 'Unavailable' : `${run.handoff.input_tokens + run.handoff.output_tokens} provider-reported tokens`} · cost: {run.handoff.estimated_cost_usd === null ? 'Unavailable' : `$${run.handoff.estimated_cost_usd.toFixed(6)} estimate`} · agent carbon: Unavailable. Output text and file contents are excluded.</p>
        {run.handoff.actions.length > 0 && <details><summary>Recorded actions · {run.handoff.actions.length}</summary><ol>{run.handoff.actions.map((action) => <li key={action.sequence}>{action.agent_name ?? action.actor}{action.model_id ? ` · ${action.model_id}` : ''} · {action.operation} · {action.target ?? 'workspace task'} · {action.decision.replaceAll('_', ' ')} — {action.summary}</li>)}</ol></details>}
        <button type="button" className="secondary-button" onClick={() => void copyHandoff()}>{handoffCopied ? 'Handoff copied' : 'Copy handoff JSON'}</button>
        <details><summary>View structured handoff JSON</summary><pre tabIndex={0} aria-label="Structured workspace handoff">{JSON.stringify(run.handoff, null, 2)}</pre></details>
      </details>}
      <p className={`agent-verification ${run.verification_status}`}><strong>Completion:</strong> {run.verification_status === 'verified' ? 'Independent checks passed.' : run.verification_status === 'pending' ? 'Independent checks are configured and will run when the agent reports completion.' : run.verification_status === 'failed' ? 'Checks did not pass; review and continue or stop.' : 'No independent completion checks were requested; the agent response is not independently verified.'}</p>
      {run.completion_check_results.length > 0 && <ul className="agent-check-results">{run.completion_check_results.map((check) => <li key={check.check_id}><strong>{check.status.replaceAll('_', ' ')}</strong> · <code>{check.path}</code> — {check.message}</li>)}</ul>}
      {run.stop_reason && run.phase === 'paused' && run.stop_reason !== 'OUTPUT_NOT_WRITTEN' && <p className="agent-warning">Paused: {run.stop_reason.replaceAll('_', ' ').toLowerCase()}. Review the log before continuing.</p>}
      {run.stop_reason === 'OUTPUT_NOT_WRITTEN' && <p className="agent-warning">The model returned text without saving a file. No file was changed. {run.model_calls < run.max_steps ? 'Continue one step to ask it to propose a write to an allowed path, or stop this run.' : 'The model-call limit is used; start a new bounded run if more work is needed.'}</p>}
      {run.stop_reason === 'STEP_LIMIT_REACHED' && <p className="agent-warning">Configured step limit reached. Start a new bounded run for additional work.</p>}
      {run.stop_reason === 'REPEATED_PROVIDER_FAILURE' && <p className="agent-warning">The same provider or response failure repeated three times. This run stopped; review the failure and adjust the task before starting another run.</p>}
      {pending && <div className="agent-pending panel"><span className="section-kicker">PENDING YOUR APPROVAL {pending.agent_name ? `· ${pending.agent_name} / ${pending.agent_role}` : ''}</span><h2>{pending.operation.replace('_', ' ')} · <code>{pending.path}</code></h2><p>{pending.summary}</p>
        {pending.operation === 'write_file' && <><div className="agent-preview-grid"><div><strong>Current file</strong><pre tabIndex={0} aria-label="Current file preview">{pending.before_text ?? '(new file)'}</pre></div><div><strong>Proposed content</strong><pre tabIndex={0} aria-label="Proposed file content">{pending.content}</pre></div></div><p>Base SHA-256: {pending.base_sha256 ?? 'New file'} · The backend rejects the write if the file changes before approval.</p></>}
        {pending.operation === 'read_file' && <p>Preview: <code>{pending.before_text?.slice(0, 500) ?? ''}{(pending.before_text?.length ?? 0) > 500 ? '…' : ''}</code></p>}
        <div className="agent-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void decide(true)}>Approve this exact action</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void decide(false)}>Deny</button></div>
      </div>}
      {!pending && run.status === 'running' && run.phase === 'paused' && run.model_calls < run.max_steps && <div className="agent-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void continueRun()}>Continue one step</button></div>}
      {run.final_text && <div className="agent-final"><strong>Agent response</strong><pre tabIndex={0} aria-label="Workspace agent response">{run.final_text}</pre></div>}
      <details className="agent-log" open><summary>Action log · {eventCount} events</summary><ol>{run.events.map((event) => <li key={event.sequence}><div><strong>{event.agent_name ? `${event.agent_name} · ${event.agent_role}` : event.actor} · {event.operation}</strong>{event.target && <code>{event.target}</code>}{event.model_id && <code>model · {event.model_id}</code>}<span className={`agent-decision ${event.decision}`}>{event.decision.replaceAll('_', ' ')}</span></div><p>{event.summary}</p>{event.details && <details><summary>View file/tool detail</summary><pre tabIndex={0} aria-label={`Details for action ${event.sequence}`}>{event.details}</pre></details>}</li>)}</ol></details>
    </section>}
  </section>;
}
