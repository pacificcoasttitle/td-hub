'use client';

import { useState } from 'react';

const COMPANY_TYPES = [
  'Escrow Company',
  'Lender',
  'Mortgage Broker',
  'Underwriter',
];

interface Props {
  onSuccess?: () => void;
}

export function CompanySyncAllButton({ onSuccess }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    setSyncing(true);
    setToast(null);
    let totalCreated = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const userType of COMPANY_TYPES) {
      try {
        const res = await fetch('/api/contacts/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userType }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          errors.push(`${userType}: ${body?.error ?? res.status}`);
          continue;
        }
        totalCreated += body?.created ?? 0;
        totalUpdated += body?.updated ?? 0;
      } catch (e) {
        errors.push(`${userType}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }

    const msg = errors.length > 0
      ? `Partial sync: ${totalCreated} new, ${totalUpdated} updated. ${errors.length} error(s).`
      : `Synced all company types: ${totalCreated} new, ${totalUpdated} updated`;
    setToast({ ok: errors.length === 0, msg });
    onSuccess?.();
    setSyncing(false);
    setTimeout(() => setToast(null), 6000);
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={run} disabled={syncing}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-[#1B2A4A] bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors">
        <svg className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {syncing ? 'Syncing all…' : 'Sync All Companies'}
      </button>
      {toast && (
        <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${toast.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.msg}
        </span>
      )}
    </div>
  );
}
