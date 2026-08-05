'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, Mail, Pencil, Trash2 } from 'lucide-react';
import { statusLabel } from '@/lib/domain/orders/status-format';
import { TypeBadge } from './type-badge';
import { SignalChip } from './signal-chip';
import { HealthSnapshot } from './health-snapshot';
import { ClientFormModal } from './client-form-modal';
import { displayClientName } from './display';
import type { ClientDetailResponse, ContactSuggestion, MonthBucket } from './types';

/** Canned openers, so adding a note costs one click instead of a sentence. */
const QUICK_NOTES = [
  'Called — left voicemail',
  'Emailed, waiting on reply',
  'Met in person',
  'Sent quote',
  'Not interested right now',
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The signal's "why" line is worth showing unless the health snapshot's own
 * basis line already says exactly the same thing — which is always the case
 * when the signal came from the 90-day trend. Printing it twice reads as a bug.
 */
export function shouldShowSignalDetail(
  detail: string | null | undefined,
  trendBasis: string | null | undefined,
): boolean {
  if (!detail) return false;
  const norm = (s: string) => s.trim().replace(/\.$/, '').toLowerCase();
  return norm(detail) !== norm(trendBasis ?? '');
}

interface Props {
  clientId: number;
  role: 'sales_rep' | 'sales_manager';
  repId: string | null;
  /** Encoded list state, echoed back on the Back link. */
  backQuery: string;
}

export function ClientProfilePage({ clientId, role, repId, backQuery }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const backHref = `/sales/clients${backQuery ? `?${backQuery}` : ''}`;

  const fetchDetail = useCallback(() => {
    setError(null);
    const params = repId ? `?repId=${encodeURIComponent(repId)}` : '';
    fetch(`/api/sales/clients/${clientId}${params}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ClientDetailResponse) => setData(d))
      .catch(() => setError('Failed to load this client'))
      .finally(() => setLoading(false));
  }, [clientId, repId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const client = data?.client ?? null;
  const canEdit = client?.canEdit ?? false;

  async function addNote(body: string) {
    const text = body.trim();
    if (!text || !client) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/sales/clients/${client.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) { setNoteInput(''); fetchDetail(); }
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(noteId: number) {
    if (!client) return;
    await fetch(`/api/sales/clients/${client.id}/notes/${noteId}`, { method: 'DELETE' });
    fetchDetail();
  }

  async function deleteClient() {
    if (!client) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/clients/${client.id}`, { method: 'DELETE' });
      if (res.ok) router.push(backHref);
    } finally {
      setBusy(false);
    }
  }

  async function linkSuggestion(s: ContactSuggestion) {
    if (!client) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: s.id }),
      });
      if (res.ok) fetchDetail();
    } finally {
      setBusy(false);
    }
  }

  function copyEmail() {
    if (!client?.email) return;
    navigator.clipboard?.writeText(client.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="h-28 bg-gray-100 rounded-lg animate-pulse mb-4" />
        <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to My Clients
        </Link>
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <p className="text-red-600 font-medium">{error ?? 'Client not found'}</p>
        </div>
      </div>
    );
  }

  const title = displayClientName(client.name, client.company);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-3">
        <ArrowLeft className="h-4 w-4" /> Back to My Clients
      </Link>

      {/* Header */}
      <div className="bg-[#1B2A4A] rounded-t-lg px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-white text-lg font-semibold truncate">{title}</h1>
              <TypeBadge type={client.type} />
              {data?.signal && <SignalChip signal={data.signal} size="md" />}
            </div>
            {client.company && title !== client.company && (
              <p className="text-white/60 text-sm truncate mt-0.5">{client.company}</p>
            )}
            <div className="mt-1.5 text-sm text-white/70 space-y-0.5">
              {client.email && <p className="truncate">{client.email}</p>}
              {client.phone && <p>{client.phone}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && (
              <button onClick={() => setShowEdit(true)} aria-label="Edit client"
                className="p-2 text-white/60 hover:text-white transition-colors">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Outlook shortcuts */}
        {client.email && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <a
              href={`mailto:${client.email}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors"
            >
              <Mail className="h-3.5 w-3.5" /> Email in Outlook
            </a>
            <button
              onClick={copyEmail}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy email'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg">
        {/* Health snapshot — the PR #14 engine, unchanged */}
        {data?.metrics && <HealthSnapshot metrics={data.metrics} />}

        {/* Why the chip says what it says. */}
        {data && shouldShowSignalDetail(data.signal?.detail, data.metrics.trend.basis) && (
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm text-gray-600">{data.signal!.detail}</p>
          </div>
        )}

        {/* Orders by month */}
        {data && data.ordersByMonth.length > 0 && (
          <OrdersByMonth buckets={data.ordersByMonth} />
        )}

        <div className="grid md:grid-cols-2 gap-0 md:divide-x divide-gray-100">
          {/* Notes */}
          <div className="px-5 py-4 border-b md:border-b-0 border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Notes</h2>
            {canEdit && (
              <div className="mb-3">
                <textarea
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  rows={2}
                  placeholder="Add a note — met at the mixer, prefers texts…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none
                             focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
                />
                <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {QUICK_NOTES.map(q => (
                      <button key={q} onClick={() => addNote(q)} disabled={savingNote}
                        className="text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-[#F26B2B]/50 hover:text-[#F26B2B] disabled:opacity-40 transition-colors">
                        {q}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => addNote(noteInput)} disabled={savingNote || !noteInput.trim()}
                    className="h-8 px-3.5 rounded-lg bg-[#F26B2B] text-white text-xs font-medium hover:bg-[#E05A1A] disabled:opacity-40 transition-colors">
                    {savingNote ? 'Adding…' : 'Add note'}
                  </button>
                </div>
              </div>
            )}
            {(data?.notes.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">
                {canEdit ? 'No notes yet — jot down anything worth remembering.' : 'No notes yet.'}
              </p>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto">
                {data!.notes.map(note => (
                  <div key={note.id} className="group bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.body}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-xs text-gray-400">
                        {note.authorName ?? 'Unknown'} · {fmtDate(note.createdAt)}
                      </p>
                      {canEdit && (
                        <button onClick={() => deleteNote(note.id)} aria-label="Delete note"
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent files + company contacts */}
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent files</h2>
            {client.contactId === null ? (
              <UnlinkedBlock
                canEdit={canEdit}
                suggestions={data?.suggestions ?? []}
                busy={busy}
                onLink={linkSuggestion}
              />
            ) : (data?.business.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">No orders with this client yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {data!.business.slice(0, 8).map(o => (
                  <Link key={o.id} href={`/orders/${o.id}`}
                    className="flex items-center justify-between gap-3 py-2 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 truncate">{o.fileNumber}</p>
                      <p className="text-xs text-gray-500">{fmtDate(o.openedAt)}</p>
                    </div>
                    <span className="text-xs text-gray-500 shrink-0">
                      {statusLabel(o.operationalStatus ?? '')}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {(data?.companyContacts.length ?? 0) > 0 && (
              <>
                <h2 className="text-sm font-semibold text-gray-900 mt-5 mb-1">Who else works with us</h2>
                <p className="text-xs text-gray-500 mb-2">
                  Other people at this company you have files with.
                </p>
                <div className="divide-y divide-gray-100">
                  {data!.companyContacts.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          {c.fullName ?? c.email ?? 'Unnamed contact'}
                        </p>
                        {c.email && c.fullName && (
                          <p className="text-xs text-gray-500 truncate">{c.email}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">
                        {c.orderCount} file{c.orderCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Danger zone */}
        {canEdit && (
          <div className="px-5 py-3 border-t border-gray-100">
            {confirmDelete ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-red-700">Delete this client and all their notes?</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setConfirmDelete(false)}
                    className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-700">Cancel</button>
                  <button onClick={deleteClient} disabled={busy}
                    className="h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-medium disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 transition-colors">
                <Trash2 className="h-3.5 w-3.5" /> Delete client
              </button>
            )}
          </div>
        )}
      </div>

      {showEdit && (
        <ClientFormModal
          client={client}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); fetchDetail(); }}
        />
      )}
    </div>
  );
}

/** Twelve months of order volume. Same rows as the snapshot above it. */
function OrdersByMonth({ buckets }: { buckets: MonthBucket[] }) {
  const max = useMemo(() => Math.max(1, ...buckets.map(b => b.orders)), [buckets]);
  return (
    <div className="px-5 py-4 border-b border-gray-100">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Orders by month</h2>
      <div className="flex items-end gap-1.5 h-24">
        {buckets.map(b => {
          const [, m] = b.month.split('-');
          return (
            <div key={b.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="w-full flex items-end justify-center" style={{ height: '72px' }}>
                <div
                  title={`${b.month}: ${b.orders} order${b.orders === 1 ? '' : 's'}`}
                  className={`w-full rounded-t ${b.orders > 0 ? 'bg-[#1B2A4A]/70' : 'bg-gray-100'}`}
                  style={{ height: `${Math.max(3, Math.round((b.orders / max) * 72))}px` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 tabular-nums">{m}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnlinkedBlock({
  canEdit, suggestions, busy, onLink,
}: {
  canEdit: boolean;
  suggestions: ContactSuggestion[];
  busy: boolean;
  onLink: (s: ContactSuggestion) => void;
}) {
  return (
    <div>
      <p className="text-sm text-gray-500">
        Not linked to a transaction contact yet, so there is no order history to show.
      </p>
      {canEdit && suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          {suggestions.map(s => (
            <div key={s.id}
              className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {s.fullName ?? s.email ?? 'Unnamed contact'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {[s.companyName, s.email].filter(Boolean).join(' · ') || 'from transactions'}
                </p>
              </div>
              <button onClick={() => onLink(s)} disabled={busy}
                className="shrink-0 h-8 px-3 rounded-lg bg-[#F26B2B] text-white text-xs font-medium hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
                Link
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
