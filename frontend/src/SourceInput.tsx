import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, sourceApi } from './api/client';
import type { SourceMetadata, SourceReference, SourceSnapshot } from './api/types';

type SourceKind = 'none' | 'text' | 'pdf' | 'csv' | 'url';
type Preview = { origin: 'backend' | 'local-draft' | 'fixture'; label: string; content: string; references: SourceReference[]; metadata?: SourceMetadata; snapshot?: SourceSnapshot };
type Fixture = { kind: 'pdf' | 'csv'; label: string; extracted_text: string; references: SourceReference[] };

export default function SourceInput({ fixtureMode, onSourceChange, initialSource = null }: {
  fixtureMode: boolean;
  onSourceChange: (source: SourceSnapshot | null, selected: boolean, confirmed: boolean) => void;
  initialSource?: SourceMetadata | null;
}) {
  const [kind, setKind] = useState<SourceKind>(initialSource?.kind === 'webpage' ? 'url' : initialSource?.kind ?? 'none');
  const [text, setText] = useState('');
  const [url, setUrl] = useState(initialSource?.original_url ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const source = useMemo(() => preview?.snapshot ?? null, [preview]);
  const hasInput = kind !== 'none' && ((kind === 'text' && text.length > 0) || ((kind === 'pdf' || kind === 'csv') && file !== null) || (kind === 'url' && url.trim().length > 0) || preview !== null);

  useEffect(() => { onSourceChange(source, hasInput || initialSource !== null, confirmation && source !== null); }, [source, hasInput, confirmation, initialSource, onSourceChange]);

  useEffect(() => {
    if (!initialSource || fixtureMode) return;
    let active = true;
    setLoading(true);
    sourceApi.get(initialSource.source_id).then(({ source: snapshot }) => {
      if (active) setPreview({ origin: 'backend', label: `${snapshot.name} · restored immutable snapshot`, content: snapshot.extracted_text, references: snapshot.references, metadata: snapshot, snapshot });
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not restore the source snapshot.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialSource?.source_id, fixtureMode]);

  const discardCurrent = () => {
    const id = preview?.metadata?.source_id;
    setPreview(null); setConfirmation(false);
    if (id && !fixtureMode) void sourceApi.remove(id).catch(() => {});
  };

  const changeKind = (next: SourceKind) => {
    discardCurrent(); setKind(next); setText(''); setUrl(''); setFile(null); setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const setBackendPreview = (snapshot: SourceSnapshot) => {
    setPreview({ origin: 'backend', label: `${snapshot.name} · SHA-256 ${snapshot.content_sha256.slice(0, 16)}…`, content: snapshot.extracted_text, references: snapshot.references, metadata: snapshot, snapshot });
    setConfirmation(false); setError(null);
  };

  const previewText = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(null);
    try {
      if (fixtureMode) setPreview({ origin: 'local-draft', label: 'Local pasted text · frontend fixture mode · not submitted', content: text, references: [] });
      else setBackendPreview((await sourceApi.createText(text)).source);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Could not parse the pasted source.'); }
    finally { setLoading(false); }
  };

  const previewFile = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      if (fixtureMode) {
        const response = await fetch('/mock/source-preview.json');
        if (!response.ok) throw new Error('The synthetic source fixture could not be loaded.');
        const fixtures = await response.json() as Record<'pdf' | 'csv', Fixture>;
        const fixture = fixtures[kind as 'pdf' | 'csv'];
        setPreview({ origin: 'fixture', label: `${fixture.label} · not derived from ${file.name}`, content: fixture.extracted_text, references: fixture.references });
      } else setBackendPreview((await sourceApi.createFile(file)).source);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Could not parse this file.'); }
    finally { setLoading(false); }
  };

  const previewUrl = async () => {
    if (!url.trim() || fixtureMode) return;
    setLoading(true); setError(null);
    try { setBackendPreview((await sourceApi.createWebpage(url.trim())).source); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Could not retrieve this webpage.'); }
    finally { setLoading(false); }
  };

  const clearSource = () => {
    discardCurrent(); setText(''); setUrl(''); setFile(null); setError(null); setKind('none');
    if (fileRef.current) fileRef.current.value = '';
  };

  return <section className="source-input-panel panel" aria-labelledby="source-input-title">
    <div className="source-input-heading"><div><span className="section-kicker">OPTIONAL SOURCE</span><h2 id="source-input-title">Add source content</h2></div><span className={`source-api-badge ${fixtureMode ? 'fixture' : 'available'}`}>{fixtureMode ? 'FIXTURE MODE' : 'SOURCE API READY'}</span></div>
    <p className="source-api-message">{fixtureMode ? 'Fixture mode cannot call source APIs. Any displayed preview is local draft text or a synthetic fixture and cannot be attached to a run.' : 'The backend parses an immutable source snapshot. Only explicitly previewed content is uploaded or fetched.'}</p>
    {hasInput && !source && <p className="source-blocked-note" role="status">Preview this source successfully before starting. Source-backed comparisons require Live mode and explicit confirmation.</p>}
    {source && <p className="source-blocked-note" role="status">This source is parsed and retained with the run for reproducibility. Only use content you are authorized to send to the configured inference provider.</p>}
    <label className="source-kind-label" htmlFor="source-kind">Source type</label>
    <select id="source-kind" value={kind} onChange={(event) => changeKind(event.target.value as SourceKind)}>
      <option value="none">No source · text-only comparison</option><option value="text">Paste text</option><option value="pdf">PDF file</option><option value="csv">CSV file</option><option value="url">Public webpage URL</option>
    </select>

    {kind === 'text' && <div className="source-kind-content"><label htmlFor="source-text">Pasted source text</label><textarea id="source-text" rows={5} value={text} onChange={(event) => { discardCurrent(); setText(event.target.value); }} placeholder="Paste source content here. It is sent only when you select Preview source." /><div className="source-limit-note"><strong>Limit: 100,000 extracted characters.</strong> Source text is included verbatim as untrusted task context.</div><div className="source-actions"><button type="button" className="secondary-button" disabled={!text.trim() || loading || text.length > 100000} onClick={() => void previewText()}>{loading ? 'Parsing…' : 'Preview source'}</button><button type="button" className="text-button" onClick={clearSource}>Remove source</button></div></div>}

    {(kind === 'pdf' || kind === 'csv') && <div className="source-kind-content"><label htmlFor="source-file">Choose a {kind.toUpperCase()} file</label><input ref={fileRef} id="source-file" type="file" accept={kind === 'pdf' ? '.pdf,application/pdf' : '.csv,text/csv'} onChange={(event) => { discardCurrent(); setFile(event.target.files?.[0] ?? null); setError(null); }} /><div className="source-limit-note"><strong>Limits:</strong> 10 MiB per file, 100 PDF pages, 10,000 CSV data rows, 200 columns, and 100,000 extracted characters. Scanned PDFs need OCR, which is unavailable.</div>{file && <div className="selected-source-file"><strong>Selected locally:</strong> {file.name} · {file.size.toLocaleString()} bytes. The file is not uploaded until preview is selected.</div>}<div className="source-actions"><button type="button" className="secondary-button" disabled={!file || loading || file.size > 10 * 1024 * 1024} onClick={() => void previewFile()}>{loading ? 'Parsing…' : 'Parse and preview'}</button><button type="button" className="text-button" onClick={clearSource}>Remove selected file</button></div>{fixtureMode && <p className="source-fixture-note">Any preview is synthetic and is not derived from the selected file.</p>}</div>}

    {kind === 'url' && <div className="source-kind-content"><label htmlFor="source-url">Public webpage URL</label><input id="source-url" type="url" inputMode="url" value={url} onChange={(event) => { discardCurrent(); setUrl(event.target.value); }} placeholder="https://example.com/public-page" /><p className="source-limit-note">Only public HTTP(S) HTML or plain text is retrieved. Pages requiring login, scripts, or OCR are not supported.</p><div className="source-actions"><button type="button" className="secondary-button" disabled={!url.trim() || loading || fixtureMode} onClick={() => void previewUrl()}>{loading ? 'Fetching…' : 'Fetch and preview'}</button><button type="button" className="text-button" onClick={clearSource}>Remove URL</button></div>{fixtureMode && <p className="source-unavailable-note">URL retrieval is unavailable in frontend fixture mode. No network request was made.</p>}</div>}

    {error && <p className="source-warning" role="alert">{error}</p>}
    {source && <label className="source-confirmation"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /> I confirm this source content may be sent with my task to the configured inference provider in Live mode.</label>}
    {preview && <section className="source-preview" aria-labelledby="source-preview-title"><div className="source-preview-heading"><div><h3 id="source-preview-title">Content preview</h3><span className={`source-preview-badge ${preview.origin}`}>{preview.origin === 'backend' ? 'BACKEND PARSED · SNAPSHOT' : preview.origin === 'fixture' ? 'SYNTHETIC FIXTURE · NOT YOUR FILE' : 'LOCAL DRAFT · NOT SUBMITTED'}</span></div><button type="button" className="text-button" onClick={clearSource}>Remove source</button></div><p>{preview.label} · {preview.content.length.toLocaleString()} characters · complete preview, no truncation{preview.metadata?.unit_count !== null && preview.metadata?.unit_count !== undefined ? ` · ${preview.metadata.unit_count} ${preview.metadata.kind === 'pdf' ? 'pages' : 'data rows'}` : ''}{preview.metadata ? ` · parsed in ${preview.metadata.parse_duration_ms.toFixed(1)} ms` : ''}</p><pre tabIndex={0} role="region" aria-label="Extracted source text">{preview.content || 'Fetching the retained source snapshot…'}</pre>{preview.references.length > 0 && <div className="source-reference-preview" role="region" aria-label="Source references" tabIndex={0}><strong>Source references:</strong>{preview.references.slice(0, 50).map((reference, index) => <p key={`${reference.kind}-${index}`}>{reference.kind === 'pdf_page' ? `Page ${reference.page_number}` : reference.kind === 'csv_cell' ? `Row ${reference.row_number}, ${reference.column_name ?? `column ${reference.column_index}`}` : `Webpage text`} · {reference.excerpt}</p>)}{preview.references.length > 50 && <p>Showing first 50 of {preview.references.length} references.</p>}{preview.metadata && !preview.metadata.references_complete && <p>Reference list is incomplete because the backend reference limit was reached.</p>}</div>}</section>}
  </section>;
}
