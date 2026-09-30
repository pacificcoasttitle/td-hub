'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REPORTS_PAGE_SIZE,
  type ReportListRow,
  type ReportFilter,
} from '@/lib/domain/reports/list-types';
import { NotifyRepControl } from './notify-rep-control';
import { ComparablesControl, RefreshDocumentControl, RetryControl } from './row-actions';
import { MenuItem, RowBadge, RowMenu } from './row-menu';
import { TaxDetailControl } from './tax-detail-control';
// The template a re-render would produce, read from the document itself so the
// "older layout" hint cannot drift from what the renderer actually makes.
import { TEMPLATE_VERSION as CONCIERGE_TEMPLATE } from '@/lib/domain/concierge/document/template-version';

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
// 2. Report and Subject are ONE column, stacked. This said the opposite until
//    2026-09-30 — "TWO columns, never merged", on the reasoning that the
//    separation is what lets one table hold four types. OVERRIDDEN by Gerard's
//    design review, and the reasoning did not survive contact with the rendered
//    page: the type label and the subject are read together, as one
//    identification of the row, and holding them apart cost ~200px that Actions
//    then did not have. Stacking keeps both and keeps the separation, in less
//    space.
//
// SETTINGS IS GONE FROM THE HEAD, not from the row. "1 mi · 12 mo · ±30% size"
// is identical on every Concierge row, so as a column it was 20% of the table
// spent on something nobody can scan by. It is now the row's tooltip, where it
// is still there for the one moment anybody wants it.
//
// ACTIONS IS A KEBAB. It was a row of text links plus five lines of explanatory
// body copy inside the cell, which forced horizontal scroll and tripled row
// height — about six reports to a screen. See row-menu.tsx.
//
// WHAT THE MENU IS NOT ALLOWED TO SWALLOW: an older layout, and a tax search in
// flight. Both stay on the row as badges, because an operator has to see them
// without opening anything.
//
// LAYOUT: table-layout:fixed with declared widths. With `auto`, an un-wrappable
// subject pushes Actions off-screen — a row whose only action cannot be reached.
//
// DELIVERY: reads the log through the API. "Never sent" is grey and says so;
// it must never look like success, which is the failure this whole column
// exists to make visible.

const COLUMN_WIDTHS = ['38%', '17%', '13%', '22%', '10%'];

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
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Branded To</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Delivery</th>
                  <th className="text-right px-4 py-3 font-medium text-[#6B7280]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: COLUMN_WIDTHS.length }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                  ))}</tr>
                )) : groupRows(rows).map((g) => (
                  <ReportGroup key={`${g.rows[0]!.type}-${g.rows[0]!.id}`} group={g} onChanged={fetchReports} />
                ))}
              </tbody>
            </table>
            {!loading && rows.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-[#1A1A2E] font-medium">No reports yet</p>
                <p className="text-sm text-[#6B7280] mt-1">New Report starts one. A property profile looks up a single address; the farming reports read a dataset you upload.</p>
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

// ─── Re-runs of the same property, grouped ──────────────────────────────────
//
// Five profiles exist on 1358 5th St. Flat, they make the table look broken —
// five sibling rows, same address, minutes apart. They are not a bug: the claim
// key normalises punctuation so all five collapse to one key, GET /for-property
// warned every time, and an operator proceeded anyway.
//
// So the relationship is SHOWN, not deduped. The newest is the row; the earlier
// ones sit under it behind a count that states exactly how many there are and
// expands on one click. NOTHING IS HIDDEN — each of those five was paid for and
// each appears on an invoice, so a list that quietly showed one would be a list
// that disagrees with the bill.
//
// GROUPING IS PER PAGE, deliberately and with a limit worth naming: a group
// straddling a page boundary shows as two groups, one on each page. Fixing that
// means grouping in SQL and paginating by property rather than by report, which
// changes what `total` counts. Not worth it at this size, and worse to do
// halfway — a group that claims "4 earlier" while showing 2 is a lie, whereas
// two honest partial groups are merely inelegant.

export interface ReportGroupData {
  rows: ReportListRow[];
}

export function groupRows(rows: readonly ReportListRow[]): ReportGroupData[] {
  const out: ReportGroupData[] = [];
  const byKey = new Map<string, ReportGroupData>();

  for (const r of rows) {
    // Only Concierge carries a property key. A farming report is never grouped,
    // and neither is a profile whose key predates the column.
    if (r.type !== 'concierge_profile' || !r.groupKey) {
      out.push({ rows: [r] });
      continue;
    }
    const existing = byKey.get(r.groupKey);
    if (existing) {
      existing.rows.push(r);
      continue;
    }
    const group: ReportGroupData = { rows: [r] };
    byKey.set(r.groupKey, group);
    out.push(group);
  }
  return out;
}

export function ReportGroup({ group, onChanged }: { group: ReportGroupData; onChanged?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [primary, ...earlier] = group.rows;
  if (!primary) return null;

  return (
    <>
      <ReportRow
        row={primary}
        onChanged={onChanged}
        earlierCount={earlier.length}
        expanded={expanded}
        onToggleEarlier={() => setExpanded((v) => !v)}
      />
      {expanded
        ? earlier.map((r) => <ReportRow key={`${r.type}-${r.id}`} row={r} onChanged={onChanged} isEarlier />)
        : null}
    </>
  );
}

export function ReportRow({
  row, onChanged, earlierCount = 0, expanded = false, onToggleEarlier, isEarlier = false,
}: {
  row: ReportListRow;
  onChanged?: () => void;
  /** Other profiles on this same property, on this page. */
  earlierCount?: number;
  expanded?: boolean;
  onToggleEarlier?: () => void;
  /** This row is itself one of the earlier ones, shown indented. */
  isEarlier?: boolean;
}) {
  const building = row.status === 'pending' || row.status === 'retrieved';
  const failed = row.status === 'failed';
  const isProfile = row.type === 'concierge_profile';
  const stale = row.templateVersion !== null && row.templateVersion !== CONCIERGE_TEMPLATE;
  const href = pdfHref(row);
  const openable = !building && !failed;

  // ─── CLICKABLE ROW (Gerard), without breaking the table ───────────────────
  //
  // The click is a MOUSE CONVENIENCE and nothing more. The first version put
  // role="link" and tabIndex on the <tr>, which opens the document and destroys
  // the table: a <tr> with role="link" is no longer a row to a screen reader, so
  // the whole grid loses its structure to make one shortcut work.
  //
  // So the real affordance is an ANCHOR on the subject — keyboard-reachable,
  // announced as a link, opens in a tab, works with middle-click and
  // copy-link-address, none of which a synthetic click handler gives you. The row
  // handler is layered on top for people who click anywhere in the row.
  //
  // Only where there IS a document: a row still building or failed has nothing to
  // open, and a click that does nothing teaches the operator the page is broken.
  // The kebab stops propagation so its own clicks never reach this.
  const open = () => { if (openable) window.open(href, '_blank', 'noopener'); };

  return (
    <tr
      className={`transition-colors align-top ${openable ? 'cursor-pointer hover:bg-gray-50' : ''} ${isEarlier ? 'bg-[#FCFCFD]' : ''}`}
      onClick={open}
    >
      {/* Report and Subject, stacked. Settings is the tooltip — identical on
          every Concierge row, so it earns a hover and not a column. */}
      <td className={`px-4 py-3 ${isEarlier ? 'pl-10' : ''}`} title={row.settings ?? undefined}>
        {/* An absent subject is an EM DASH, not the type label falling through.
            The first version of the merged cell did the latter, which reads as a
            row that has a subject and repeats it underneath — and quietly
            removed the only signal that the subject is missing. */}
        <div className="truncate text-[#1A1A2E]">
          {openable ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              // The row's handler would fire too and open a second tab.
              onClick={(e) => e.stopPropagation()}
              className="font-medium hover:underline"
            >
              {row.subject ?? '—'}
            </a>
          ) : (
            <span className="font-medium">{row.subject ?? '—'}</span>
          )}
          {stale ? <RowBadge>{row.templateVersion}</RowBadge> : null}
          {isProfile && row.taxStatus === 'pending' ? <RowBadge tone="amber">tax running</RowBadge> : null}
          {isProfile && row.taxStatus === 'ready' ? <RowBadge tone="green">tax</RowBadge> : null}
        </div>
        <div className="truncate text-xs text-[#6B7280]">
          {isEarlier ? 'Earlier profile · ' : ''}{row.typeLabel}
          {row.subjectDetail ? ` · ${row.subjectDetail}` : ''}
          {row.sourceLine ? ` · ${row.sourceLine}` : ''}
        </div>
        {earlierCount > 0 && onToggleEarlier ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleEarlier(); }}
            className="mt-1 text-[11px] font-medium text-[#1B2A4A] hover:underline"
          >
            {expanded
              ? 'Hide earlier profiles'
              : `${earlierCount} earlier profile${earlierCount === 1 ? '' : 's'} on this property`}
          </button>
        ) : null}
      </td>
      <td className="px-4 py-3 text-[#6B7280] truncate">{row.brandedToName ?? '—'}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{shortWhen(row.createdAt)}</td>
      <td className="px-4 py-3 whitespace-nowrap"><DeliveryCell row={row} /></td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {building ? (
          <span className="text-xs text-[#6B7280]">Building…</span>
        ) : (
          <RowMenu>
            {failed ? (
              <RetryControl row={row} onChanged={onChanged} />
            ) : (
              <>
                <MenuItem label="Download" note="Opens the PDF in a new tab." href={href} />
                {isProfile ? (
                  <>
                    <RefreshDocumentControl row={row} currentTemplate={CONCIERGE_TEMPLATE} onChanged={onChanged} />
                    <ComparablesControl row={row} onChanged={onChanged} />
                    <TaxDetailControl row={row} onChanged={onChanged} />
                  </>
                ) : (
                  <NotifyRepControl row={row} onChanged={onChanged} />
                )}
              </>
            )}
          </RowMenu>
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
 * Never sent is not a quiet version of sent.
 *
 * The cell reads the latest ATTEMPT from the log. Grey with "Never sent" is a
 * statement; an empty cell would be the silence this column exists to end.
 *
 * SENT IS NOT DELIVERED. SendGrid accepting a message proves it left, not that
 * it arrived. So a freshly sent report says Sent with a navy dot, and green is
 * reserved for a Delivered the event webhook has actually proved (migration
 * 0061). Most rows pass through Sent in seconds.
 *
 * The words that matter are the other three. Before the webhook, a message
 * SendGrid accepted and then failed to deliver looked identical to one that
 * arrived — seventeen of them went out between April and September 2026, six
 * of them prelims, and this column said Sent for every one.
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
  const look = DELIVERY_LOOK[row.delivery.outcome] ?? DELIVERY_LOOK.sent;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${look.text}`}
      title={`${row.delivery.recipientName ?? row.delivery.recipientEmail} · ${shortWhen(row.delivery.attemptedAt)} · ${look.title}`}
    >
      <span className={`h-2 w-2 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}

/**
 * GREEN MEANS SOMEBODY HAS IT. Nothing else gets green — that was the whole
 * point of 0060, and it stays true now that green can be earned.
 *
 * The three failures are deliberately not one word. A bounce, a drop and a
 * spam report need different actions from whoever reads this: a bounce means
 * the address is wrong, a drop means we are still sending to an address
 * SendGrid gave up on weeks ago, and spam means we got through and were
 * rejected by a person.
 */
const DELIVERY_LOOK: Record<string, { label: string; dot: string; text: string; title: string }> = {
  sent: { label: 'Sent', dot: 'bg-[#1B2A4A]', text: 'text-[#1A1A2E]', title: 'accepted by SendGrid, delivery not confirmed yet' },
  delivered: { label: 'Delivered', dot: 'bg-emerald-500', text: 'text-[#1A1A2E]', title: 'the receiving server accepted it' },
  bounced: { label: 'Bounced', dot: 'bg-red-500', text: 'text-[#B03A2C]', title: 'rejected by the receiving server — they do NOT have it' },
  dropped: { label: 'Dropped', dot: 'bg-red-500', text: 'text-[#B03A2C]', title: 'SendGrid did not attempt it — they do NOT have it' },
  spam: { label: 'Spam', dot: 'bg-amber-500', text: 'text-[#B45309]', title: 'the recipient marked it as spam' },
  failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-[#B03A2C]', title: 'we never handed it to SendGrid' },
};
