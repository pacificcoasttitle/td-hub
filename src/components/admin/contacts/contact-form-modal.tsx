'use client';

import { useState, useEffect } from 'react';

export interface ContactRecord {
  id?: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cell: string;
  companyName: string;
  city: string;
  state: string;
  licenseNo: string;
  contactType: string;
  isActive: boolean;
}

const EMPTY: ContactRecord = { firstName: '', lastName: '', email: '', phone: '', cell: '', companyName: '', city: '', state: '', licenseNo: '', contactType: '', isActive: true };

const TYPE_OPTIONS = [
  { value: 'title_officer', label: 'Title Officer' },
  { value: 'escrow_officer', label: 'Escrow Officer' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'real_estate_agent', label: 'Real Estate Agent' },
  { value: 'escrow', label: 'Escrow Company Contact' },
  { value: 'lender', label: 'Lender' },
  { value: 'mortgage_broker', label: 'Mortgage Broker' },
];

const IN = 'w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contact?: ContactRecord | null;
  defaultType?: string;
}

export function ContactFormModal({ open, onClose, onSuccess, contact, defaultType }: Props) {
  const isEdit = !!contact?.id;
  const [form, setForm] = useState<ContactRecord>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(contact ? { ...EMPTY, ...contact } : { ...EMPTY, contactType: defaultType ?? '' });
      setError('');
    }
  }, [open, contact, defaultType]);

  function set(k: keyof ContactRecord, v: string | boolean) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName && !form.lastName) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const url = isEdit ? `/api/contacts/${contact!.id}` : '/api/contacts';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">{isEdit ? 'Edit Contact' : 'Add Contact'}</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {saving && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin" />
              {isEdit ? 'Updating contact in SoftPro…' : 'Creating contact in SoftPro…'}
            </div>
          )}
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">First Name</label><input className={IN} value={form.firstName} onChange={e => set('firstName', e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Last Name</label><input className={IN} value={form.lastName} onChange={e => set('lastName', e.target.value)} /></div>
          </div>
          <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Email</label><input type="email" className={IN} value={form.email} onChange={e => set('email', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Phone</label><input className={IN} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Cell</label><input className={IN} value={form.cell} onChange={e => set('cell', e.target.value)} /></div>
          </div>
          <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">Company</label><input className={IN} value={form.companyName} onChange={e => set('companyName', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">City</label><input className={IN} value={form.city} onChange={e => set('city', e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">State</label><input className={IN} value={form.state} onChange={e => set('state', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-[#1A1A2E] mb-1">License #</label><input className={IN} value={form.licenseNo} onChange={e => set('licenseNo', e.target.value)} /></div>
            <div>
              <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Contact Type</label>
              <select className={IN} value={form.contactType} onChange={e => set('contactType', e.target.value)}>
                <option value="">Select…</option>
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#1A1A2E] cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="rounded border-gray-300 accent-[#1B2A4A] h-4 w-4" /> Active
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-[#4B5563] hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-10 bg-[#1B2A4A] text-white rounded-lg text-sm font-semibold hover:bg-[#243658] disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : isEdit ? 'Update Contact' : 'Create Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
