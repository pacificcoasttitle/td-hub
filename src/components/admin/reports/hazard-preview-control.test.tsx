import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readSource } from '@/test-support/read-source';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { HazardPreviewControl, hazardOffer } from './hazard-preview-control';

// Rendered and read as text. Grepping source for UI strings has failed silently
// in this project before.
function visible(el: React.ReactElement): string {
  return renderToStaticMarkup(el)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&middot;|&#xB7;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

const row = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  type: 'concierge_profile', id: 12, typeLabel: 'Property Profile', sourceLine: 'SiteX · 1 credit',
  subject: '2111 Gemma Ct', subjectDetail: 'Perris, CA', settings: '5 comps',
  brandedToName: 'Maria Lopez', brandedToEmail: 'mlopez@pct.com', status: 'generated',
  createdAt: '2026-10-12T00:00:00Z', createdBy: 'gerardoh@gmail.com', madeBy: null,
  delivery: null, templateVersion: 'v4', groupKey: 'k', taxStatus: null,
  hazardStatus: null, hazardError: null, ...over,
} as ReportListRow);

describe('the offer depends on where the profile is', () => {
  it('offers it free when it was never asked for', () => {
    const o = hazardOffer(null, null);
    expect(o.kind).toBe('add');
    expect(o.label).toContain('free');
  });

  it('offers to put a stored preview on the document', () => {
    // 'fetched' is the state profile 9 was silently in on the tax side while
    // reporting itself ready. The bytes exist; the document does not show them.
    const o = hazardOffer('fetched', null);
    expect(o.kind).toBe('finish');
    expect(o.note).toContain('re-renders');
  });

  it('makes no offer when it is already on the document', () => {
    expect(hazardOffer('ready', null).kind).toBe('none');
  });

  it('does NOT say "running — check again" on a stuck one', () => {
    // That wording is true of a tax search, which is sitting at TitlePoint with
    // an id to resume. MyNHD answers in one call, so there is nothing
    // part-finished, and telling an operator to "check" something that is not
    // running would be a lie borrowed from the control next to it.
    const o = hazardOffer('pending', null);
    expect(o.kind).toBe('retry');
    expect(o.label).not.toMatch(/check again/i);
    expect(o.note).toContain('nothing part-finished');
  });

  it('prints the vendor\'s own reason on a failed one', () => {
    // "The last attempt failed" is not something an operator can act on. A
    // multi-match, a missing entitlement and an outage want three different
    // responses.
    const o = hazardOffer('failed', 'This MyNHD account does not have preview access.');
    expect(o.kind).toBe('retry');
    expect(o.note).toContain('does not have preview access');
  });

  it('still offers a retry when no reason was recorded', () => {
    const o = hazardOffer('failed', '  ');
    expect(o.kind).toBe('retry');
    expect(o.note).toContain('free');
  });
});

describe('what the menu item says', () => {
  it('says free, because the item next to it says a price', () => {
    // TaxDetailControl states a cost in every offer, because silence among free
    // actions would read as free. This is the same rule in reverse: among a
    // priced item and free ones, saying nothing about cost is ambiguous exactly
    // where it matters.
    const t = visible(<HazardPreviewControl row={row()} />);
    expect(t.toLowerCase()).toContain('free');
  });

  it('calls it a preview and says it is not a disclosure', () => {
    // Gerard's decision 2, and the distinction PCT's exposure rests on.
    const t = visible(<HazardPreviewControl row={row()} />);
    expect(t).toContain('preview');
    expect(t).toContain('not a Natural Hazard Disclosure');
  });

  it('names MyNHD rather than implying PCT produced it', () => {
    expect(visible(<HazardPreviewControl row={row()} />)).toContain('MyNHD');
  });

  it('says nothing about a charge, a credit or a search', () => {
    const t = visible(<HazardPreviewControl row={row()} />).toLowerCase();
    expect(t).not.toContain('credit');
    expect(t).not.toContain('one search');
    expect(t).not.toContain('charge');
  });

  it('is inert and muted once the preview is on the document', () => {
    const html = renderToStaticMarkup(<HazardPreviewControl row={row({ hazardStatus: 'ready' })} />);
    expect(html).toContain('disabled');
    expect(visible(<HazardPreviewControl row={row({ hazardStatus: 'ready' })} />)).toContain('included');
  });
});

describe('what it posts', () => {
  it('posts to the profile\'s nhd route and nothing else', () => {
    const src = readSource('src/components/admin/reports/hazard-preview-control.tsx', {
      mustContain: 'export function HazardPreviewControl',
    });
    expect(src).toContain('/nhd');
    // Never the spenders. A free control that could reach either of those would
    // be a charge an operator did not agree to.
    expect(src).not.toMatch(/\/tax['"`]|api\/concierge\/profiles['"`]/);
  });

  it('does not claim nothing was charged on a tax-style network failure', () => {
    // The tax control deliberately refuses to guess here, because a request
    // that left the browser may have started a paid search. This one CAN say
    // it: there is nothing to charge. The two messages differ on purpose.
    const src = readSource('src/components/admin/reports/hazard-preview-control.tsx', {
      mustContain: 'Network error',
    });
    expect(src).toContain('nothing was charged');
  });
});
