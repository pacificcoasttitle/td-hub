'use client';

import { useCallback, useEffect, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { ModalShell } from '@/components/shared/action-modals/modal-shell';

interface TransactionClient {
  contactId: number;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  orderCount: number;
  lastOrderAt: string | null;
}

interface Props {
  onClose: () => void;
  /** Called after clients are added so the list refreshes. */
  onAdded: () => void;
}

const PAGE_SIZE = 25;

const ROLE_LABELS: Record<string, string> = {
  client: 'Client',
  buyer_agent: 'Buyer agent',
  listing_agent: 'Listing agent',
  lender: 'Lender',
  lender_contact: 'Lender contact',
  escrow_company: 'Escrow',
  buyer: 'Buyer',
  seller: 'Seller',
  borrower: 'Borrower',
  other: 'Other',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}

function fmtLastOrder(iso: string | null): string {
  if (!iso) return '';
  return ` · last ${new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

export function AddFromTransactionsModal({ onClose, onAdded }: Props) {
  const [rows, setRows] = useState<TransactionClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);

  const fetchSuggestions = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/sales/clients/from-transactions?page=${page}&pageSize=${PAGE_SIZE}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(d => { setRows(d.suggestions ?? []); setTotal(d.total ?? 0); })
      .catch(() => setError('Couldn’t load your transaction contacts'))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  function toggle(contactId: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function add(contactIds: number[]) {
    if (contactIds.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/sales/clients/from-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Couldn’t add those clients — please try again');
        return;
      }
      setAddedCount((prev) => (prev ?? 0) + (data?.added ?? 0));
      setSelected(new Set());
      onAdded();
      fetchSuggestions();
    } finally {
      setBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <ModalShell open onClose={onClose} size="wide"
      title="Add clients from your transactions"
      subtitle={total > 0 ? `${total} ${total === 1 ? 'person' : 'people'} you've done deals with` : undefined}>
      <div className="p-5">
        <p className="text-sm text-gray-600 mb-4">
          These are people from your own closed and open orders who aren&rsquo;t in your list yet.
          Pick the ones you want — their order history shows up right away.
        </p>

        {addedCount !== null && addedCount > 0 && (
          <p className="mb-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Added {addedCount} {addedCount === 1 ? 'client' : 'clients'} to your list.
          </p>
        )}

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <Briefcase className="h-6 w-6 text-gray-300 mx-auto mb-2" />
            <p className="text-[#1A1A2E] font-medium">
              {addedCount ? 'That’s everyone' : 'Nothing to add right now'}
            </p>
            <p className="text-sm text-[#6B7280] mt-1">
              You&rsquo;ve added everyone you&rsquo;ve done business with.
            </p>
          </div>
        ) : (
          <>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[45vh] overflow-y-auto">
              {rows.map(row => {
                const isSelected = selected.has(row.contactId);
                return (
                  <div key={row.contactId}
                    className={`flex items-center gap-3 px-3 py-2.5 ${isSelected ? 'bg-[#F26B2B]/5' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(row.contactId)}
                      aria-label={`Select ${row.name ?? 'contact'}`}
                      className="h-4 w-4 shrink-0 accent-[#F26B2B] cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {row.name ?? row.email ?? 'Unnamed contact'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {[row.company, row.email].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    {/* Order count is the whole basis for the rep's decision —
                        it stays visible on phones; only the roles line drops. */}
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium text-[#1B2A4A] whitespace-nowrap">
                        {row.orderCount} order{row.orderCount === 1 ? '' : 's'}
                        <span className="hidden sm:inline">{fmtLastOrder(row.lastOrderAt)}</span>
                      </p>
                      <p className="text-xs text-gray-400 truncate max-w-[180px] hidden sm:block">
                        {row.roles.map(roleLabel).join(', ')}
                      </p>
                    </div>
                    <button onClick={() => add([row.contactId])} disabled={busy}
                      className="shrink-0 h-8 px-3 rounded-lg border border-[#F26B2B] text-[#F26B2B] text-xs font-medium
                                 hover:bg-[#F26B2B]/5 disabled:opacity-40 transition-colors">
                      Add
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {totalPages > 1 && (
                  <>
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                      className="h-8 px-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:text-gray-300 transition-colors">
                      ‹ Prev
                    </button>
                    <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                      className="h-8 px-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:text-gray-300 transition-colors">
                      Next ›
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={onClose}
                  className="h-9 px-4 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                  Done
                </button>
                <button onClick={() => add(Array.from(selected))} disabled={busy || selected.size === 0}
                  className="h-9 px-4 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] disabled:opacity-40 transition-colors">
                  {busy ? 'Adding…' : `Add selected${selected.size > 0 ? ` (${selected.size})` : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
