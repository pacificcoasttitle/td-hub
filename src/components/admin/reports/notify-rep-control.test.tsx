import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { NotifyRepControl, notifyBlockedReason, notifyConfirmText } from './notify-rep-control';
import { ReportRow } from './reports-list-page';

const row = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  type: 'county_sales', id: 3, typeLabel: 'County Sales', sourceLine: 'Dataset',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  brandedToName: 'Mark Neveu', brandedToEmail: 'mneveu@pct.com', status: 'generated',
  createdAt: '2026-09-21 21:14:00', createdBy: 'ops@pct.com', madeBy: 'Operations', delivery: null, templateVersion: 'cs-v1',
  groupKey: null, taxStatus: null, ...over,
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
  it('turns the item off and says why, in text rather than a tooltip', () => {
    const r = row({ brandedToEmail: null });
    expect(notifyBlockedReason(r)).toBe('Mark Neveu has no email address on the report.');
    const html = renderToStaticMarkup(<NotifyRepControl row={r} />);
    // The attribute, not the word: the Tailwind classes contain "disabled:".
    expect(html).toContain('disabled=""');
    // CHANGED 2026-09-30: this was a `title`, which a touch device never shows
    // and a screen reader never announces — so the one explanation of why the
    // control is dead was invisible to anyone not hovering a mouse. In the kebab
    // it is simply read.
    expect(html).toContain('Mark Neveu has no email address on the report.');
    expect(html).not.toContain('title=');
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

  // The row's kebab is closed until it is opened, so "the list offers Notify rep"
  // is now a statement about an interaction and is driven in
  // reports-list-page.interactive.test.tsx. What survives here is the NEGATIVE
  // half, which is still true of a closed menu and is the half that matters: a
  // row must not carry this control at all where sending would be wrong.

  it('does not offer it on a concierge profile', () => {
    // A profile is branded to a presenting rep by name and email, not by contact
    // id, and legacy's rep list held only the farming three.
    expect(inTable(row({ type: 'concierge_profile', typeLabel: 'Concierge Profile' }))).not.toContain('Notify rep');
  });

  it('does not offer it on a report still building or one that failed', () => {
    // There is nothing to attach to an email.
    expect(inTable(row({ status: 'pending' }))).not.toContain('Notify rep');
    expect(inTable(row({ status: 'failed' }))).not.toContain('Notify rep');
  });
});
