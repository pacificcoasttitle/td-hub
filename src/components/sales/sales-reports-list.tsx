'use client';

import { useEffect, useRef, useState } from 'react';
import { REPORTS_PAGE_SIZE, type ReportListRow } from '@/lib/domain/reports/list-types';
import { shortWhen } from '@/components/admin/reports/reports-list-page';

// ─── A rep's own reports ────────────────────────────────────────────────────
//
// The list reps had in legacy, back: every farming report branded to them.
// The same table as the operators' Reports page, with two differences from the
// handoff:
//
//   - Branded To becomes MADE BY. In a rep's own list the branded rep is always
//     them; the useful column is who prepared it.
//   - NO SEND ACTION. A rep downloads. Notifying and generating are operator
//     acts, on the operators' page.
//
// Reads GET /api/sales/reports, which filters to the signed-in rep on the
// server. The list never asks for anyone else's.

const COLUMN_WIDTHS = ['20%', '26%', '22%', '14%', '10%', '8%'];

export function SalesReportRow({ row }: { row: ReportListRow }) {
  const ready = row.status === 'generated';
  return (
    <tr className="hover:bg-gray-50 transition-colors align-top">
      <td className="px-5 py-3">
        <div className="font-medium text-gray-900 truncate">{row.typeLabel}</div>
      </td>
      <td className="px-5 py-3">
        <div className="text-gray-900 truncate">{row.subject ?? '—'}</div>
        {row.subjectDetail ? <div className="text-xs text-gray-500 truncate">{row.subjectDetail}</div> : null}
      </td>
      <td className="px-5 py-3 text-gray-500 truncate">{row.settings ?? '—'}</td>
      <td className="px-5 py-3 text-gray-500 truncate">{row.madeBy ?? '—'}</td>
      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{shortWhen(row.createdAt)}</td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {ready ? (
          <a
            href={`/api/reports/${row.type}/${row.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-[#1B2A4A] hover:underline"
          >
            Download
          </a>
        ) : (
          // Honest about why there is nothing to open, rather than a dead link.
          <span className="text-xs text-gray-400">{row.status === 'failed' ? 'Not available' : 'Being prepared'}</span>
        )}
      </td>
    </tr>
  );
}

export function SalesReportsList() {
  const [rows, setRows] = useState<ReportListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchCount = useRef(0);

  // State is set only from the request's callbacks, never synchronously in the
  // effect: "loading" is switched on by whatever changed the page or search.
  useEffect(() => {
    const id = ++fetchCount.current;
    const p = new URLSearchParams({ page: String(page) });
    if (search) p.set('search', search);
    fetch(`/api/sales/reports?${p}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Failed (${r.status})`);
        return body;
      })
      .then((d) => { if (id === fetchCount.current) { setRows(d.rows ?? []); setTotal(d.total ?? 0); setError(null); } })
      .catch((e: Error) => { if (id === fetchCount.current) setError(e.message); })
      .finally(() => { if (id === fetchCount.current) setLoading(false); });
  }, [page, search]);

  function goTo(next: number) {
    setLoading(true);
    setPage(next);
  }

  function handleSearch(v: string) {
    setSearchInput(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setLoading(true); setSearch(v); setPage(1); }, 300);
  }

  const totalPages = Math.ceil(total / REPORTS_PAGE_SIZE);

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Farming reports prepared for you, with your name on them.</p>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search area or county…"
          className="h-9 w-64 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-[#1B2A4A]"
        />
      </div>

      {error ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-gray-700 font-medium">Your reports could not be loaded.</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>{COLUMN_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                {['Report', 'Subject', 'Settings', 'Made By', 'Created', ''].map((h) => (
                  <th key={h} className={`${h ? 'text-left' : 'text-right'} px-5 py-3 font-medium text-gray-500`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" /></td></tr>
              )) : rows.map((r) => <SalesReportRow key={`${r.type}-${r.id}`} row={r} />)}
            </tbody>
          </table>
          {!loading && rows.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 font-medium">{search ? 'No report matches that search.' : 'No reports have been prepared for you yet.'}</p>
              {!search ? <p className="text-sm text-gray-400 mt-1">Sales Activity, Carrier Route Analysis and County Sales reports branded to you will appear here.</p> : null}
            </div>
          ) : null}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
              <span>{`Page ${page} of ${totalPages}`}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => goTo(page - 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40">Previous</button>
                <button type="button" disabled={page >= totalPages} onClick={() => goTo(page + 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
