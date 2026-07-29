'use client';

import { useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { ModalShell } from '@/components/shared/action-modals/modal-shell';
import {
  mapCsvToImportRows, parseCsv, previewImportRows,
  type ImportRow, type PreviewRow,
} from './csv-parse';

const MAX_ROWS = 1000;
const PREVIEW_LIMIT = 8;

type Step =
  | { step: 'upload' }
  | { step: 'preview'; rows: ImportRow[]; preview: PreviewRow[] }
  | { step: 'done'; added: number; skipped: number; errors: number; errorRows: Array<{ row: number; message?: string }> };

interface Props {
  onClose: () => void;
  /** Called after a commit that added at least one client, so the list refreshes. */
  onImported: () => void;
}

const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  added: 'Will add',
  skipped_duplicate: 'Skipped',
  error: 'Problem',
};

const STATUS_CLS: Record<PreviewRow['status'], string> = {
  added: 'bg-green-50 text-green-700',
  skipped_duplicate: 'bg-gray-100 text-gray-500',
  error: 'bg-red-50 text-red-600',
};

export function ImportClientsModal({ onClose, onImported }: Props) {
  const [state, setState] = useState<Step>({ step: 'upload' });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploadError(null);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      const { rows, missingNameHeader } = mapCsvToImportRows(parsed);

      if (missingNameHeader) {
        setUploadError('That file doesn’t have a "name" column. Download the sample below to see the expected format.');
        return;
      }
      if (rows.length === 0) {
        setUploadError('That file doesn’t have any rows in it.');
        return;
      }
      if (rows.length > MAX_ROWS) {
        setUploadError(`That file has ${rows.length.toLocaleString()} rows — the limit is ${MAX_ROWS.toLocaleString()} per import. Please split it into smaller files.`);
        return;
      }

      // Build the "already in your list" set from the export route — read-only
      // reuse of an existing endpoint; the server re-checks on commit anyway.
      let existing = new Set<string>();
      try {
        const res = await fetch('/api/sales/clients/export');
        if (res.ok) {
          const csv = parseCsv(await res.text());
          const emailIdx = csv.headers.findIndex(h => h.toLowerCase() === 'email');
          if (emailIdx >= 0) {
            existing = new Set(
              csv.rows.map(r => (r[emailIdx] ?? '').trim().toLowerCase()).filter(Boolean),
            );
          }
        }
      } catch { /* preview degrades gracefully; commit is authoritative */ }

      setState({ step: 'preview', rows, preview: previewImportRows(rows, existing) });
    } catch {
      setUploadError('Couldn’t read that file. Make sure it’s a .csv and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (state.step !== 'preview') return;
    setBusy(true);
    try {
      const res = await fetch('/api/sales/clients/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: state.rows }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setUploadError(data?.error ?? 'Import failed — please try again.');
        setState({ step: 'upload' });
        return;
      }
      const errorRows = (data.results ?? [])
        .filter((r: { status: string }) => r.status === 'error')
        .map((r: { row: number; message?: string }) => ({ row: r.row, message: r.message }));
      setState({ step: 'done', added: data.added, skipped: data.skipped, errors: data.errors, errorRows });
      if (data.added > 0) onImported();
    } finally {
      setBusy(false);
    }
  }

  const counts = state.step === 'preview'
    ? {
      added: state.preview.filter(r => r.status === 'added').length,
      skipped: state.preview.filter(r => r.status === 'skipped_duplicate').length,
      errors: state.preview.filter(r => r.status === 'error').length,
    }
    : null;

  return (
    <ModalShell open onClose={onClose} title="Import clients"
      subtitle={state.step === 'preview' ? 'Step 2 of 2 — review before importing' : undefined}>
      <div className="p-5">
        {state.step === 'upload' && (
          <div>
            <p className="text-sm text-gray-600">
              Upload a .csv file with your client list. It needs a{' '}
              <span className="font-medium text-gray-900">name</span> column;{' '}
              <span className="font-medium text-gray-900">company</span>,{' '}
              <span className="font-medium text-gray-900">email</span>, and{' '}
              <span className="font-medium text-gray-900">phone</span> are optional.
              Any other columns are ignored.
            </p>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="mt-4 w-full border-2 border-dashed border-gray-200 rounded-xl py-10 flex flex-col items-center gap-2
                         text-gray-500 hover:border-[#F26B2B]/50 hover:text-[#F26B2B] disabled:opacity-50 transition-colors">
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">{busy ? 'Reading file…' : 'Choose a .csv file'}</span>
            </button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

            {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}

            <a href="/sample-clients.csv" download
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-[#F26B2B] hover:text-[#E05A1A] transition-colors">
              <FileText className="h-4 w-4" /> Download a sample file
            </a>
          </div>
        )}

        {state.step === 'preview' && counts && (
          <div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-green-700">{counts.added}</p>
                <p className="text-xs text-green-700">will be added</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-gray-600">{counts.skipped}</p>
                <p className="text-xs text-gray-500">already in your list</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${counts.errors > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <p className={`text-xl font-bold ${counts.errors > 0 ? 'text-red-600' : 'text-gray-600'}`}>{counts.errors}</p>
                <p className={`text-xs ${counts.errors > 0 ? 'text-red-600' : 'text-gray-500'}`}>problems</p>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/60 border-b border-gray-100">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500 hidden sm:table-cell">Email</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {state.preview.slice(0, PREVIEW_LIMIT).map(r => (
                    <tr key={r.row}>
                      <td className="px-3 py-2 text-gray-900">{r.data.name ?? <span className="text-gray-400 italic">missing</span>}</td>
                      <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{r.data.email ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block text-xs rounded-full px-2 py-0.5 ${STATUS_CLS[r.status]}`}
                          title={r.message}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.preview.length > PREVIEW_LIMIT && (
                <p className="px-3 py-2 text-xs text-gray-400 bg-gray-50/40 border-t border-gray-100">
                  …and {state.preview.length - PREVIEW_LIMIT} more row{state.preview.length - PREVIEW_LIMIT === 1 ? '' : 's'}
                </p>
              )}
            </div>

            {counts.errors > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                Rows with problems are skipped — everything else still imports.
              </p>
            )}

            <div className="flex justify-between items-center mt-4">
              <button onClick={() => { setState({ step: 'upload' }); setUploadError(null); }}
                className="h-9 px-4 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                ‹ Different file
              </button>
              <button onClick={commit} disabled={busy || counts.added === 0}
                className="h-9 px-4 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] disabled:opacity-40 transition-colors">
                {busy ? 'Importing…' : `Import ${counts.added} client${counts.added === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {state.step === 'done' && (
          <div>
            <p className="text-sm font-medium text-gray-900">
              {state.added} added, {state.skipped} skipped, {state.errors} problem{state.errors === 1 ? '' : 's'}
            </p>
            {state.errorRows.length > 0 && (
              <ul className="mt-2 space-y-1">
                {state.errorRows.map(e => (
                  <li key={e.row} className="text-xs text-red-600">
                    Row {e.row}: {e.message ?? 'Could not import'}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={onClose}
                className="h-9 px-4 rounded-lg bg-[#1B2A4A] text-white text-sm font-medium hover:bg-[#16233E] transition-colors">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
