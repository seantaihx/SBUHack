import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api/client';
import type { AgentRoleModelAssignments, AgentRoleModelSettings, LocalProviderSettings } from './api/types';
import './provider-settings.css';

type Props = { open: boolean; onClose: () => void; onSaved: () => Promise<void> };

export default function ProviderKeySettings({ open, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [settings, setSettings] = useState<LocalProviderSettings | null>(null);
  const [agentModels, setAgentModels] = useState<AgentRoleModelSettings | null>(null);
  const [selectedAgentModels, setSelectedAgentModels] = useState<AgentRoleModelAssignments | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingModels, setSavingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modelMessage, setModelMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState('groq');

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      dialog.querySelector<HTMLInputElement>('#provider-key')?.focus();
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null); setModelError(null); setMessage(null); setModelMessage(null);
    Promise.allSettled([api.localProviderSettings(), api.agentModelSettings()]).then(([providerResult, modelResult]) => {
      if (!active) return;
      if (providerResult.status === 'fulfilled') setSettings(providerResult.value);
      else if (providerResult.reason instanceof ApiError && providerResult.reason.status === 404) {
        setError('This backend does not expose the local provider setup route yet. Restart it from the current branch. The key field stays disabled until setup is available.');
      } else setError(providerResult.reason instanceof Error ? providerResult.reason.message : 'Could not read local provider setup status.');
      if (modelResult.status === 'fulfilled') {
        setAgentModels(modelResult.value);
        setSelectedAgentModels(modelResult.value.saved_models);
      } else if (modelResult.reason instanceof ApiError && modelResult.reason.status === 404) {
        setModelError('Per-role model settings are not available on this backend yet. Restart it from the current branch to load the new settings route.');
      } else setModelError(modelResult.reason instanceof Error ? modelResult.reason.message : 'Could not read agent model assignments.');
    })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || settings?.local_setup_available !== true || settings.environment_override) return;
    dialogRef.current?.querySelector<HTMLInputElement>('#provider-key')?.focus();
  }, [open, settings]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !settings?.local_setup_available) return;
    const data = new FormData(event.currentTarget);
    const key = data.get('provider-key');
    if (typeof key !== 'string' || !key.trim()) { setError(`Enter a ${provider} API key.`); return; }
    const apiKey = key.trim();
    formRef.current?.reset();
    setSaving(true); setError(null); setMessage(null);
    try {
      const result = await api.saveProviderKey(provider, apiKey);
      setSettings(result);
      setMessage('Saved to the backend .env file. Restart the backend to activate the key.');
      try { await onSaved(); }
      catch { setMessage('The key was saved to the backend .env file, but capability status could not refresh. Restart the backend and check Live availability again.'); }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'The key could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveModels = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingModels || !agentModels || !selectedAgentModels || agentModels.environment_override) return;
    setSavingModels(true); setError(null); setModelMessage(null);
    try {
      const result = await api.saveAgentModelSettings(selectedAgentModels);
      setAgentModels(result);
      setSelectedAgentModels(result.saved_models);
      setModelMessage(result.restart_required
        ? 'Model assignments are saved to the backend .env file. Restart the backend to activate them.'
        : 'Model assignments are saved and active.');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Model assignments could not be saved.');
    } finally {
      setSavingModels(false);
    }
  };

  const changeRoleModel = (role: keyof AgentRoleModelAssignments, modelId: string) => {
    setSelectedAgentModels((current) => current ? { ...current, [role]: modelId } : current);
  };

  return <dialog className="provider-settings-dialog" ref={dialogRef} aria-labelledby="provider-settings-title" aria-describedby="provider-settings-description"
    onClose={onClose} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }}>
    <div className="provider-settings-head"><div><span className="section-kicker">LOCAL BACKEND</span><h2 id="provider-settings-title">Provider &amp; agent models</h2></div>
      <button className="settings-close" type="button" onClick={() => dialogRef.current?.close()} aria-label="Close provider settings">Close</button></div>
    <p id="provider-settings-description">Configure hosted provider keys on this computer, then assign a supported provider/model to each Workspace Agent role. Ollama uses a local server and does not need a key.</p>
    <p className="provider-secret-note">The key is briefly present in this password field and the local request memory. EcoAgent does not put it in the frontend build, browser storage, URL, logs, or API response. Do not use this setup screen on a public or shared deployment.</p>
    {loading && <p role="status">Checking backend configuration…</p>}
    {error && <p className="provider-config-error" role="alert">{error}</p>}
    <form ref={formRef} onSubmit={save}>
      <label htmlFor="provider-choice">Provider</label>
      <select id="provider-choice" value={provider} onChange={(event) => setProvider(event.target.value)} disabled={loading || saving}>
        <option value="groq">Groq</option><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="anthropic">Anthropic Claude</option><option value="ollama">Ollama (local)</option>
      </select>
      {provider === 'ollama' ? <p>Ollama runs locally at <code>http://127.0.0.1:11434</code>. Start Ollama and install a model; no cloud key is collected. Ollama usage has no provider token fee, but local electricity use is not measured.</p> : <>
        <label htmlFor="provider-key">{provider === 'gemini' ? 'Google Gemini' : provider === 'anthropic' ? 'Anthropic Claude' : provider[0].toUpperCase() + provider.slice(1)} API key</label>
        <input id="provider-key" name="provider-key" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required maxLength={512} disabled={loading || saving || settings?.local_setup_available !== true || !!settings?.providers?.[provider]?.environment_override} aria-describedby="provider-key-help" />
        <span id="provider-key-help" className="settings-help">Saved only to the backend .env file. It is never returned to this page.</span>
      </>}
      {settings?.providers && <p className="provider-config-status" role="status">{Object.entries(settings.providers).map(([name, state]) => `${name}: ${state.local_only ? 'local server' : state.configured ? state.restart_required ? 'saved; restart needed' : 'configured' : state.saved_in_env ? 'saved; restart needed' : 'key not set'}`).join(' · ')}</p>}
      {message && <p className="provider-config-status" role="status">{message}</p>}
      <div className="provider-settings-actions"><button className="settings-close secondary" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
        {provider !== 'ollama' && <button className="primary-button" type="submit" disabled={loading || saving || settings?.local_setup_available !== true || !!settings?.providers?.[provider]?.environment_override}>{saving ? 'Saving securely…' : 'Save to backend'}</button>}</div>
    </form>
    <section className="agent-model-settings" aria-labelledby="agent-model-settings-title">
      <h3 id="agent-model-settings-title">Workspace Agent model assignments</h3>
      <p>Assign each role independently. Hosted models need that provider’s backend key and account access. Ollama models need a local Ollama server; electricity costs are not included.</p>
      {modelError && <p className="provider-config-error" role="alert">{modelError}</p>}
      {agentModels && <>
        {agentModels.environment_override && <p className="provider-config-warning" role="alert">One or more agent model assignments are set in the backend process environment, so this screen cannot change them.</p>}
        {agentModels.restart_required && <p className="provider-config-warning" role="status">Saved model assignments differ from the models currently loaded by the backend. Restart it to activate the saved choices.</p>}
        {(['manager', 'writer', 'coder', 'reviewer'] as const).map((role) => <label className="agent-model-row" key={role}>
          <span>{role[0].toUpperCase() + role.slice(1)}<small>Currently active: {agentModels.active_models[role]}</small></span>
          <select aria-label={`${role} model`} value={selectedAgentModels?.[role] ?? agentModels.saved_models[role]} onChange={(event) => changeRoleModel(role, event.target.value)} disabled={loading || savingModels || agentModels.environment_override || agentModels.available_models.length === 0}>
            {agentModels.model_options.map((model) => <option key={model.id} value={model.id}>{model.label}{model.local ? ' — local; energy unpriced' : ''}</option>)}
          </select>
        </label>)}
        {modelMessage && <p className="provider-config-status" role="status">{modelMessage}</p>}
        <form onSubmit={saveModels}>
          <button className="primary-button" type="submit" disabled={loading || savingModels || agentModels.environment_override || !selectedAgentModels || agentModels.available_models.length === 0}>{savingModels ? 'Saving assignments…' : 'Save model assignments'}</button>
        </form>
      </>}
    </section>
    <p className="settings-restart-note">Saving does not enable Live or the Workspace Agent. Live also requires backend <code>LIVE_ENABLED=true</code>; the agent additionally requires <code>AGENT_ENABLED=true</code> and a scoped workspace root. Restart after backend configuration changes. Provider calls may incur charges.</p>
  </dialog>;
}
