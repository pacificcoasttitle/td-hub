'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';

// ─── Party wizard invite — dry run panel ─────────────────────────────────────
//
// The invite job emails people outside PCT. This is the only place to see who
// that would be without sending to them, so the recipient address is shown in
// full rather than summarised into a count.

type Outcome =
  | 'would_send'
  | 'skipped_existing_link'
  | 'skipped_duplicate_property'
  | 'skipped_recipient_cap'
  | 'no_escrow_officer'
  | 'officer_no_email';

interface ReportRow {
  orderId: number;
  fileNumber: string;
  openedAt: string | null;
  ageDays: number | null;
  transactionType: string | null;
  propertyAddress: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  recipientRole: string;
  outcome: Outcome;
  duplicateOf?: string | null;
  linkRoles: string[];
  linkAction: 'would_mint' | 'live_link_exists' | 'none';
  subject: string | null;
  templateError?: string;
}

interface SampleEmail {
  orderId: number;
  fileNumber: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  linkPlaceholder: string;
}

interface DryRunResult {
  scanned: number;
  reachablePct: number;
  enabled: boolean;
  report?: ReportRow[];
  sampleEmail?: SampleEmail;
  reportNote?: string;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  would_send: 'Would send',
  skipped_existing_link: 'Skipped — live link',
  skipped_duplicate_property: 'Skipped — same property',
  skipped_recipient_cap: 'Held — recipient cap',
  no_escrow_officer: 'No escrow officer',
  officer_no_email: 'Officer has no email',
};

const OUTCOME_CLASS: Record<Outcome, string> = {
  would_send: 'bg-green-50 text-green-700 border-green-200',
  skipped_existing_link: 'bg-gray-50 text-gray-600 border-gray-200',
  skipped_duplicate_property: 'bg-gray-50 text-gray-600 border-gray-200',
  skipped_recipient_cap: 'bg-blue-50 text-blue-700 border-blue-200',
  no_escrow_officer: 'bg-amber-50 text-amber-700 border-amber-200',
  officer_no_email: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function PartyInviteDryRun() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/party-wizard/invite-dry-run', { method: 'POST' });
      const data = await res.json();
      if (res.ok) setResult(data);
      else setError(data.error ?? 'Dry run failed');
    } catch {
      setError('Network error while running the dry run');
    } finally {
      setRunning(false);
    }
  }

  const rows = result?.report ?? [];
  const wouldSend = rows.filter(r => r.outcome === 'would_send').length;
  const held = rows.filter(r => r.outcome === 'skipped_recipient_cap').length;
  const templateErrors = rows.filter(r => r.templateError).length;

  return (
    <section>
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Party wizard invite</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Emails escrow contacts a forwardable link when an order still has no listing agent.
            The dry run resolves every recipient and renders every template without sending or
            minting anything.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-[#1B2A4A] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#25385f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eye className="h-4 w-4" />
          {running ? 'Running…' : 'Run dry run'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 border-b border-gray-100 text-sm">
            <span className="text-gray-700">
              Candidates <strong className="tabular-nums">{result.scanned}</strong>
            </span>
            <span className="text-gray-700">
              Would send <strong className="tabular-nums text-green-700">{wouldSend}</strong>
            </span>
            {held > 0 && (
              <span className="text-gray-700">
                Held for next run <strong className="tabular-nums">{held}</strong>
              </span>
            )}
            <span className="text-gray-700">
              Reachable <strong className="tabular-nums">{result.reachablePct}%</strong>
            </span>
            <span className={result.enabled ? 'text-red-700 font-medium' : 'text-gray-500'}>
              Sending is {result.enabled ? 'ON' : 'OFF'}
            </span>
            {templateErrors > 0 && (
              <span className="text-red-700 font-medium">
                {templateErrors} template error{templateErrors === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              No orders matched the invite window. Nothing would be emailed.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">File</th>
                    <th className="px-4 py-2 text-left">Age</th>
                    <th className="px-4 py-2 text-left">Recipient</th>
                    <th className="px-4 py-2 text-left">Link</th>
                    <th className="px-4 py-2 text-left">Outcome</th>
                    <th className="px-4 py-2 text-left">Subject</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(r => (
                    <tr key={r.orderId}>
                      <td className="px-4 py-2 align-top">
                        <span className="font-medium text-gray-900">{r.fileNumber}</span>
                        {r.propertyAddress && (
                          <span className="block text-xs text-gray-500">{r.propertyAddress}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 align-top tabular-nums text-gray-600">
                        {r.ageDays === null ? '—' : `${r.ageDays}d`}
                      </td>
                      <td className="px-4 py-2 align-top">
                        {r.recipientEmail ? (
                          <>
                            <span className="text-gray-900">{r.recipientEmail}</span>
                            {r.recipientName && (
                              <span className="block text-xs text-gray-500">
                                {r.recipientName} · {r.recipientRole}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 align-top text-xs text-gray-600">
                        {r.linkAction === 'none' ? '—' : `${r.linkRoles.join(', ')} · ${r.linkAction === 'would_mint' ? 'new' : 'existing'}`}
                      </td>
                      <td className="px-4 py-2 align-top">
                        <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${OUTCOME_CLASS[r.outcome]}`}>
                          {OUTCOME_LABEL[r.outcome]}
                        </span>
                        {r.outcome === 'skipped_duplicate_property' && (
                          <span className="block text-xs text-gray-500 mt-0.5">
                            {r.duplicateOf ? `asked on ${r.duplicateOf}` : 'asked on an earlier run'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 align-top text-xs text-gray-600">
                        {r.templateError
                          ? <span className="text-red-700">Template error: {r.templateError}</span>
                          : (r.subject ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.reportNote && (
            <p className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500">{result.reportNote}</p>
          )}
        </div>
      )}

      {result?.sampleEmail && <SampleEmailPanel sample={result.sampleEmail} />}
    </section>
  );
}

/**
 * The first email the run would send, rendered whole. Copy gets approved from
 * this, so it is the real output for a real order rather than a sample fixture —
 * only the link is a placeholder.
 */
function SampleEmailPanel({ sample }: { sample: SampleEmail }) {
  const [view, setView] = useState<'html' | 'text' | null>('html');

  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            Rendered email — file {sample.fileNumber}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            To {sample.to} · {sample.subject}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(['html', 'text'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(view === mode ? null : mode)}
              className={`rounded px-2.5 py-1 text-xs font-medium border ${
                view === mode
                  ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode === 'html' ? 'HTML' : 'Plain text'}
            </button>
          ))}
        </div>
      </div>

      {view === 'html' && (
        <iframe
          // Sandboxed with no allowances: the preview must not be able to run
          // anything, follow the placeholder link, or reach the admin session.
          sandbox=""
          srcDoc={sample.html}
          title={`Rendered invite for file ${sample.fileNumber}`}
          className="w-full h-[620px] border-0 bg-gray-50"
        />
      )}
      {view === 'text' && (
        <pre className="px-4 py-3 text-xs text-gray-700 whitespace-pre-wrap bg-gray-50">{sample.text}</pre>
      )}

      <p className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
        Every link in this preview points at {sample.linkPlaceholder} — no link was minted.
      </p>
    </div>
  );
}
