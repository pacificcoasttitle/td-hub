import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { SalesReportRow } from './sales-reports-list';

const row = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  type: 'county_sales', id: 3, typeLabel: 'County Sales', sourceLine: 'Dataset',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  brandedToName: 'Mark Neveu', brandedToEmail: 'mneveu@pct.com', status: 'generated',
  createdAt: '2026-09-21 21:14:00', createdBy: 'ops@pct.com', madeBy: 'Jerry Hernandez', delivery: null, ...over,
});
const text = (r: ReportListRow) => renderToStaticMarkup(<table><tbody><SalesReportRow row={r} /></tbody></table>)
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('a row in a rep\'s own list', () => {
  it('says who made it — the branded rep is always them', () => {
    const t = text(row());
    expect(t).toContain('Jerry Hernandez');
    expect(t).not.toContain('Mark Neveu');
  });

  it('offers Download and nothing that sends or notifies', () => {
    const t = text(row());
    expect(t).toContain('Download');
    expect(t).not.toMatch(/Notify|Send|Try again/);
  });

  it('downloads through our own route', () => {
    expect(renderToStaticMarkup(<table><tbody><SalesReportRow row={row()} /></tbody></table>))
      .toContain('href="/api/reports/county_sales/3/pdf"');
  });

  it('says why there is nothing to open, rather than a dead link', () => {
    expect(text(row({ status: 'pending' }))).toContain('Being prepared');
    expect(text(row({ status: 'failed' }))).toContain('Not available');
    expect(text(row({ status: 'failed' }))).not.toContain('Download');
  });
});
