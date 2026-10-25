import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api/client';
import type { LocalProviderSettings } from './api/types';
import './provider-settings.css';

type Props = { open: boolean; onClose: () => void; onSaved: () => Promise<void> };

export default function ProviderKeySettings({ open, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [settings, setSettings] = useState<LocalProviderSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      dialog.querySelector<HTMLInputElement>('#groq-key')?.focus();
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null); setMessage(null);
    api.localProviderSettings().then((result) => { if (active) setSettings(result); })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 404) {
          setError('This backend does not expose the local provider setup route yet. Restart it from the current branch. The key field stays disabled until the backend confirms setup is available.');
        } else {
          setError(reason instanceof Error ? reason.message : 'Could not read local backend setup status.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || settings?.local_setup_available !== true || settings.environment_override) return;
    dialogRef.current?.querySelector<HTMLInputElement>('#groq-key')?.focus();
  }, [open, settings]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !settings?.local_setup_available) return;
    const data = new FormData(event.currentTarget);
    const key = data.get('groq-key');
    if (typeof key !== 'string' || !key.trim()) { setError('Enter a Groq API key.'); return; }
    const apiKey = key.trim();
    formRef.current?.reset();
    setSaving(true); setError(null); setMessage(null);
    try {
      const result = await api.saveLocalProviderKey(apiKey);
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

  return <dialog className="provider-settings-dialog" ref={dialogRef} aria-labelledby="provider-settings-title" aria-describedby="provider-settings-description"
    onClose={onClose} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }}>
    <div className="provider-settings-head"><div><span className="section-kicker">LOCAL BACKEND</span><h2 id="provider-settings-title">Provider setup</h2></div>
      <button className="settings-close" type="button" onClick={() => dialogRef.current?.close()} aria-label="Close provider settings">Close</button></div>
    <p id="provider-settings-description">Add a Groq key for this local backend. The key is sent directly to the same-computer backend and saved only in its ignored root <code>.env</code> file.</p>
    <p className="provider-secret-note">The key is briefly present in this password field and the local request memory. EcoAgent does not put it in the frontend build, browser storage, URL, logs, or API response. Do not use this setup screen on a public or shared deployment.</p>
    {loading && <p role="status">Checking backend configuration…</p>}
    {settings?.provider_key_configured && <p className="provider-config-status" role="status">A provider key is configured{settings.provider_key_saved_in_env ? ' in the backend .env file' : ' by the backend process'}.</p>}
    {settings?.environment_override && <p className="provider-config-warning" role="alert">The backend process environment overrides .env. Remove or update that backend environment variable before using this setup.</p>}
    {settings?.restart_required && <p className="provider-config-warning" role="status">A restart is required before the backend uses the saved key.</p>}
    {error && <p className="provider-config-error" role="alert">{error}</p>}
    <form ref={formRef} onSubmit={save}>
      <label htmlFor="groq-key">Groq API key</label>
      <input id="groq-key" name="groq-key" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required maxLength={512} disabled={loading || saving || settings?.local_setup_available !== true || !!settings?.environment_override} aria-describedby="groq-key-help" />
      <span id="groq-key-help" className="settings-help">Paste the key from your Groq account. It is never displayed again after saving.</span>
      {message && <p className="provider-config-status" role="status">{message}</p>}
      <div className="provider-settings-actions"><button className="settings-close secondary" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
        <button className="primary-button" type="submit" disabled={loading || saving || settings?.local_setup_available !== true || !!settings?.environment_override}>{saving ? 'Saving securely…' : 'Save to backend'}</button></div>
    </form>
    <p className="settings-restart-note">Saving does not enable Live or the Workspace Agent. Live also requires backend <code>LIVE_ENABLED=true</code>; the agent additionally requires <code>AGENT_ENABLED=true</code> and a scoped workspace root. Restart after backend configuration changes. Provider calls may incur charges.</p>
  </dialog>;
}
