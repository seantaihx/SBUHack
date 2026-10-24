import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SourceInput from './SourceInput';

describe('source selection while source API routes are pending', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps pasted text local and labels its preview as not submitted', async () => {
    const user = userEvent.setup();
    const onPendingChange = vi.fn();
    render(<SourceInput fixtureMode={false} onPendingChange={onPendingChange} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'text');
    await user.type(screen.getByLabelText('Pasted source text'), 'Synthetic local content.');
    await user.click(screen.getByRole('button', { name: 'Preview local text' }));

    expect(await screen.findByText('LOCAL DRAFT · NOT SUBMITTED')).toBeInTheDocument();
    expect(document.querySelector('.source-preview pre')).toHaveTextContent('Synthetic local content.');
    expect(screen.getByText(/No truncation is applied to this local draft/i)).toBeInTheDocument();
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(true));
  });

  it('shows a selected PDF locally without parsing or uploading it', async () => {
    const user = userEvent.setup();
    const onPendingChange = vi.fn();
    render(<SourceInput fixtureMode={false} onPendingChange={onPendingChange} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'pdf');
    const file = new File(['synthetic pdf bytes'], 'synthetic.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Choose a PDF file'), file);

    expect(document.querySelector('.selected-source-file')).toHaveTextContent(/Selected locally: synthetic\.pdf/);
    expect(screen.getByText(/not been parsed or uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/limits are pending backend agreement/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load synthetic PDF preview/i })).not.toBeInTheDocument();
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(true));
  });

  it('does not fetch a URL and clearly reports retrieval unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SourceInput fixtureMode={false} onPendingChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'url');
    await user.type(screen.getByLabelText('Public webpage URL'), 'https://example.com/public-report');

    expect(screen.getByText(/No network request will be made/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks a loaded parser example as a synthetic fixture unrelated to the selected file', async () => {
    const fixtures = {
      pdf: { kind: 'pdf', label: 'Synthetic PDF parser fixture', extracted_text: 'Synthetic page 1: Annual utilization is 91.0%.', character_count: 47, unit_count: 1, references: [{ kind: 'pdf_page', page_number: 1, excerpt: 'Annual utilization is 91.0%.' }] },
      csv: { kind: 'csv', label: 'Synthetic CSV parser fixture', extracted_text: 'year,utilization\n2015,91.0%', character_count: 27, unit_count: 1, references: [{ kind: 'csv_cell', row_number: 2, column_name: 'utilization', excerpt: '91.0%' }] },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => fixtures })));
    const user = userEvent.setup();
    render(<SourceInput fixtureMode onPendingChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'pdf');
    await user.click(screen.getByRole('button', { name: 'Load synthetic PDF preview' }));

    expect(await screen.findByText('SYNTHETIC FIXTURE · NOT YOUR FILE')).toBeInTheDocument();
    expect(screen.getByText(/not derived from your selected file/i)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 · Annual utilization is 91.0%\./)).toBeInTheDocument();
  });

  it('clears the selected file and preview when the user removes the source', async () => {
    const user = userEvent.setup();
    render(<SourceInput fixtureMode={false} onPendingChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Source type'), 'csv');
    await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['a,b\n1,2'], 'sample.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Remove selected file' }));

    expect(screen.getByLabelText('Source type')).toHaveValue('none');
    expect(screen.queryByText(/Selected locally: sample\.csv/)).not.toBeInTheDocument();
  });
});
