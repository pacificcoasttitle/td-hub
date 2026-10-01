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
  // A county-sales report is not about one property and has no tax detail.
  groupKey: null, taxStatus: null,
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

  // THE CONTROLS MOVED INTO A KEBAB (Gerard, 2026-09-30), so a static render no
  // longer sees them — the menu is closed until somebody opens it. The
  // assertions about what the menu OFFERS and what it says about cost now live
  // in reports-list-page.interactive.test.tsx, which opens it.
  //
  // What has to stay visible WITHOUT opening anything is the prompt: that this
  // profile was made on an older layout. A menu is a fine home for a control and
  // a terrible home for a signal nobody knows to look for — the operator has no
  // reason to open a kebab on a row that looks finished. So the row keeps a
  // badge, and these are the tests for it.

  it('badges the row when the profile is on an older layout', () => {
    const text = visible(<ReportRow row={profile({ templateVersion: 'v2' })} />);
    expect(text).toContain('v2');
  });

  it('does not badge a profile that is already current', () => {
    const text = visible(<ReportRow row={profile({ templateVersion: CONCIERGE_TEMPLATE })} />);
    expect(text).not.toContain(CONCIERGE_TEMPLATE);
  });

  it('badges a tax search in flight, because it resolves itself later', () => {
    // The row changes on its own when the search lands. An operator looking at a
    // profile with no page 4 needs to know whether to wait.
    expect(visible(<ReportRow row={profile({ taxStatus: 'pending' })} />)).toContain('tax running');
    expect(visible(<ReportRow row={profile({ taxStatus: 'ready' })} />)).toContain('tax');
    expect(visible(<ReportRow row={profile({ taxStatus: null })} />)).not.toContain('tax');
  });

  it('badges nothing about tax on a farming report, which has none', () => {
    expect(visible(<ReportRow row={row({ type: 'county_sales', taxStatus: 'pending' })} />)).not.toContain('tax running');
  });
});

describe('a report row', () => {
  it('leads with the subject and keeps the type under it', () => {
    // CHANGED 2026-09-30 (Gerard's design review). This used to assert Subject
    // and Settings as separate COLUMNS, on the reasoning that the separation is
    // what lets one table hold four types. The separation survives — subject on
    // the first line, type and detail on the second — but as one column, which
    // gives Actions the ~200px it did not have.
    const text = visible(<ReportRow row={row()} />);
    expect(text).toContain('Orange County');
    expect(text).toContain('County Sales');
    expect(text).toContain('44 cities');
  });

  it('keeps Settings reachable as a tooltip, not as a column', () => {
    // "1 mi · 12 mo · ±30% size" is identical on every Concierge row, so as a
    // column it spent 20% of the table on something nobody can scan by. It is
    // still THERE — dropping it outright would lose the one moment somebody
    // wants it — just not occupying a column.
    const html = renderToStaticMarkup(<table><tbody><ReportRow row={row()} /></tbody></table>);
    expect(html).toContain('title="August 2026"');
    // And it is no longer its own cell.
    expect(visible(<ReportRow row={row() } />)).toContain('Orange County');
    expect(html.match(/<th/g) ?? []).toHaveLength(0);
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

  it('offers a menu on a finished report and none while it builds', () => {
    // What the menu CONTAINS is driven in the interactive file; this is only that
    // there is one to open, and that a row with nothing to offer offers nothing.
    const done = renderToStaticMarkup(<table><tbody><ReportRow row={row()} /></tbody></table>);
    expect(done).toContain('aria-label="Actions"');
    const building = renderToStaticMarkup(<table><tbody><ReportRow row={row({ status: 'pending' })} /></tbody></table>);
    expect(building).not.toContain('aria-label="Actions"');
  });

  it('makes a finished row openable and a building row not', () => {
    // A click that does nothing teaches the operator the page is broken, so the
    // affordance only exists where there is a document behind it.
    //
    // The affordance is an ANCHOR on the subject plus a click handler on the row,
    // never role="link" on the <tr> — that opens the document and takes the row
    // out of the table for anyone using a screen reader. See ReportRow.
    const done = renderToStaticMarkup(<table><tbody><ReportRow row={row()} /></tbody></table>);
    expect(done).toContain('cursor-pointer');
    expect(done).toMatch(/<a href="[^"]*\/pdf"/);
    expect(done).not.toContain('role="link"');

    for (const status of ['pending', 'retrieved', 'failed']) {
      const html = renderToStaticMarkup(<table><tbody><ReportRow row={row({ status })} /></tbody></table>);
      expect(html, status).not.toContain('cursor-pointer');
      expect(html, status).not.toMatch(/<a href="[^"]*\/pdf"/);
    }
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
    // FIVE now, not seven: Report and Subject merged, Settings became a tooltip.
    const widths = src.match(/COLUMN_WIDTHS = \[[^\]]+\]/)![0].split(',');
    expect(widths).toHaveLength(5);
    // The header count has to match, or every cell lands under the wrong label.
    // Counted from the <th> elements rather than trusted to review.
    expect(src.match(/<th /g) ?? []).toHaveLength(5);
  });

  it('declares widths that add up to 100%', () => {
    // A fixed layout with widths summing to less than 100 leaves the last column
    // stretched and the head out of step with the body.
    const src = page();
    const nums = [...src.match(/COLUMN_WIDTHS = \[[^\]]+\]/)![0].matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    expect(nums.reduce((a, b) => a + b, 0)).toBe(100);
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
