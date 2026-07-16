'use client';

import { useEffect, useRef, useState } from 'react';
import { ALL_ROLES } from './users-table';

interface Branch { id: number; code: string; name: string; }
interface ContactResult { id: number; name: string; email: string; company?: string; }

export function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('client');
  const [branchId, setBranchId] = useState('');
  const [contactId, setContactId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<ContactResult[]>([]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch('/api/branches').then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.branches) setBranches(d.branches); }).catch(() => {});
  }, []);

  function handleContactSearch(v: string) {
    setContactSearch(v);
    clearTimeout(debRef.current);
    if (v.length < 2) { setContactResults([]); return; }
    debRef.current = setTimeout(() => {
      fetch(`/api/contacts/search?q=${encodeURIComponent(v)}`)
        .then(r => r.ok ? r.json() : { results: [] })
        .then(d => setContactResults(d.results ?? d.contacts ?? []))
        .catch(() => setContactResults([]));
    }, 250);
  }

  function selectContact(c: ContactResult) {
    setContactId(c.id);
    setContactSearch(`${c.name} (${c.email})`);
    setContactResults([]);
    if (!email) setEmail(c.email);
    if (!displayName) setDisplayName(c.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !displayName) return;
    setSending(true); setResult(null);
    try {
      const res = await fetch('/api/admin/invite-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName, role, branchId: branchId || undefined, contactId: contactId || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Failed to send invite');
      onSuccess();
      onClose();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Failed' });
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Invite User</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Email *</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1B2A4A] focus:ring-1 focus:ring-[#1B2A4A]/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Display Name *</label>
            <input type="text" required value={displayName} onChange={e => setDisplayName(e.target.value)}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1B2A4A] focus:ring-1 focus:ring-[#1B2A4A]/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1B2A4A] focus:ring-1 focus:ring-[#1B2A4A]/20">
              {ALL_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Branch <span className="text-[#9CA3AF]">(optional)</span></label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1B2A4A] focus:ring-1 focus:ring-[#1B2A4A]/20">
              <option value="">No branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Link to Contact <span className="text-[#9CA3AF]">(optional)</span></label>
            <input type="text" value={contactSearch} onChange={e => handleContactSearch(e.target.value)}
              placeholder="Search existing contacts…"
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1B2A4A] focus:ring-1 focus:ring-[#1B2A4A]/20" />
            {contactResults.length > 0 && (
              <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {contactResults.map(c => (
                  <button key={c.id} type="button" onClick={() => selectContact(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    <span className="font-medium text-[#1A1A2E]">{c.name}</span>
                    <span className="text-[#6B7280] ml-2">{c.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {result && (
            <div className={`px-3 py-2 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {result.message}
            </div>
          )}

          <button type="submit" disabled={sending || !email || !displayName}
            className="w-full h-10 bg-[#1B2A4A] text-white text-sm font-semibold rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors">
            {sending ? 'Sending Invite…' : 'Send Invite'}
          </button>
        </form>
      </div>
    </div>
  );
}
