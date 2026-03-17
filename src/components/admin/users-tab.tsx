'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SkeletonRow, Pagination } from './shared-table';
import { timeAgo } from '@/components/shared/activity-feed';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface User {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  isActive: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

interface Branch { id: number; code: string; name: string; }
interface ContactResult { id: number; name: string; email: string; company?: string; }

const PAGE_SIZE = 25;

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'cs_admin', label: 'CS Admin' },
  { value: 'open_order_team', label: 'Open Order Team' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'title_officer', label: 'Title Officer' },
  { value: 'escrow_officer', label: 'Escrow Officer' },
  { value: 'client', label: 'Client' },
];

const ROLE_FILTER_OPTIONS = [{ value: '', label: 'All Roles' }, ...ALL_ROLES];

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-800',
  admin: 'bg-indigo-100 text-indigo-800',
  cs_admin: 'bg-purple-100 text-purple-800',
  open_order_team: 'bg-orange-100 text-orange-800',
  sales_rep: 'bg-sky-100 text-sky-800',
  title_officer: 'bg-teal-100 text-teal-800',
  escrow_officer: 'bg-amber-100 text-amber-800',
  client: 'bg-gray-100 text-gray-700',
};

function userStatus(u: User): 'active' | 'invited' | 'disabled' {
  if (!u.isActive) return 'disabled';
  return u.lastSignInAt ? 'active' : 'invited';
}

const STATUS_BADGE: Record<string, { dot: string; text: string; label: string }> = {
  active:   { dot: 'bg-green-500',  text: 'text-green-700', label: 'Active' },
  invited:  { dot: 'bg-amber-500',  text: 'text-amber-700', label: 'Invited' },
  disabled: { dot: 'bg-gray-300',   text: 'text-gray-500',  label: 'Disabled' },
};

/* ── Main Tab ──────────────────────────────────────────────────────────────── */

export function UsersTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('uPage') ?? '1');
  const currentRole = searchParams.get('uRole') ?? '';
  const currentSearch = searchParams.get('uSearch') ?? '';
  const currentActive = searchParams.get('uActive') ?? 'all';

  const [data, setData] = useState<{ users: User[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const buildUrl = useCallback(
    (overrides: Record<string, string | number>) => {
      const params = new URLSearchParams();
      params.set('tab', 'users');
      const page = overrides.uPage ?? currentPage;
      const role = overrides.uRole ?? currentRole;
      const search = overrides.uSearch ?? currentSearch;
      const active = overrides.uActive ?? currentActive;
      if (Number(page) > 1) params.set('uPage', String(page));
      if (role) params.set('uRole', String(role));
      if (search) params.set('uSearch', String(search));
      if (active !== 'all') params.set('uActive', String(active));
      return `/users?${params}`;
    },
    [currentPage, currentRole, currentSearch, currentActive],
  );

  const fetchUsers = useCallback(() => {
    setLoading(true); setError(null);
    const apiParams = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE), active: currentActive });
    if (currentRole) apiParams.set('role', currentRole);
    if (currentSearch) apiParams.set('search', currentSearch);
    fetch(`/api/users?${apiParams}`)
      .then((res) => { if (!res.ok) throw new Error(`Failed (${res.status})`); return res.json(); })
      .then((d) => setData({ users: d.users, total: d.total }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [currentPage, currentRole, currentSearch, currentActive]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { router.push(buildUrl({ uSearch: value, uPage: 1 })); }, 300);
  }

  async function handleSyncUsers() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch('/api/admin/sync-users', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Sync failed');
      setSyncResult(`Found ${body.newUsers ?? 0} new users, updated ${body.updatedUsers ?? 0} existing`);
      fetchUsers();
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : 'Sync failed');
    } finally { setSyncing(false); }
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <>
      {/* Action Bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Invite User
        </button>
        <button onClick={handleSyncUsers} disabled={syncing}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-50 transition-colors">
          <svg className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {syncing ? 'Syncing…' : 'Sync from SoftPro'}
        </button>
        {syncResult && (
          <span className="text-sm text-[#4B5563] bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">{syncResult}</span>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" value={searchInput} onChange={(e) => handleSearchChange(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]" />
        </div>
        <select value={currentRole} onChange={(e) => router.push(buildUrl({ uRole: e.target.value, uPage: 1 }))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]">
          {ROLE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ActiveToggle value={currentActive} onChange={(v) => router.push(buildUrl({ uActive: v, uPage: 1 }))} />
        {data && !loading && <span className="text-sm text-[#6B7280] ml-auto">{data.total} user{data.total !== 1 ? 's' : ''}</span>}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center"><p className="text-red-600 font-medium">{error}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Branch</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Last Sign In</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
                  : data && data.users.length > 0
                    ? data.users.map((u) => {
                        const st = userStatus(u);
                        const badge = STATUS_BADGE[st];
                        return (
                          <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-[#1A1A2E] whitespace-nowrap">{u.displayName || '—'}</td>
                            <td className="px-4 py-3 text-[#6B7280] max-w-[220px] truncate">{u.email ?? '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap"><RoleBadge role={u.role} /></td>
                            <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">
                              {u.branchCode ? <span className="font-mono text-xs">{u.branchCode}</span> : <span className="text-[#6B7280]">—</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <span className={`h-2 w-2 rounded-full ${badge.dot}`} />
                                <span className={badge.text}>{badge.label}</span>
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-xs">
                              {u.lastSignInAt ? timeAgo(u.lastSignInAt) : '—'}
                            </td>
                            <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(u.createdAt)}</td>
                          </tr>
                        );
                      })
                    : null}
              </tbody>
            </table>
            {!loading && data && data.users.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No users found</p>
                <p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters.</p>
              </div>
            )}
          </div>
        )}
        {!loading && !error && data && totalPages > 1 && (
          <Pagination current={currentPage} total={totalPages} count={data.total} pageSize={PAGE_SIZE}
            onChange={(p) => router.push(buildUrl({ uPage: p }))} />
        )}
      </div>

      {/* Invite Modal */}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onSuccess={fetchUsers} />}
    </>
  );
}

/* ── Invite Modal ──────────────────────────────────────────────────────────── */

function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
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
      setResult({ ok: true, message: `Invite sent to ${email}` });
      onSuccess();
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

/* ── Sub-components ────────────────────────────────────────────────────────── */

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{role.replace(/_/g, ' ')}</span>;
}

function ActiveToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [{ value: 'all', label: 'All' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }];
  return (
    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${value === o.value ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}
