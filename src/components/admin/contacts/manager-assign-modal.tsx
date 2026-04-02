'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Rep {
  id: number;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  managerId?: number | null;
}

interface Props {
  open: boolean;
  managerId: number;
  managerName: string;
  onClose: () => void;
  onSuccess: () => void;
}

function repName(r: Rep) {
  return r.fullName || [r.firstName, r.lastName].filter(Boolean).join(' ') || `Rep #${r.id}`;
}

export function ManagerAssignModal({ open, managerId, managerName, onClose, onSuccess }: Props) {
  const [allReps, setAllReps] = useState<Rep[]>([]);
  const [loadingReps, setLoadingReps] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setLoadingReps(true);
    fetch('/api/contacts?type=sales_rep&pageSize=500&active=true&sort=firstName&order=asc')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const reps: Rep[] = d?.contacts ?? [];
        setAllReps(reps);
        setSelected(new Set(reps.filter(r => r.managerId === managerId && r.id !== managerId).map(r => r.id)));
      })
      .catch(() => setAllReps([]))
      .finally(() => setLoadingReps(false));
  }, [open, managerId]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const grouped = useMemo(() => {
    const available = allReps
      .filter((r) => r.id !== managerId)
      .filter((r) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return repName(r).toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q);
      })
      .sort((a, b) => repName(a).localeCompare(repName(b)));

    const map = new Map<string, Rep[]>();
    for (const r of available) {
      const letter = (repName(r)[0] ?? '#').toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(r);
    }
    return Array.from(map.entries());
  }, [allReps, managerId, filter]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${managerId}/manager`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repIds: [...selected] }),
      });
      if (res.ok) { onSuccess(); onClose(); }
    } finally { setSaving(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-8 py-5 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-[#1A1A2E]">Assign Reps to {managerName}</h3>
          <p className="text-sm text-[#6B7280] mt-1">Select which reps report to this manager</p>
        </div>

        <div className="px-8 pt-4 pb-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter reps…"
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-4">
          {loadingReps ? (
            <p className="text-sm text-[#6B7280] text-center py-8">Loading reps…</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-[#6B7280] text-center py-8">{filter ? 'No matching reps' : 'No other sales reps available'}</p>
          ) : grouped.map(([letter, reps]) => (
            <div key={letter} className="mt-3">
              <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-1.5">{letter}</p>
              <div className="space-y-1">
                {reps.map((r) => (
                  <label key={r.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]" />
                    <div className="min-w-0">
                      <span className="text-sm text-[#1A1A2E] block">{repName(r)}</span>
                      {r.email && <span className="text-xs text-[#9CA3AF] block truncate">{r.email}</span>}
                    </div>
                    {r.managerId && r.managerId !== managerId && (
                      <span className="text-[10px] text-[#9CA3AF] ml-auto shrink-0 mt-0.5">
                        Under: {allReps.find((m) => m.id === r.managerId)?.fullName ?? `#${r.managerId}`}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-8 py-5 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-[#6B7280]">{selected.size} rep{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors">Cancel</button>
            <button onClick={save} disabled={saving || loadingReps}
              className="px-5 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save Assignments'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
