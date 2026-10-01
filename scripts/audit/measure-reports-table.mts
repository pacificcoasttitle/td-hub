/**
 * Measure the Reports table. Does it still force horizontal scroll?
 *
 * WHY THIS EXISTS. Gerard's complaint is "horizontal scroll on /reports", and
 * that is a LAYOUT fact. Nothing in the source answers it: the sidebar incident
 * (AGENTS.md, 2026-09-10) was three nav entries that were correct, permitted,
 * routed and typed right and sat below a clipping boundary, and the only check
 * that found it rendered the real markup and measured what was on screen.
 *
 * The Vercel preview is behind deployment protection and production needs a
 * login, so this does what that note prescribes instead: render the REAL
 * component with the REAL classes to a static page, serve it over http — a
 * file:// page cannot be scripted — and read getBoundingClientRect.
 *
 * WHAT IT CANNOT TELL YOU. This is the table, not the page: no sidebar, no
 * header, no real data. It answers "is the table itself wider than its
 * container, and is any cell carrying body copy", which is the complaint. It
 * does not prove the whole page is clean at every width.
 *
 *   npx tsx scripts/audit/measure-reports-table.mts        # writes the page
 *   # then serve the directory and point a browser at it
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ReportGroup, groupRows } from '../../src/components/admin/reports/reports-list-page';
import type { ReportListRow } from '../../src/lib/domain/reports/list-types';

const COLUMN_WIDTHS = ['38%', '17%', '13%', '22%', '10%'];

const base: ReportListRow = {
  type: 'county_sales', id: 3, typeLabel: 'County Sales', sourceLine: 'Dataset',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  brandedToName: 'Maria Lopez', brandedToEmail: 'mlopez@pct.com', status: 'generated',
  createdAt: '2026-09-16 21:14:00', createdBy: 'ops@pct.com', madeBy: 'Operations',
  delivery: null, templateVersion: 'cs-v1', groupKey: null, taxStatus: null,
};

const r = (over: Partial<ReportListRow>): ReportListRow => ({ ...base, ...over });

// THE WORST CASES, not the tidy ones. A measurement on short strings proves
// nothing — the old layout only scrolled because real content was long.
const rows: ReportListRow[] = [
  r({}),
  r({
    id: 4, type: 'concierge_profile', typeLabel: 'Concierge Profile',
    subject: '1358 5TH ST, LA VERNE, CA 91750', subjectDetail: 'APN 8378-012-015',
    sourceLine: '1 credit spent', settings: 'within 1 mi · sold in 12 months · ±30% size · up to 12',
    templateVersion: 'v2', taxStatus: 'pending', groupKey: '1358 5th st|la verne|ca|91750',
    brandedToName: 'Christopher Hernandez-Villanueva',
    delivery: { outcome: 'failed', attemptedAt: '2026-09-30 11:02:00', recipientName: 'Christopher Hernandez-Villanueva', recipientEmail: 'chernandezvillanueva@pacificcoasttitle.com' },
  }),
  r({ id: 5, type: 'concierge_profile', typeLabel: 'Concierge Profile', subject: '1358 5TH ST, LA VERNE, CA 91750', groupKey: '1358 5th st|la verne|ca|91750', taxStatus: 'ready' }),
  r({ id: 6, type: 'concierge_profile', typeLabel: 'Concierge Profile', subject: '1358 5TH ST, LA VERNE, CA 91750', groupKey: '1358 5th st|la verne|ca|91750' }),
  r({
    id: 7, type: 'sales_activity', typeLabel: 'Sales Activity',
    subject: 'Rancho Santa Margarita, Orange County, California',
    subjectDetail: 'Tract 14412 · 1,284 records', settings: 'Jan 2026 – Sep 2026',
    delivery: { outcome: 'sent', attemptedAt: '2026-09-29 08:14:00', recipientName: 'Maria Lopez', recipientEmail: 'mlopez@pct.com' },
  }),
  r({ id: 8, status: 'pending', subject: 'Still building' }),
  r({ id: 9, status: 'failed', subject: 'A failed one' }),
];

const body = groupRows(rows)
  .map((g, i) => renderToStaticMarkup(createElement(ReportGroup, { key: i, group: g })))
  .join('\n');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reports table measurement</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  // brand-orange is a project token; the arbitrary values ([#6B7280]) the JIT
  // handles on its own.
  tailwind.config = { theme: { extend: { colors: {
    'brand-orange': '#F26B2B', 'brand-orange-hover': '#D95A1E',
  } } } };
</script>
<style> body { margin: 0; } </style>
</head><body>
<div id="page" class="p-6 bg-gray-50">
  <div class="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
    <div id="scroller" class="overflow-x-auto">
      <table id="t" class="w-full text-sm" style="table-layout: fixed">
        <colgroup>${COLUMN_WIDTHS.map((w) => `<col style="width:${w}">`).join('')}</colgroup>
        <thead><tr class="border-b border-gray-200 bg-gray-50/60">
          <th class="text-left px-4 py-3 font-medium text-[#6B7280]">Report</th>
          <th class="text-left px-4 py-3 font-medium text-[#6B7280]">Branded To</th>
          <th class="text-left px-4 py-3 font-medium text-[#6B7280]">Created</th>
          <th class="text-left px-4 py-3 font-medium text-[#6B7280]">Delivery</th>
          <th class="text-right px-4 py-3 font-medium text-[#6B7280]">Actions</th>
        </tr></thead>
        <tbody class="divide-y divide-gray-100">${body}</tbody>
      </table>
    </div>
  </div>
</div>
</body></html>`;

mkdirSync('_scratch_untracked/measure', { recursive: true });
writeFileSync('_scratch_untracked/measure/reports-table.html', html, 'utf8');
console.log('wrote _scratch_untracked/measure/reports-table.html');
console.log(`rows rendered: ${rows.length}, groups: ${groupRows(rows).length}`);
