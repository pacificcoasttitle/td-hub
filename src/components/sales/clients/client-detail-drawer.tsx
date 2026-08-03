'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, X } from 'lucide-react';
import { statusLabel } from '@/lib/domain/orders/status-format';
import { TypeBadge } from './type-badge';
import { HealthSnapshot } from './health-snapshot';
import { displayClientName } from './display';
import { formatCurrency } from '@/components/admin/dashboards/shared';
import type { ClientDetailResponse, ContactSuggestion, CrmClient } from './types';

interface Props {
  clientId: number;
  /** Manager's rep filter, passed through so the read scope matches the list. */
  repId: number | null;
  onClose: () => void;
  onEdit: (client: CrmClient) => void;
  /** Called after any change (note added/deleted, link, delete) so the list refreshes. */
  onChanged: () => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ClientDetailDrawer({ clientId, repId, onClose, onEdit, onChanged }: Props) {
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchDetail = useCallback(() => {
    setError(null);
    const params = repId !== null ? `?repId=${repId}` : '';
    fetch(`/api/sales/clients/${clientId}${params}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ClientDetailResponse) => setData(d))
      .catch(() => setError('Failed to load this client'))
      .finally(() => setLoading(false));
  }, [clientId, repId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const client = data?.client ?? null;
  const canEdit = client?.canEdit ?? false;

  async function addNote() {
    const body = noteInput.trim();
    if (!body || !client) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/sales/clients/${client.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setNoteInput('');
        fetchDetail();
        onChanged();
      }
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(noteId: number) {
    if (!client) return;
    await fetch(`/api/sales/clients/${client.id}/notes/${noteId}`, { method: 'DELETE' });
    fetchDetail();
    onChanged();
  }

  async function deleteClient() {
    if (!client) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/clients/${client.id}`, { method: 'DELETE' });
      if (res.ok) {
        onChanged();
        onClose();
      }
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
      if (res.ok) {
        setShowSuggestions(false);
        fetchDetail();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-[#1B2A4A] px-5 py-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {loading ? (
                <div className="h-5 w-40 bg-white/20 rounded animate-pulse" />
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-white font-semibold truncate">
                      {client ? displayClientName(client.name, client.company) : '—'}
                    </h2>
                    <TypeBadge type={client?.type ?? null} />
                  </div>
                  {client?.company && displayClientName(client.name, client.company) !== client.company && (
                    <p className="text-white/60 text-sm truncate">{client.company}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canEdit && client && (
                <button onClick={() => onEdit(client)} aria-label="Edit client"
                  className="p-2 text-white/60 hover:text-white transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              <button onClick={onClose} aria-label="Close"
                className="p-2 text-white/60 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {client && (client.email || client.phone) && (
            <div className="mt-2 text-sm text-white/70 space-y-0.5">
              {client.email && <p className="truncate">{client.email}</p>}
              {client.phone && <p>{client.phone}</p>}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-8 text-center">
              <p className="text-red-600 font-medium">{error}</p>
            </div>
          )}

          {!error && (
            <>
              {/* Health snapshot — read-only, computed from this client's own orders */}
              {loading ? (
                <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
                  <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-3" />
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-9 bg-gray-200 rounded animate-pulse" />
                    ))}
                  </div>
                </div>
              ) : data?.metrics ? (
                <HealthSnapshot metrics={data.metrics} />
              ) : null}

              {/* Notes — the main event */}
              <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Notes</h3>
                {canEdit && (
                  <div className="mb-4">
                    <textarea
                      value={noteInput}
                      onChange={e => setNoteInput(e.target.value)}
                      rows={3}
                      placeholder="Add a note — met at the mixer, prefers texts…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none
                                 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
                    />
                    <div className="flex justify-end mt-1.5">
                      <button onClick={addNote} disabled={savingNote || !noteInput.trim()}
                        className="h-8 px-3.5 rounded-lg bg-[#F26B2B] text-white text-xs font-medium hover:bg-[#E05A1A] disabled:opacity-40 transition-colors">
                        {savingNote ? 'Adding…' : 'Add note'}
                      </button>
                    </div>
                  </div>
                )}
                {loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : (data?.notes.length ?? 0) === 0 ? (
                  <p className="text-sm text-gray-400">
                    {canEdit ? 'No notes yet — jot down anything worth remembering.' : 'No notes yet.'}
                  </p>
                ) : (
                  <div className="space-y-3">
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

              {/* Business — read-only order history with this rep */}
              <div className="px-5 pt-4 pb-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Business</h3>
                {loading ? (
                  <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
                ) : client?.contactId === null ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">
                      No orders yet — link a transaction contact to see order history.
                    </p>
                    {canEdit && !showSuggestions && (
                      <button onClick={() => setShowSuggestions(true)}
                        className="mt-2.5 h-8 px-3.5 rounded-lg border border-[#F26B2B] text-[#F26B2B] text-xs font-medium hover:bg-[#F26B2B]/5 transition-colors">
                        Find match
                      </button>
                    )}
                    {showSuggestions && (
                      <div className="mt-3 space-y-2 text-left">
                        {(data?.suggestions.length ?? 0) === 0 ? (
                          <p className="text-xs text-gray-400 text-center">
                            No matching transaction contacts found.
                          </p>
                        ) : (
                          data!.suggestions.map(s => (
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
                              <button onClick={() => linkSuggestion(s)} disabled={busy}
                                className="shrink-0 h-8 px-3 rounded-lg bg-[#F26B2B] text-white text-xs font-medium hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
                                Link
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ) : (data?.business.length ?? 0) === 0 ? (
                  <p className="text-sm text-gray-400">No orders together yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data!.business.map(order => (
                      <Link key={order.id}
                        href={`/sales/orders?search=${encodeURIComponent(order.fileNumber)}`}
                        className="block border border-gray-200 rounded-lg px-3 py-2.5 hover:border-[#1B2A4A]/30 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-[#1B2A4A]">{order.fileNumber}</span>
                          <span className="text-xs text-gray-500">{statusLabel(order.operationalStatus)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-xs text-gray-500">
                            {[order.transactionType, fmtDate(order.openedAt)].filter(Boolean).join(' · ')}
                          </span>
                          {order.salesPrice && (
                            <span className="text-xs font-medium text-gray-700">
                              {formatCurrency(Number(order.salesPrice))}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Danger zone */}
              {canEdit && client && (
                <div className="px-5 pb-6">
                  {confirmDelete ? (
                    <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                      <p className="text-sm text-red-700">Delete this client and all their notes?</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={deleteClient} disabled={busy}
                          className="h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
                          {busy ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button onClick={() => setConfirmDelete(false)}
                          className="h-8 px-3 rounded-lg text-xs text-gray-600 hover:bg-gray-100 transition-colors">
                          Cancel
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
