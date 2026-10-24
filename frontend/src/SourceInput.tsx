import { useEffect, useRef, useState } from 'react';

type SourceKind = 'none' | 'text' | 'pdf' | 'csv' | 'url';
type SourceReference = { kind: string; page_number?: number; row_number?: number; column_name?: string; excerpt: string };
type SourceFixture = { kind: 'pdf' | 'csv'; label: string; extracted_text: string; character_count: number; unit_count: number; references: SourceReference[] };
type SourceFixtures = { pdf: SourceFixture; csv: SourceFixture };
type Preview = { origin: 'local-text' | 'fixture'; label: string; content: string; references: SourceReference[] };

export default function SourceInput({ fixtureMode, onPendingChange }: { fixtureMode: boolean; onPendingChange: (pending: boolean) => void }) {
  const [kind, setKind] = useState<SourceKind>('none');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingFixture, setLoadingFixture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSource = (kind === 'text' && text.length > 0) || (['pdf', 'csv'].includes(kind) && file !== null) || (kind === 'url' && url.trim().length > 0) || preview !== null;

  useEffect(() => { onPendingChange(hasSource); }, [hasSource, onPendingChange]);

  const changeKind = (next: SourceKind) => {
    setKind(next); setText(''); setUrl(''); setFile(null); setPreview(null); setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const showLocalText = () => {
    if (kind !== 'text' || !text.trim()) return;
    setPreview({ origin: 'local-text', label: 'Local pasted-text preview · full draft · not submitted', content: text, references: [] });
    setError(null);
  };

  const loadFixture = async (sourceKind: 'pdf' | 'csv') => {
    setLoadingFixture(true); setError(null);
    try {
      const response = await fetch('/mock/source-preview.json');
      if (!response.ok) throw new Error('The synthetic source fixture could not be loaded.');
      const fixtures = await response.json() as SourceFixtures;
      const fixture = fixtures[sourceKind];
      setPreview({ origin: 'fixture', label: `${fixture.label} · not derived from your selected file`, content: fixture.extracted_text, references: fixture.references });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The synthetic source fixture could not be loaded.');
    } finally { setLoadingFixture(false); }
  };

  const clearSource = () => {
    setText(''); setUrl(''); setFile(null); setPreview(null); setError(null);
    if (fileRef.current) fileRef.current.value = '';
    setKind('none');
  };

  return <section className="source-input-panel panel" aria-labelledby="source-input-title">
    <div className="source-input-heading"><div><span className="section-kicker">OPTIONAL SOURCE</span><h2 id="source-input-title">Add source content</h2></div><span className={`source-api-badge ${fixtureMode ? 'fixture' : 'unavailable'}`}>{fixtureMode ? 'FIXTURE MODE' : 'API SOURCE UNAVAILABLE'}</span></div>
    <p className="source-api-message">{fixtureMode ? 'Source previews below are synthetic fixtures. They are not parsed from your file and cannot be submitted for inference.' : 'Accepted API v1 has no source import or webpage retrieval route. Nothing is uploaded or fetched. Source selection blocks Compare until cleared; text-only runs remain available.'}</p>
    {!fixtureMode && <p className="source-unavailable-note" role="status">Source input and source-grounded runs are unavailable until the backend contract is agreed and implemented.</p>}
    {hasSource && <p className="source-blocked-note" role="status">The comparison button is disabled because the accepted API cannot attach this source. Select “No source” to continue with the existing text-only flow.</p>}
    <label className="source-kind-label" htmlFor="source-kind">Source type</label>
    <select id="source-kind" value={kind} onChange={(event) => changeKind(event.target.value as SourceKind)}>
      <option value="none">No source · text-only comparison</option>
      <option value="text">Paste text</option>
      <option value="pdf">PDF file</option>
      <option value="csv">CSV file</option>
      <option value="url">Public webpage URL · not available</option>
    </select>

    {kind === 'text' && <div className="source-kind-content"><label htmlFor="source-text">Pasted source text</label><textarea id="source-text" rows={5} value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder="Paste source content here. It stays in this browser while source routes are unavailable." /><div className="source-limit-note"><strong>Proposed limit: 100,000 characters.</strong> This limit is pending backend agreement and is not enforced. No truncation is applied to this local draft.</div><div className="source-actions"><button type="button" className="secondary-button" disabled={!text.trim()} onClick={showLocalText}>Preview local text</button><button type="button" className="text-button" onClick={clearSource}>Remove source</button></div></div>}

    {(kind === 'pdf' || kind === 'csv') && <div className="source-kind-content"><label htmlFor="source-file">Choose a {kind.toUpperCase()} file</label><input ref={fileRef} id="source-file" type="file" accept={kind === 'pdf' ? '.pdf,application/pdf' : '.csv,text/csv'} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(null); }} /><div className="source-limit-note"><strong>Proposed limits:</strong> 10 MiB per file, 100 PDF pages, 10,000 CSV data rows, 200 columns, and 100,000 extracted characters. These limits are pending backend agreement and are not enforced here.</div>{file && <div className="selected-source-file"><strong>Selected locally:</strong> {file.name} · {file.size.toLocaleString()} bytes. The file has not been parsed or uploaded.</div>}{file && file.size > 10 * 1024 * 1024 && <p className="source-warning" role="alert">This file is above the proposed 10 MiB limit. It was not uploaded or partially processed.</p>}<div className="source-actions"><button type="button" className="text-button" onClick={clearSource}>Remove selected file</button>{fixtureMode && <button type="button" className="secondary-button" disabled={loadingFixture} onClick={() => void loadFixture(kind)}>{loadingFixture ? 'Loading fixture…' : `Load synthetic ${kind.toUpperCase()} preview`}</button>}</div>{fixtureMode && <p className="source-fixture-note">The fixture preview is synthetic and is not derived from the selected file. No document parser or inference request runs.</p>}</div>}

    {kind === 'url' && <div className="source-kind-content"><label htmlFor="source-url">Public webpage URL</label><input id="source-url" type="url" inputMode="url" value={url} onChange={(event) => { setUrl(event.target.value); setPreview(null); }} placeholder="https://example.com/public-page" /><p className="source-unavailable-note">Direct page retrieval has not been implemented. No network request will be made. A homepage URL would not establish that a specific data page was found.</p><button type="button" className="text-button" onClick={clearSource}>Remove URL</button></div>}

    {error && <p className="source-warning" role="alert">{error}</p>}
    {preview && <section className="source-preview" aria-labelledby="source-preview-title"><div className="source-preview-heading"><div><h3 id="source-preview-title">Content preview</h3><span className={`source-preview-badge ${preview.origin}`}>{preview.origin === 'fixture' ? 'SYNTHETIC FIXTURE · NOT YOUR FILE' : 'LOCAL DRAFT · NOT SUBMITTED'}</span></div><button type="button" className="text-button" onClick={() => setPreview(null)}>Hide preview</button></div><p>{preview.label} · {preview.content.length.toLocaleString()} characters · complete preview, no truncation</p><pre>{preview.content}</pre>{preview.references.length > 0 && <div className="source-reference-preview"><strong>Fixture references (synthetic):</strong>{preview.references.map((reference, index) => <p key={`${reference.kind}-${index}`}>{reference.kind === 'pdf_page' ? `Page ${reference.page_number}` : `Row ${reference.row_number}, ${reference.column_name}`} · {reference.excerpt}</p>)}</div>}</section>}
  </section>;
}
