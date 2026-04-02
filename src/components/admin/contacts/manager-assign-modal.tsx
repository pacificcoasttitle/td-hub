'use client';

import { useCallback, useEffect, useState } from 'react';

interface Rep { id: number; fullName: string | null; firstName: string | null; lastName: string | null; managerId?: number | null; }
interface Props { open: boolean; managerId: number; managerName: string; onClose: () => void; onSuccess: () => void; allReps: Rep[]; }

export function ManagerAssignModal({ open, managerId, managerName, onClose, onSuccess, allReps }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set(allReps.filter((r) => r.managerId === managerId && r.id !== managerId).map((r) => r.id)));
    }
  }, [open, managerId, allReps]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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

  const name = (r: Rep) => r.fullName || [r.firstName, r.lastName].filter(Boolean).join(' ') || `Rep #${r.id}`;
  const available = allReps.filter((r) => r.id !== managerId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-[#1A1A2E]">Assign Reps to {managerName}</h3>
          <p className="text-sm text-[#6B7280] mt-1">Select which reps report to this manager</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {available.length === 0 ? (
            <p className="text-sm text-[#6B7280] text-center py-8">No other sales reps available</p>
          ) : available.map((r) => (
            <label key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                className="h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]" />
              <span className="text-sm text-[#1A1A2E]">{name(r)}</span>
              {r.managerId && r.managerId !== managerId && (
                <span className="text-xs text-[#6B7280] ml-auto">
                  Currently under: {allReps.find((m) => m.id === r.managerId)?.fullName ?? `#${r.managerId}`}
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-[#6B7280]">{selected.size} rep{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save Assignments'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
