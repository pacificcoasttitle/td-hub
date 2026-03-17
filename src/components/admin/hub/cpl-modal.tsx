'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';

const UNDERWRITERS = [
  { value: 'westcor', label: 'Westcor', color: '#1B2A4A' },
  { value: 'fnf', label: 'FNF', color: '#2D5F2D' },
  { value: 'natic', label: 'NATIC', color: '#5A2D1B' },
];

interface Branch { id: number; code: string; name: string; }

export function CplModal({ open, onClose, orderId, fileNumber, address }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
}) {
  const [underwriter, setUnderwriter] = useState('');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; docId?: number; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setUnderwriter(''); setBranchId(null); setResult(null);
    fetch('/api/branches').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.branches) setBranches(d.branches);
    }).catch(() => {});
  }, [open]);

  async function generate() {
    if (!underwriter || !branchId) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/vendor-actions/cpl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, underwriter, branchId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Generation failed');
      setResult({ ok: true, docId: body.documentId });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Generate CPL" subtitle={`${fileNumber} · ${address}`}>
      <div className="p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Underwriter</p>
          <div className="grid grid-cols-3 gap-2">
            {UNDERWRITERS.map((u) => (
              <button
                key={u.value}
                onClick={() => setUnderwriter(u.value)}
                className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                  underwriter === u.value
                    ? 'border-[#C5A55A] bg-[#C5A55A]/10 text-[#1A1A2E]'
                    : 'border-gray-200 text-[#4B5563] hover:border-gray-300'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Branch</p>
          <select
            value={branchId ?? ''}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
            className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#C5A55A]/30 focus:border-[#C5A55A] outline-none"
          >
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>

        {result && (
          <div className={`px-3 py-2 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {result.ok ? (
              <span>CPL generated. <a href={`/api/documents/${result.docId}/download`} className="underline font-medium">Download</a></span>
            ) : result.error}
          </div>
        )}

        <button
          onClick={generate}
          disabled={!underwriter || !branchId || generating}
          className="w-full h-10 bg-[#C5A55A] text-white text-sm font-medium rounded-lg hover:bg-[#B8953D] disabled:opacity-50 transition-colors"
        >
          {generating ? 'Generating…' : 'Generate CPL'}
        </button>
      </div>
    </ModalShell>
  );
}
