'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/shared/action-modals/modal-shell';
import { CRM_CLIENT_TYPES, CRM_TYPE_LABEL } from '@/lib/domain/crm/types';
import type { ContactSuggestion, CrmClient } from './types';

interface Props {
  /** null = add mode; a client = edit mode. */
  client: CrmClient | null;
  onClose: () => void;
  onSaved: () => void;
}

const INPUT_CLS = 'w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]';

export function ClientFormModal({ client, onClose, onSaved }: Props) {
  const [name, setName] = useState(client?.name ?? '');
  const [company, setCompany] = useState(client?.company ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [type, setType] = useState(client?.type ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful add, PR1 may suggest transaction contacts to link.
  const [suggestFor, setSuggestFor] = useState<{ id: number; suggestions: ContactSuggestion[] } | null>(null);
  const [linking, setLinking] = useState(false);

  const isEdit = client !== null;

  async function save() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        type: type || null,
      };
      const res = await fetch(isEdit ? `/api/sales/clients/${client.id}` : '/api/sales/clients', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409) {
        setError(data?.error ?? 'A client with this email is already in your list');
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong — please try again');
        return;
      }
      if (!isEdit && data?.suggestions?.length > 0) {
        setSuggestFor({ id: data.client.id, suggestions: data.suggestions });
        return; // show the "same person?" card before closing
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function linkSuggestion(contactId: number) {
    if (!suggestFor) return;
    setLinking(true);
    try {
      await fetch(`/api/sales/clients/${suggestFor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
    } finally {
      setLinking(false);
      onSaved();
    }
  }

  return (
    <ModalShell open onClose={onClose} title={isEdit ? 'Edit client' : 'Add client'}>
      <div className="p-5">
        {suggestFor ? (
          <div>
            <p className="text-sm font-medium text-gray-900">
              {name.trim()} was added
              <span className="ml-1.5 inline-block align-middle text-[#F26B2B]">✓</span>
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Is this the same person? Linking shows the orders you&rsquo;ve done together.
            </p>
            <div className="mt-3 space-y-2">
              {suggestFor.suggestions.map(s => (
                <div key={s.id}
                  className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.fullName ?? s.email ?? 'Unnamed contact'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[s.companyName, s.email].filter(Boolean).join(' · ') || 'from transactions'}
                    </p>
                  </div>
                  <button onClick={() => linkSuggestion(s.id)} disabled={linking}
                    className="shrink-0 h-8 px-3 rounded-lg bg-[#F26B2B] text-white text-xs font-medium hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
                    Link to transactions
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={onSaved} disabled={linking}
                className="h-9 px-4 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                Skip for now
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} className={INPUT_CLS}
                placeholder="Jane Smith" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
              <input value={company} onChange={e => setCompany(e.target.value)} className={INPUT_CLS}
                placeholder="Keller Williams" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} className={INPUT_CLS}
                type="email" placeholder="jane@example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className={INPUT_CLS}
                type="tel" placeholder="(714) 555-0100" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className={`${INPUT_CLS} cursor-pointer pr-8`}>
                <option value="">Not set</option>
                {CRM_CLIENT_TYPES.map(t => (
                  <option key={t} value={t}>{CRM_TYPE_LABEL[t]}</option>
                ))}
              </select>
              {!isEdit && (
                <p className="text-xs text-gray-400 mt-1">
                  Filled in automatically when you link them to transactions.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose}
                className="h-9 px-4 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="h-9 px-4 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add client'}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
