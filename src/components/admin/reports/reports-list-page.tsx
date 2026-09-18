'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REPORTS_PAGE_SIZE,
  type ReportListRow,
  type ReportFilter,
} from '@/lib/domain/reports/list-types';

// ─── Reports ────────────────────────────────────────────────────────────────
//
// One table over four report types. The structure is the company-type list page
// — the same wrapper, search, segmented filter, card, head, body and pager — so
// this reads as another page of the same application rather than a new idea.
//
// TWO DEPARTURES, BOTH DELIBERATE
//
// 1. The filter is All / Farming / Concierge. Active / Inactive is meaningless
//    for a report: one was produced, and it exists.
//
// 2. Subject and Settings are TWO columns, never merged. Subject is always the
//    place or property an agent recognises; Settings is always the parameters
//    that built it. That separation is what lets one table hold four types.
//
// LAYOUT: table-layout:fixed with declared widths. With seven columns, `auto`
// lets an un-wrappable subject push Actions off-screen — which is a row whose
// only action cannot be reached.
//
// DELIVERY: reads the log through the API. "Never sent" is grey and says so;
// it must never look like success, which is the failure this whole column
// exists to make visible.

const COLUMN_WIDTHS = ['18%', '22%', '20%', '13%', '10%', '9%', '8%'];

interface Props {
  /** Concierge is the only type that can be created today. */
  onNewReport: () => void;
  /** Bumped when a report is created, so the new row appears without a reload. */
  reloadToken?: number;
}

export function ReportsListPage({ onNewReport, reloadToken = 0 }: Props) {
  const [rows, setRows] = useState<ReportListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchCount = useRef(0);

  const fetchReports = useCallback(() => {
    const id = ++fetchCount.current;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ page: String(page), pageSize: String(REPORTS_PAGE_SIZE), type: filter });
    if (search) p.set('search', search);
    fetch(`/api/reports?${p}`)
      .then((r) => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then((d) => { if (id === fetchCount.current) { setRows(d.rows ?? []); setTotal(d.total ?? 0); } })
      .catch((e: Error) => { if (id === fetchCount.current) setError(e.message); })
      .finally(() => { if (id === fetchCount.current) setLoading(false); });
  }, [page, search, filter]);

  useEffect(() => { fetchReports(); }, [fetchReports, reloadToken]);

  function handleSearch(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 300);
  }

  const totalPages = Math.ceil(total / REPORTS_PAGE_SIZE);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Reports</h1>
          <p className="text-sm text-[#6B7280] mt-1">Farming reports and property profiles, with who each one is branded to.</p>
        </div>
        <button
          onClick={onNewReport}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Report
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text" value={searchInput} onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search area, property, rep…"
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A] bg-white"
          />
        </div>
        <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
          {([{ v: 'all', l: 'All' }, { v: 'farming', l: 'Farming' }, { v: 'concierge', l: 'Concierge' }] as const).map((o) => (
            <button
              key={o.v} onClick={() => { setFilter(o.v); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${filter === o.v ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}
            >
              {o.l}
            </button>
          ))}
        </div>
        {!loading && <span className="text-sm text-[#6B7280] ml-auto">{total} report{total !== 1 ? 's' : ''}</span>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center"><p className="text-red-600 font-medium">{error}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>{COLUMN_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Report</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Subject</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Settings</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Branded To</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Delivery</th>
                  <th className="text-right px-4 py-3 font-medium text-[#6B7280]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                  ))}</tr>
                )) : rows.map((r) => <ReportRow key={`${r.type}-${r.id}`} row={r} />)}
              </tbody>
            </table>
            {!loading && rows.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No reports yet</p>
                <p className="text-sm text-[#6B7280] mt-1">New Report starts one. A property profile costs a credit; the farming reports read a dataset.</p>
              </div>
            )}
          </div>
        )}
        {!loading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
            <p className="text-sm text-[#6B7280]">
              Showing <span className="font-medium text-[#1A1A2E]">{(page - 1) * REPORTS_PAGE_SIZE + 1}</span>–
              <span className="font-medium text-[#1A1A2E]">{Math.min(page * REPORTS_PAGE_SIZE, total)}</span> of{' '}
              <span className="font-medium text-[#1A1A2E]">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-sm rounded-md transition-colors text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">‹ Prev</button>
              <span className="text-xs text-[#6B7280] px-2">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-sm rounded-md transition-colors text-[#1A1A2E] hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed">Next ›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "16 Sep, 2:14pm" — short, and never a bare date for something made today. */
export function shortWhen(iso: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '—';
  // "16 Sep", not "Sep 16" — the spec's short form, and the rows are scanned
  // by day rather than by month.
  const day = `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
  return `${day}, ${time}`;
}

export function ReportRow({ row }: { row: ReportListRow }) {
  const building = row.status === 'pending' || row.status === 'retrieved';
  const failed = row.status === 'failed';

  return (
    <tr className="hover:bg-gray-50 transition-colors align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-[#1A1A2E] truncate">{row.typeLabel}</div>
        <div className="text-xs text-[#6B7280] truncate">{row.sourceLine}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-[#1A1A2E] truncate">{row.subject ?? '—'}</div>
        {row.subjectDetail ? <div className="text-xs text-[#6B7280] truncate">{row.subjectDetail}</div> : null}
      </td>
      <td className="px-4 py-3 text-[#6B7280] truncate">{row.settings ?? '—'}</td>
      <td className="px-4 py-3 text-[#6B7280] truncate">{row.brandedToName ?? '—'}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{shortWhen(row.createdAt)}</td>
      <td className="px-4 py-3 whitespace-nowrap"><DeliveryCell row={row} /></td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {building ? (
          <span className="text-xs text-[#6B7280]">Building…</span>
        ) : failed ? (
          <button className="text-xs font-medium text-[#1B2A4A] hover:underline">Try again</button>
        ) : (
          <div className="inline-flex items-center gap-3">
            <a
              href={pdfHref(row)}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-[#1B2A4A] hover:underline"
            >
              Download
            </a>
            <button className="text-xs font-medium text-[#1B2A4A] hover:underline">
              {row.type === 'concierge_profile' ? 'Comparables' : 'Notify rep'}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function pdfHref(row: ReportListRow): string {
  return row.type === 'concierge_profile'
    ? `/api/concierge/profiles/${row.id}/pdf`
    : `/api/reports/${row.type}/${row.id}/pdf`;
}

/**
 * Never sent is not a quiet version of delivered.
 *
 * The cell reads the latest ATTEMPT from the log. Grey with "Never sent" is a
 * statement; an empty cell would be the silence this column exists to end.
 */
export function DeliveryCell({ row }: { row: ReportListRow }) {
  if (!row.delivery) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[#6B7280]">
        <span className="h-2 w-2 rounded-full bg-gray-300" />
        Never sent
      </span>
    );
  }
  const failed = row.delivery.outcome === 'failed';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${failed ? 'text-[#B03A2C]' : 'text-[#1A1A2E]'}`}
      title={`${row.delivery.recipientName ?? row.delivery.recipientEmail} · ${shortWhen(row.delivery.attemptedAt)}`}
    >
      <span className={`h-2 w-2 rounded-full ${failed ? 'bg-red-500' : 'bg-green-500'}`} />
      {failed ? 'Failed' : 'Delivered'}
    </span>
  );
}
