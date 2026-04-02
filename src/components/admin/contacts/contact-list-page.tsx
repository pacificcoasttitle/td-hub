'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncButton } from './sync-button';
import { ContactFormModal, type ContactRecord } from './contact-form-modal';
import { ManagerAssignModal } from './manager-assign-modal';

interface Contact {
  id: number;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  cell: string | null;
  roles: string[];
  sourceSystem: string | null;
  isActive: boolean;
  city: string | null;
  state: string | null;
  licenseNo: string | null;
  contactType?: string | null;
  managerId?: number | null;
  managerName?: string | null;
  managedRepCount?: number;
  profileRole?: string | null;
}

interface Props {
  title: string;
  subtitle: string;
  typeFilter: string;
  showCompanyColumn?: boolean;
  showManagerColumn?: boolean;
  readOnly?: boolean;
}

const SYNC_USER_TYPE: Record<string, string> = {
  title_officer: 'Title Officer', escrow_officer: 'Escrow Officer', sales_rep: 'Sales Rep',
  agent: 'Selling Agent/Broker', escrow: 'Escrow Company', lender: 'Lender', mortgage_broker: 'Mortgage Broker',
};

const PAGE_SIZE = 25;

function cName(c: Contact) {
  return c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
}

export function ContactListPage({ title, subtitle, typeFilter, showCompanyColumn = true, showManagerColumn = false, readOnly = false }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<ContactRecord | null>(null);
  const [mgrModalOpen, setMgrModalOpen] = useState(false);
  const [mgrTarget, setMgrTarget] = useState<{ id: number; name: string } | null>(null);
  const [togglingMgr, setTogglingMgr] = useState<number | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchCount = useRef(0);

  const fetchContacts = useCallback(() => {
    const id = ++fetchCount.current;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), active: activeFilter, sort: 'firstName', order: 'asc' });
    if (typeFilter) p.set('type', typeFilter);
    if (search) p.set('search', search);
    fetch(`/api/contacts?${p}`)
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then(d => { if (id === fetchCount.current) { setContacts(d.contacts ?? []); setTotal(d.total ?? 0); } })
      .catch(e => { if (id === fetchCount.current) setError(e.message); })
      .finally(() => { if (id === fetchCount.current) setLoading(false); });
  }, [page, search, activeFilter, typeFilter]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  function handleSearch(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 300);
  }

  function openEdit(c: Contact) {
    setEditContact({
      id: c.id, firstName: c.firstName ?? '', lastName: c.lastName ?? '',
      email: c.email ?? '', phone: c.phone ?? '', cell: c.cell ?? '',
      companyName: c.companyName ?? '', city: c.city ?? '', state: c.state ?? '',
      licenseNo: c.licenseNo ?? '', contactType: c.contactType ?? typeFilter, isActive: c.isActive,
    });
    setModalOpen(true);
  }

  function openMgrModal(c: Contact) {
    setMgrTarget({ id: c.id, name: cName(c) });
    setMgrModalOpen(true);
  }

  async function toggleManager(c: Contact, makeManager: boolean) {
    if (!makeManager) {
      const count = c.managedRepCount ?? 0;
      if (count > 0 && !confirm(`This will unassign ${count} rep${count !== 1 ? 's' : ''} from this manager. Continue?`)) return;
    }
    setTogglingMgr(c.id);
    try {
      const res = await fetch(`/api/contacts/${c.id}/manager`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isManager: makeManager }),
      });
      if (res.ok) {
        fetchContacts();
        if (makeManager) openMgrModal(c);
      }
    } finally { setTogglingMgr(null); }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isManager = (c: Contact) => (c.managedRepCount ?? 0) > 0 || c.profileRole === 'sales_manager';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">{title}</h1>
          <p className="text-sm text-[#6B7280] mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {showManagerColumn && (
            <button onClick={() => { const first = contacts.find((c) => isManager(c)); if (first) openMgrModal(first); }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-[#1A1A2E] rounded-lg hover:bg-gray-50 transition-colors">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Manage Teams
            </button>
          )}
          <SyncButton endpoint="/api/contacts/sync" userType={SYNC_USER_TYPE[typeFilter]} onSuccess={fetchContacts} />
          {!readOnly && (
            <button onClick={() => { setEditContact(null); setModalOpen(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add New
            </button>
          )}
        </div>
      </div>

      {readOnly && <p className="text-sm text-gray-400 italic mb-4">Contact information synced from SoftPro</p>}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" value={searchInput} onChange={e => handleSearch(e.target.value)} placeholder="Search name, email, company…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] bg-white" />
        </div>
        <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
          {[{ v: 'true', l: 'Active' }, { v: 'false', l: 'Inactive' }, { v: 'all', l: 'All' }].map(o => (
            <button key={o.v} onClick={() => { setActiveFilter(o.v); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${activeFilter === o.v ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
              {o.l}
            </button>
          ))}
        </div>
        {!loading && <span className="text-sm text-[#6B7280] ml-auto">{total} contact{total !== 1 ? 's' : ''}</span>}
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
                  {showCompanyColumn && <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Company</th>}
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Phone</th>
                  {showManagerColumn && <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Manager</th>}
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Status</th>
                  {!readOnly && <th className="px-4 py-3 w-16" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                  ))}</tr>
                )) : contacts.length > 0 ? contacts.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{cName(c)}</span>
                        {showManagerColumn && isManager(c) && (
                          <span className="bg-[#1B2A4A] text-white text-xs px-2 py-0.5 rounded-full font-medium">
                            Manager{(c.managedRepCount ?? 0) > 0 ? ` (${c.managedRepCount} rep${c.managedRepCount !== 1 ? 's' : ''})` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    {showCompanyColumn && <td className="px-4 py-3 text-gray-900 max-w-[180px] truncate">{c.companyName ?? '—'}</td>}
                    <td className="px-4 py-3 text-[#6B7280] max-w-[200px] truncate">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{c.phone ?? c.cell ?? '—'}</td>
                    {showManagerColumn && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-[#6B7280]">{c.managerName ?? '—'}</span>
                          {isManager(c) && (
                            <button onClick={() => openMgrModal(c)} title="Manage team"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1B2A4A]/10 text-[#1B2A4A] text-xs font-medium hover:bg-[#1B2A4A]/20 transition-colors">
                              {c.managedRepCount} rep{c.managedRepCount !== 1 ? 's' : ''}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c.sourceSystem === 'softpro' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                        {c.sourceSystem === 'softpro' ? 'SoftPro' : 'Manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${c.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {!readOnly && (
                      <td className="px-4 py-3">
                        <button onClick={() => openEdit(c)} className="opacity-0 group-hover:opacity-100 text-[#6B7280] hover:text-[#1B2A4A] transition-all" title="Edit">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      </td>
                    )}
                    {readOnly && showManagerColumn && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        {togglingMgr === c.id ? (
                          <span className="text-xs text-[#6B7280]">…</span>
                        ) : isManager(c) ? (
                          <button onClick={() => toggleManager(c, false)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium opacity-0 group-hover:opacity-100 transition-all">
                            Remove Manager
                          </button>
                        ) : (
                          <button onClick={() => toggleManager(c, true)}
                            className="text-xs text-[#1B2A4A] hover:text-[#F26B2B] font-medium opacity-0 group-hover:opacity-100 transition-all">
                            Make Manager
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )) : null}
              </tbody>
            </table>
            {!loading && contacts.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No contacts found</p>
                <p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters.</p>
              </div>
            )}
          </div>
        )}
        {!loading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
            <p className="text-sm text-[#6B7280]">
              Showing <span className="font-medium text-[#1A1A2E]">{(page - 1) * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-[#1A1A2E]">{Math.min(page * PAGE_SIZE, total)}</span> of{' '}
              <span className="font-medium text-[#1A1A2E]">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm rounded-md transition-colors text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">‹ Prev</button>
              <span className="text-xs text-[#6B7280] px-2">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm rounded-md transition-colors text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">Next ›</button>
            </div>
          </div>
        )}
      </div>

      {!readOnly && (
        <ContactFormModal open={modalOpen} onClose={() => setModalOpen(false)} onSuccess={fetchContacts}
          contact={editContact} defaultType={typeFilter} />
      )}
      {showManagerColumn && mgrTarget && (
        <ManagerAssignModal open={mgrModalOpen} managerId={mgrTarget.id} managerName={mgrTarget.name}
          onClose={() => setMgrModalOpen(false)} onSuccess={fetchContacts} />
      )}
    </div>
  );
}
