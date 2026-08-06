import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewFields, type OrderDetail } from './detail-modal';

/**
 * Fixtures are REAL production order shapes (verified by query), so the rules
 * are tested against data that actually exists rather than invented cases:
 *
 *   6646 20020625-OCT Refinance sales_price "0.00" loan NULL      seller none
 *   6697 20020679-GLT Purchase  sales_price "775000.00" loan NULL seller "Naret Tosaard"
 *   2131 20016790-GLT Purchase  sales_price "750000.00" loan "500000.00" seller present
 */
function order(over: Partial<OrderDetail>): OrderDetail {
  return {
    operationalStatus: 'in_process', transactionType: null, productType: 'Short Form',
    openedAt: null, closedAt: null, salesPrice: null, loanAmount: null,
    sellerFirstName: null, sellerLastName: null,
    buyerFirstName: null, buyerLastName: null,
    source: 'softpro_sync',
    ...over,
  } as OrderDetail;
}

const REFI = order({
  transactionType: 'Refinance', salesPrice: '0.00', loanAmount: null,
  buyerFirstName: 'Praveen', buyerLastName: 'Bathala Chenchaiah',
});
const PURCHASE_NO_LOAN = order({
  transactionType: 'Purchase', salesPrice: '775000.00', loanAmount: null,
  sellerFirstName: 'Naret', sellerLastName: 'Tosaard',
});
const PURCHASE_WITH_LOAN = order({
  transactionType: 'Purchase', salesPrice: '750000.00', loanAmount: '500000.00',
  sellerFirstName: 'Fiorella', sellerLastName: 'Angelica Pozo',
});

/** Field labels actually rendered, in order. */
function fields(o: OrderDetail): string[] {
  const html = renderToStaticMarkup(<OverviewFields order={o} />);
  return [...html.matchAll(/tracking-wider[^>]*>([^<]+)</g)].map((m) => m[1]!.trim());
}

describe('Overview fields — refinance', () => {
  it('hides Sales Price and Seller, which are correct-empty on a refi', () => {
    const f = fields(REFI);
    expect(f).not.toContain('Sales Price');
    expect(f).not.toContain('Seller');
  });

  it('still shows everything that IS meaningful on a refi', () => {
    const f = fields(REFI);
    expect(f).toEqual(['Status', 'Transaction', 'Product', 'Opened', 'Closed', 'Buyer', 'Source']);
    // The borrower is the useful party on a refi and must survive.
    expect(renderToStaticMarkup(<OverviewFields order={REFI} />)).toContain('Praveen Bathala Chenchaiah');
  });
});

describe('Overview fields — purchase is untouched', () => {
  it('keeps Sales Price and Seller', () => {
    const f = fields(PURCHASE_NO_LOAN);
    expect(f).toContain('Sales Price');
    expect(f).toContain('Seller');
  });

  it('keeps Seller even when the purchase has none — that gap is worth seeing', () => {
    const f = fields(order({ transactionType: 'Purchase', salesPrice: '500000.00' }));
    expect(f).toContain('Seller');
    expect(renderToStaticMarkup(<OverviewFields order={order({ transactionType: 'Purchase' })} />))
      .toContain('—');
  });
});

describe('Overview fields — Loan Amount is value-gated, never type-gated', () => {
  it('is absent when null, on a purchase as well as a refi', () => {
    expect(fields(PURCHASE_NO_LOAN)).not.toContain('Loan Amount');
    expect(fields(REFI)).not.toContain('Loan Amount');
  });

  it('reappears on its own for an order that has one', () => {
    const f = fields(PURCHASE_WITH_LOAN);
    expect(f).toContain('Loan Amount');
    expect(renderToStaticMarkup(<OverviewFields order={PURCHASE_WITH_LOAN} />)).toContain('$500,000');
  });

  it('is hidden for a zero, not just a null', () => {
    // SoftPro sends "0" rather than null in places; both must read as absent.
    expect(fields(order({ transactionType: 'Purchase', loanAmount: '0.00' }))).not.toContain('Loan Amount');
  });

  it('would show on a refi too, if a refi ever had one', () => {
    // Proves the rule is value-based: type must not suppress a real number.
    expect(fields(order({ transactionType: 'Refinance', loanAmount: '565000.00' }))).toContain('Loan Amount');
  });
});

describe('Overview fields — unrecognised types keep every field', () => {
  it('does not hide anything for Other / Equity / null', () => {
    for (const t of ['Other', 'Equity', null]) {
      const f = fields(order({ transactionType: t, salesPrice: '0.00' }));
      expect(f).toContain('Sales Price');
      expect(f).toContain('Seller');
    }
  });
});

describe('Overview fields — client visibility is unchanged', () => {
  it('omits Source for the client portal', () => {
    const html = renderToStaticMarkup(<OverviewFields order={PURCHASE_WITH_LOAN} isClient />);
    expect(html).not.toContain('Source');
  });
});
