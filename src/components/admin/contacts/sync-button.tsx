'use client';

import { useState } from 'react';

interface SyncButtonProps {
  endpoint: string;
  label?: string;
  userType?: string;
  onSuccess?: () => void;
}

export function SyncButton({ endpoint, label = 'Sync from SoftPro', userType, onSuccess }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    setSyncing(true);
    setToast(null);
    const controller = new AbortController();
    const timeoutMs = userType === 'Sales Rep' ? 200_000 : 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: userType ? { 'Content-Type': 'application/json' } : undefined,
        body: userType ? JSON.stringify({ userType }) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Sync failed (${res.status})`);
      const msg = body?.message ?? `Synced ${body?.created ?? 0} new, ${body?.updated ?? 0} updated`;
      setToast({ ok: true, msg });
      onSuccess?.();
    } catch (e) {
      clearTimeout(timeout);
      const msg = e instanceof DOMException && e.name === 'AbortError'
        ? 'Sync timed out — SoftPro may be slow. Try again later.'
        : e instanceof Error ? e.message : 'Sync failed';
      setToast({ ok: false, msg });
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(null), 6000);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={run} disabled={syncing}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-[#1B2A4A] bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors">
        <svg className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {syncing ? (userType === 'Sales Rep' ? 'Syncing Sales Reps — this may take a few minutes...' : 'Syncing…') : label}
      </button>
      {toast && (
        <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${toast.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.msg}
        </span>
      )}
    </div>
  );
}
