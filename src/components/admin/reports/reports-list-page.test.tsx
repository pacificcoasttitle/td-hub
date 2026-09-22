import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { DeliveryCell, ReportRow, shortWhen } from './reports-list-page';

// Rendered and read as text, like documents-panel.test.tsx: grepping source for
// UI strings has failed silently in this project before.
function visible(el: React.ReactElement): string {
  return renderToStaticMarkup(<table><tbody>{el}</tbody></table>)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&middot;|&#xB7;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

const row = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  type: 'county_sales', id: 3, typeLabel: 'County Sales', sourceLine: 'Dataset',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  brandedToName: 'Maria Lopez', brandedToEmail: 'mlopez@pct.com', status: 'generated',
  createdAt: '2026-09-16 21:14:00', createdBy: 'ops@pct.com', delivery: null,
  ...over,
});

describe('a report row', () => {
  it('shows the subject and the settings as separate things', () => {
    // The one new idea on the screen, and the reason one table holds four types.
    const text = visible(<ReportRow row={row()} />);
    expect(text).toContain('Orange County');
    expect(text).toContain('44 cities');
    expect(text).toContain('August 2026');
  });

  it('says what the source was — a dataset, or what the credit did', () => {
    expect(visible(<ReportRow row={row()} />)).toContain('Dataset');
    expect(visible(<ReportRow row={row({ type: 'concierge_profile', typeLabel: 'Concierge Profile', sourceLine: '1 credit spent' })} />))
      .toContain('1 credit spent');
  });

  it('offers no actions while a report is still building', () => {
    const text = visible(<ReportRow row={row({ status: 'pending' })} />);
    expect(text).toContain('Building…');
    expect(text).not.toContain('Download');
  });

  it('offers a retry, not a download, on a failed one', () => {
    const text = visible(<ReportRow row={row({ status: 'failed' })} />);
    expect(text).toContain('Try again');
    expect(text).not.toContain('Download');
  });

  it('offers Comparables on a profile and Notify rep on a farming report', () => {
    expect(visible(<ReportRow row={row({ type: 'concierge_profile' })} />)).toContain('Comparables');
    expect(visible(<ReportRow row={row()} />)).toContain('Notify rep');
  });

  it('never calls notifying the branded rep a "send"', () => {
    // Notifying our own rep and delivering to an outside agent are different
    // acts, and only the first is in scope.
    expect(visible(<ReportRow row={row()} />)).not.toMatch(/\bSend\b/);
  });

  it('renders an absent subject as an em dash rather than blank', () => {
    expect(visible(<ReportRow row={row({ subject: null, subjectDetail: null, settings: null })} />)).toContain('—');
  });
});

describe('the delivery cell', () => {
  it('says "Never sent" out loud when nothing was attempted', () => {
    // Silence reading as success is the failure this column exists against.
    expect(visible(<tr><DeliveryCell row={row()} /></tr>)).toContain('Never sent');
  });

  it('reads differently for sent and failed', () => {
    const delivered = row({ delivery: { outcome: 'sent', attemptedAt: '2026-09-16 22:00:00', recipientName: 'Maria Lopez', recipientEmail: 'mlopez@pct.com' } });
    const failed = row({ delivery: { outcome: 'failed', attemptedAt: '2026-09-16 22:00:00', recipientName: null, recipientEmail: 'mlopez@pct.com' } });
    expect(visible(<tr><DeliveryCell row={delivered} /></tr>)).toContain('Sent');
    expect(visible(<tr><DeliveryCell row={failed} /></tr>)).toContain('Failed');
  });

  it('colours the three states apart, so the dot alone is readable', () => {
    const html = (r: ReportListRow) => renderToStaticMarkup(<DeliveryCell row={r} />);
    expect(html(row())).toContain('bg-gray-300');
    expect(html(row({ delivery: { outcome: 'sent', attemptedAt: '2026-09-16 22:00:00', recipientName: null, recipientEmail: 'a@b.com' } }))).toContain('bg-[#1B2A4A]');
    expect(html(row({ delivery: { outcome: 'failed', attemptedAt: '2026-09-16 22:00:00', recipientName: null, recipientEmail: 'a@b.com' } }))).toContain('bg-red-500');
  });

  it('never claims Delivered, and never shows the green of a confirmed delivery', () => {
    // SendGrid accepting a message is not delivery. The word and the colour both
    // stop at what we know.
    const sent = row({ delivery: { outcome: 'sent', attemptedAt: '2026-09-16 22:00:00', recipientName: 'Maria Lopez', recipientEmail: 'mlopez@pct.com' } });
    const html = renderToStaticMarkup(<DeliveryCell row={sent} />);
    expect(html).not.toMatch(/Delivered/);
    expect(html).not.toContain('bg-green-500');
    expect(html).toContain('delivery not confirmed');
  });

  it('carries who and when in the title, so the log is one hover away', () => {
    const html = renderToStaticMarkup(<DeliveryCell row={row({ delivery: { outcome: 'sent', attemptedAt: '2026-09-16 22:00:00', recipientName: 'Maria Lopez', recipientEmail: 'mlopez@pct.com' } })} />);
    expect(html).toContain('Maria Lopez');
  });
});

describe('the created stamp', () => {
  it('is the short form the spec asks for', () => {
    expect(shortWhen('2026-09-16T21:14:00Z')).toMatch(/^\d{1,2} \w{3}, \d{1,2}:\d{2}(am|pm)$/);
  });

  it('reads a bare database timestamp as UTC rather than local', () => {
    expect(shortWhen('2026-09-16 21:14:00')).toBe(shortWhen('2026-09-16T21:14:00Z'));
  });

  it('does not invent a date it cannot read', () => {
    expect(shortWhen('not a date')).toBe('—');
  });
});

describe('the page itself', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const strip = (f: string) => readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const page = () => strip(join(HERE, 'reports-list-page.tsx'));

  it('filters All / Farming / Concierge — Active/Inactive means nothing for a report', () => {
    const src = page();
    expect(src).toContain("{ v: 'farming', l: 'Farming' }");
    expect(src).not.toMatch(/l: 'Inactive'/);
  });

  it('declares column widths with a fixed layout, so Actions cannot be pushed off-screen', () => {
    const src = page();
    expect(src).toContain("tableLayout: 'fixed'");
    expect(src.match(/COLUMN_WIDTHS = \[[^\]]+\]/)![0].split(',').length).toBe(7);
  });

  it('is reachable from the sidebar, after Documents', () => {
    const nav = strip(join(HERE, '../sidebar-nav.tsx'));
    const documentsAt = nav.indexOf("label: 'Documents'");
    const reportsAt = nav.indexOf("label: 'Reports'");
    expect(reportsAt).toBeGreaterThan(documentsAt);
    expect(nav).toContain("href: '/reports'");
  });
});
