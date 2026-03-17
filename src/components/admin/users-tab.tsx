'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SkeletonRow, Pagination } from './shared-table';
import { timeAgo } from '@/components/shared/activity-feed';
import {
  type User, PAGE_SIZE, ROLE_FILTER_OPTIONS, userStatus, STATUS_BADGE,
  RoleBadge, ActiveToggle, formatDate,
} from './users/users-table';
import { InviteModal } from './users/invite-modal';

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
        {syncResult && <span className="text-sm text-[#4B5563] bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">{syncResult}</span>}
      </div>

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
                            <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-xs">{u.lastSignInAt ? timeAgo(u.lastSignInAt) : '—'}</td>
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

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onSuccess={fetchUsers} />}
    </>
  );
}
