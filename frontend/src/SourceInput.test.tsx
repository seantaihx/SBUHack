import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SourceInput from './SourceInput';

const snapshot = {
  source_id: '2af52cf3-bfdc-4a75-9641-b8d7faf819e1', kind: 'text', name: 'Pasted text', media_type: 'text/plain; charset=utf-8',
  original_url: null, final_url: null, retrieved_at: null, content_sha256: 'a'.repeat(64), character_count: 24,
  unit_count: null, parse_duration_ms: 1.2, expires_at: '2026-10-24T20:30:00Z', references: [], references_complete: true,
  extracted_text: 'Synthetic local content.',
};
const ok = (body: unknown) => ({ ok: true, status: 201, json: async () => body });

describe('backend source preview flow', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts pasted text for a backend snapshot and requires confirmation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok({ source: snapshot }));
    vi.stubGlobal('fetch', fetchMock);
    const onSourceChange = vi.fn();
    const user = userEvent.setup();
    render(<SourceInput fixtureMode={false} onSourceChange={onSourceChange} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'text');
    await user.type(screen.getByLabelText('Pasted source text'), snapshot.extracted_text);
    await user.click(screen.getByRole('button', { name: 'Preview source' }));

    expect(await screen.findByText('BACKEND PARSED · SNAPSHOT')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sources/text', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: 'Pasted text', text: snapshot.extracted_text });
    await user.click(screen.getByRole('checkbox', { name: /I confirm this source content may be sent/i }));
    await waitFor(() => expect(onSourceChange).toHaveBeenLastCalledWith(expect.objectContaining({ source_id: snapshot.source_id }), true, true));
  });

  it('keeps backend source parsing failures visible and does not create a preview', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ error: { code: 'SOURCE_PARSE_FAILED', message: 'The PDF has no extractable text.', details: {} } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SourceInput fixtureMode={false} onSourceChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'text');
    await user.type(screen.getByLabelText('Pasted source text'), 'Unparseable source sample');
    await user.click(screen.getByRole('button', { name: 'Preview source' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The PDF has no extractable text.');
    expect(screen.queryByRole('heading', { name: 'Content preview' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sources/text', expect.objectContaining({ method: 'POST' }));
  });

  it('uploads a selected PDF only after the explicit parse action', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok({ source: { ...snapshot, kind: 'pdf', name: 'report.pdf' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SourceInput fixtureMode={false} onSourceChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'pdf');
    await user.upload(screen.getByLabelText('Choose a PDF file'), new File(['pdf bytes'], 'report.pdf', { type: 'application/pdf' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Parse and preview' }));
    await screen.findByText('BACKEND PARSED · SNAPSHOT');
    const request = fetchMock.mock.calls[0][1];
    expect(request?.body).toBeInstanceOf(FormData);
    expect(new Headers(request?.headers).has('Content-Type')).toBe(false);
  });

  it('sends a public URL only after the user chooses Fetch and preview', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok({ source: { ...snapshot, kind: 'webpage', name: 'example.org', final_url: 'https://example.org/report' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SourceInput fixtureMode={false} onSourceChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'url');
    await user.type(screen.getByLabelText('Public webpage URL'), 'https://example.org/report');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Fetch and preview' }));
    await screen.findByText('BACKEND PARSED · SNAPSHOT');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sources/webpage', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps fixture previews separate from the selected file and does not allow source confirmation', async () => {
    const fixtures = {
      pdf: { kind: 'pdf', label: 'Synthetic PDF fixture', extracted_text: 'Synthetic page text.', references: [] },
      csv: { kind: 'csv', label: 'Synthetic CSV fixture', extracted_text: 'year,value\n2015,91.0%', references: [] },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => fixtures }));
    vi.stubGlobal('fetch', fetchMock);
    const onSourceChange = vi.fn();
    const user = userEvent.setup();
    render(<SourceInput fixtureMode onSourceChange={onSourceChange} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'csv');
    await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['real input'], 'data.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Parse and preview' }));
    expect(await screen.findByText('SYNTHETIC FIXTURE · NOT YOUR FILE')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/mock/source-preview.json');
    expect(screen.queryByRole('checkbox', { name: /I confirm this source content/i })).not.toBeInTheDocument();
    await waitFor(() => expect(onSourceChange).toHaveBeenLastCalledWith(null, true, false));
  });

  it('shows URL retrieval unavailable in explicit frontend fixture mode', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SourceInput fixtureMode onSourceChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'url');
    await user.type(screen.getByLabelText('Public webpage URL'), 'https://example.org/report');
    expect(screen.getByText(/No network request was made/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch and preview' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
