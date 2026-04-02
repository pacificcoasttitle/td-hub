'use client';

import { useEffect, useState } from 'react';

interface StaffOption { id: number; name: string }

export interface OfficerTarget {
  companyId: number;
  companyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  salesRepId: number | null;
  titleOfficerId: number | null;
  loanUnderwriter: string | null;
  salesUnderwriter: string | null;
}

interface Props {
  open: boolean;
  target: OfficerTarget | null;
  salesReps: StaffOption[];
  titleOfficers: StaffOption[];
  onClose: () => void;
  onSuccess: () => void;
}

const IN = 'w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]';
const LBL = 'block text-xs font-medium text-[#1A1A2E] mb-1';

export function CompanyOfficerModal({ open, target, salesReps, titleOfficers, onClose, onSuccess }: Props) {
  const [repId, setRepId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [loanUw, setLoanUw] = useState('');
  const [salesUw, setSalesUw] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && target) {
      setRepId(target.salesRepId);
      setToId(target.titleOfficerId);
      setLoanUw(target.loanUnderwriter ?? '');
      setSalesUw(target.salesUnderwriter ?? '');
      setRepFilter('');
      setToFilter('');
      setError('');
    }
  }, [open, target]);

  async function handleSave() {
    if (!target) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/companies/${target.companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salesRepId: repId,
          titleOfficerId: toId,
          loanUnderwriter: loanUw || null,
          salesUnderwriter: salesUw || null,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? 'Save failed'); }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  if (!open || !target) return null;

  const filteredReps = repFilter
    ? salesReps.filter(s => s.name.toLowerCase().includes(repFilter.toLowerCase()))
    : salesReps;
  const filteredTOs = toFilter
    ? titleOfficers.filter(s => s.name.toLowerCase().includes(toFilter.toLowerCase()))
    : titleOfficers;

  const addressLine = [target.address, target.city, [target.state, target.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Read-only company summary */}
        <div className="px-8 py-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#1B2A4A]">{target.companyName}</h2>
          {addressLine && <p className="text-sm text-[#6B7280] mt-1">{addressLine}</p>}
          {(target.phone || target.email) && (
            <p className="text-sm text-[#6B7280]">{[target.phone, target.email].filter(Boolean).join(' · ')}</p>
          )}
          <p className="text-xs text-gray-400 italic mt-1.5">Synced from SoftPro</p>
        </div>

        <div className="px-8 py-6 space-y-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Officer Assignments</p>

          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

          <div>
            <label className={LBL}>Sales Rep</label>
            <input type="text" placeholder="Filter reps…" value={repFilter} onChange={e => setRepFilter(e.target.value)}
              className="w-full h-8 px-3 mb-1 border border-gray-200 rounded text-xs placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#1B2A4A]" />
            <select className={IN} value={repId ?? ''} onChange={e => setRepId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— None —</option>
              {filteredReps.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className={LBL}>Title Officer</label>
            <input type="text" placeholder="Filter officers…" value={toFilter} onChange={e => setToFilter(e.target.value)}
              className="w-full h-8 px-3 mb-1 border border-gray-200 rounded text-xs placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#1B2A4A]" />
            <select className={IN} value={toId ?? ''} onChange={e => setToId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— None —</option>
              {filteredTOs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className={LBL}>Loan Underwriter</label>
            <input className={IN} value={loanUw} onChange={e => setLoanUw(e.target.value)} placeholder="Enter name…" />
          </div>

          <div>
            <label className={LBL}>Sales Underwriter</label>
            <input className={IN} value={salesUw} onChange={e => setSalesUw(e.target.value)} placeholder="Enter name…" />
          </div>
        </div>

        <div className="px-8 py-5 border-t border-gray-200 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-[#4B5563] hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 h-10 bg-[#F26B2B] text-white rounded-lg text-sm font-semibold hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save Assignments'}
          </button>
        </div>
      </div>
    </div>
  );
}
