import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportDeliverySummary } from '@/lib/domain/reports/list-types';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { DeliveryCell, ReportRow, shortWhen } from './reports-list-page';
import { TEMPLATE_VERSION as CONCIERGE_TEMPLATE } from '@/lib/domain/concierge/document/template-version';

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
  createdAt: '2026-09-16 21:14:00', createdBy: 'ops@pct.com', madeBy: 'Operations', delivery: null, templateVersion: 'cs-v1',
  ...over,
});

describe('refreshing a profile is offered, and says it is free', () => {
  // Two Concierge credits were spent in two days generating fresh profiles on
  // one parcel to see what a template change looked like. Generating gets you
  // fresh DATA on whatever template is deployed; it does not get you a fresh
  // DOCUMENT. The capability to re-render free already existed on three routes
  // and none of them said so.
  const profile = (over: Partial<ReportListRow> = {}) => row({
    type: 'concierge_profile', typeLabel: 'Concierge Profile',
    templateVersion: 'v2', status: 'generated', ...over,
  });

  it('offers the refresh and calls it free', () => {
    const text = visible(<ReportRow row={profile()} />);
    expect(text).toContain('Refresh document (free)');
  });

  it('says so when the profile is on an older layout', () => {
    // The prompt, not just the permission. Without this the operator has no
    // way to know a newer document exists.
    const text = visible(<ReportRow row={profile({ templateVersion: 'v2' })} />);
    expect(text).toContain('older layout');
    expect(text).toContain('v2');
    expect(text).toContain('calls no vendor');
  });

  it('does not nag when the profile is already current', () => {
    const text = visible(<ReportRow row={profile({ templateVersion: CONCIERGE_TEMPLATE })} />);
    expect(text).toContain('Refresh document (free)');
    expect(text).not.toContain('older layout');
  });

  it('is not offered on the farming types, which re-render differently', () => {
    const text = visible(<ReportRow row={row({ type: 'county_sales' })} />);
    expect(text).not.toContain('Refresh document');
  });

  it('the word free is on the control itself, not only in a tooltip', () => {
    // Next to a Generate button that plainly costs something, silence reads as
    // "probably also costs".
    const markup = renderToStaticMarkup(<table><tbody><ReportRow row={profile()} /></tbody></table>);
    expect(markup).toMatch(/<button[^>]*>[^<]*Refresh document \(free\)/);
  });
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

// ─── The outcomes the event webhook can now prove (migration 0061) ──────────
describe('the Delivery column, once SendGrid has told us what happened', () => {
  // `outcome` is typed as a string, not the union: this asserts what happens
  // when SendGrid sends an event type the union does not know about, which is
  // precisely the case the type system cannot rule out at runtime.
  const withOutcome = (outcome: string) => renderToStaticMarkup(
    <DeliveryCell row={row({
      delivery: {
        outcome: outcome as ReportDeliverySummary['outcome'],
        attemptedAt: '2026-09-22 10:00:00', recipientName: null, recipientEmail: 'a@b.com',
      },
    }) as never} />,
  );

  it('gives green ONLY to a delivery that was proved', () => {
    expect(withOutcome('delivered')).toContain('bg-emerald-500');
    // Everything else must not be green — the rule 0060 established.
    for (const o of ['sent', 'failed', 'bounced', 'dropped', 'spam']) {
      expect(withOutcome(o), o).not.toContain('emerald');
    }
  });

  it('says Delivered, not Sent, once it is proved', () => {
    expect(withOutcome('delivered')).toContain('Delivered');
  });

  it('names the three failures separately, because they need different actions', () => {
    expect(withOutcome('bounced')).toContain('Bounced');
    expect(withOutcome('dropped')).toContain('Dropped');
    expect(withOutcome('spam')).toContain('Spam');
  });

  it('tells the reader plainly that a bounce or a drop did not arrive', () => {
    expect(withOutcome('bounced')).toContain('do NOT have it');
    expect(withOutcome('dropped')).toContain('do NOT have it');
  });

  it('falls back to Sent for an outcome it does not recognise, rather than rendering nothing', () => {
    // A new SendGrid event type must not blank the column.
    expect(withOutcome('something_new')).toContain('Sent');
  });
});
