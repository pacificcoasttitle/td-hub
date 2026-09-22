import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { NotifyRepControl, notifyBlockedReason, notifyConfirmText } from './notify-rep-control';
import { ReportRow } from './reports-list-page';

const row = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  type: 'county_sales', id: 3, typeLabel: 'County Sales', sourceLine: 'Dataset',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  brandedToName: 'Mark Neveu', brandedToEmail: 'mneveu@pct.com', status: 'generated',
  createdAt: '2026-09-21 21:14:00', createdBy: 'ops@pct.com', delivery: null, ...over,
});

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the confirmation', () => {
  it('names who, where, and that the PDF goes with it', () => {
    expect(notifyConfirmText(row())).toBe('Email this County Sales report to Mark Neveu at mneveu@pct.com? The PDF is attached.');
  });

  it('never calls it sending', () => {
    expect(notifyConfirmText(row())).not.toMatch(/\bsend\b/i);
    expect(text(<NotifyRepControl row={row()} />)).not.toMatch(/\bSend\b/);
  });
});

describe('when there is nowhere to send it', () => {
  it('turns the button off and says why', () => {
    const r = row({ brandedToEmail: null });
    expect(notifyBlockedReason(r)).toBe('Mark Neveu has no email address on the report.');
    const html = renderToStaticMarkup(<NotifyRepControl row={r} />);
    // The attribute, not the word: the Tailwind classes contain "disabled:".
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="Mark Neveu has no email address on the report."');
  });

  it('treats a blank address as none', () => {
    expect(notifyBlockedReason(row({ brandedToEmail: '  ' }))).not.toBeNull();
  });

  it('leaves the button on when there is an address', () => {
    expect(notifyBlockedReason(row())).toBeNull();
    expect(renderToStaticMarkup(<NotifyRepControl row={row()} />)).not.toContain('disabled=""');
  });
});

describe('on the list', () => {
  const inTable = (r: ReportListRow) => renderToStaticMarkup(<table><tbody><ReportRow row={r} /></tbody></table>);

  it('offers Notify rep on a generated farming report', () => {
    expect(text(<table><tbody><ReportRow row={row()} /></tbody></table>)).toContain('Notify rep');
  });

  it('does not offer it on a concierge profile', () => {
    expect(inTable(row({ type: 'concierge_profile', typeLabel: 'Concierge Profile' }))).not.toContain('Notify rep');
  });

  it('does not offer it on a report still building or one that failed', () => {
    expect(inTable(row({ status: 'pending' }))).not.toContain('Notify rep');
    expect(inTable(row({ status: 'failed' }))).not.toContain('Notify rep');
  });
});
