'use client';

import { useState, useEffect } from 'react';

export interface CompanyRecord {
  id?: number;
  name: string;
  companyType: string;
  lookupCode: string;
  /**
   * The form had no address field at all, so every edit sent a blank Address1
   * and SoftPro's UpdateCompany erased the one it held. Prefill it from the
   * stored row on edit.
   */
  address1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  isActive: boolean;
}

const EMPTY: CompanyRecord = { name: '', companyType: '', lookupCode: '', address1: '', city: '', state: '', zip: '', phone: '', email: '', isActive: true };
const TYPE_OPTS = ['Escrow Company', 'Lender', 'Title Company', 'Real Estate', 'Mortgage Broker', 'Other'];

/** The type page a company created with this type also appears on. */
const TYPE_PAGE: Record<string, string> = {
  'Escrow Company': 'Escrow Companies',
  Lender: 'Lender Companies',
  'Real Estate': 'Real Estate Companies',
  'Mortgage Broker': 'Mortgage Companies',
};
const IN = 'w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  company?: CompanyRecord | null;
}

export function CompanyFormModal({ open, onClose, onSuccess, company }: Props) {
  const isEdit = !!company?.id;
  const [form, setForm] = useState<CompanyRecord>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setForm(company ? { ...EMPTY, ...company } : { ...EMPTY }); setError(''); }
  }, [open, company]);

  function set(k: keyof CompanyRecord, v: string | boolean) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) { setError('Company name is required'); return; }
    setSaving(true); setError('');
    try {
      const url = isEdit ? `/api/companies/${company!.id}` : '/api/companies';
      const method = isEdit ? 'PUT' : 'POST';
      // Create reads `address1`; update reads `address`. Send both names.
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, address: form.address1 }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      onSuccess(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">{isEdit ? 'Edit Company' : 'Add Company'}</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {saving && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin" />
              {isEdit ? 'Updating company in SoftPro…' : 'Creating company in SoftPro…'}
            </div>
          )}
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          {/* ONE LIST. On 2026-09-12 Aileen added Private Money Solutions on both
              Companies and Lender Companies, because nothing said they were the
              same list — and nothing said which one the CPL search used. */}
          {!isEdit && (
            <p className="text-xs text-[#6B7280]">
              There is one list of companies.{' '}
              {TYPE_PAGE[form.companyType]
                ? `A company added here also appears on ${TYPE_PAGE[form.companyType]}, so add it once.`
                : 'A company added here also appears on its type page, so add it once.'}
              {form.companyType === 'Lender' && ' Lenders here are what the CPL and Proposed Insured lender search finds.'}
            </p>
          )}
          <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Company Name *</label><input className={IN} value={form.name} onChange={e => set('name', e.target.value)} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Company Type</label>
              <select className={IN} value={form.companyType} onChange={e => set('companyType', e.target.value)}>
                <option value="">Select…</option>
                {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Lookup Code</label><input className={IN} value={form.lookupCode} onChange={e => set('lookupCode', e.target.value)} /></div>
          </div>
          <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Address</label><input className={IN} value={form.address1} onChange={e => set('address1', e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">City</label><input className={IN} value={form.city} onChange={e => set('city', e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">State</label><input className={IN} value={form.state} onChange={e => set('state', e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">ZIP</label><input className={IN} value={form.zip} onChange={e => set('zip', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Phone</label><input className={IN} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Email</label><input type="email" className={IN} value={form.email} onChange={e => set('email', e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#1A1A2E] cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="rounded border-gray-300 accent-[#1B2A4A] h-4 w-4" /> Active
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-[#4B5563] hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-10 bg-[#1B2A4A] text-white rounded-lg text-sm font-semibold hover:bg-[#243658] disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : isEdit ? 'Update Company' : 'Create Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
