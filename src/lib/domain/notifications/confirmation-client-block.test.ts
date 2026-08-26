import { describe, expect, it } from 'vitest';
import { orderConfirmationTemplate, type FullConfirmationData } from './confirmation-template';

// ─── The order-summary block, before and after ──────────────────────────────
//
// Production confirmation for 20021376-OCT rendered Company, Address, City,
// ZIP, Sales rep, Title officer and Loan number as em dashes. The logged
// SoftPro create payload for the same order carried CompanyName "Atlas Escrow",
// Address "3731 Wilshire Boulevard", City "Los Angeles", ZipCode "90010",
// SalesRep "PCT\awu", TitleOffice "PCT\cvirata" and EscrowNumber "233370-GY".
//
// Two separate reasons, both proven here at the template boundary:
//   - the block was populated from the PCT staff profile that clicked the
//     button (no contact row -> null joins) instead of the client
//   - sales rep, title officer, loan number and escrow number were never
//     handed to the template at all

const BASE: FullConfirmationData = {
  fileNumber: '20021376-OCT',
  transactionType: 'Refinance',
  productType: 'Short Form',
  property: {
    address: '8641 Universe Ave',
    city: 'Westminster',
    zip: '92683',
    county: 'Orange',
    apn: '107-493-04',
    legalDescription: 'N TR 9185 BLK LOT 4',
  },
  hasDocuments: false,
  isTitlePointActive: true,
};

/** What loadOpener produced: a staff profile whose contact join came back empty. */
const STAFF_OPENER = {
  name: 'Jerry Hernandez',
  email: 'ghernandez@pct.com',
  phone: null,
  company: null,
  address: null,
  city: null,
  zip: null,
};

/** The client the order was opened for — orders.client_contact_id 13233. */
const CLIENT = {
  name: 'Grace Yu',
  email: 'grace.yu@atlasescrow.us',
  phone: null,
  company: 'Atlas Escrow',
  address: '3731 Wilshire Boulevard',
  city: 'Los Angeles',
  zip: '90010',
};

const CLIENT_FACTS = ['Atlas Escrow', '3731 Wilshire Boulevard', 'Los Angeles', '90010'];

describe('confirmation order-summary block', () => {
  it('BEFORE: the staff profile renders a name and an email, and nothing else', () => {
    const { html } = orderConfirmationTemplate({ ...BASE, opener: STAFF_OPENER });

    expect(html).toContain('Jerry Hernandez');
    expect(html).toContain('ghernandez@pct.com');
    // Every row below the email came back null from the profiles->contacts join.
    for (const fact of CLIENT_FACTS) expect(html).not.toContain(fact);
  });

  it('AFTER: the client fills Company, Address, City and ZIP', () => {
    const { html } = orderConfirmationTemplate({ ...BASE, opener: CLIENT });

    expect(html).toContain('Grace Yu');
    expect(html).toContain('grace.yu@atlasescrow.us');
    for (const fact of CLIENT_FACTS) expect(html).toContain(fact);
  });
});

describe('confirmation transaction details', () => {
  it('BEFORE: sales rep, title officer, loan number and escrow number are absent', () => {
    const { html } = orderConfirmationTemplate({ ...BASE, opener: CLIENT });

    // The rows exist; the values were never passed, so each renders an em dash.
    expect(html).toContain('Sales rep');
    expect(html).toContain('Title officer');
    expect(html).toContain('Loan number');
    expect(html).toContain('Escrow number');
    expect(html).not.toContain('Amy Wu');
    expect(html).not.toContain('Cathy Virata');
    expect(html).not.toContain('LN-77421');
    expect(html).not.toContain('233370-GY');
  });

  it('AFTER: all four render the values the operator entered', () => {
    const { html } = orderConfirmationTemplate({
      ...BASE,
      opener: CLIENT,
      loanNumber: 'LN-77421',
      escrowNumber: '233370-GY',
      assignments: { salesRep: 'Amy Wu', titleOfficer: 'Cathy Virata' },
    });

    expect(html).toContain('Amy Wu');
    expect(html).toContain('Cathy Virata');
    expect(html).toContain('LN-77421');
    expect(html).toContain('233370-GY');
  });

  // Refinance money row reads orders.loan_amount, which create never wrote.
  it('AFTER: a persisted loan amount restores the money row on a Refinance', () => {
    const without = orderConfirmationTemplate({ ...BASE, opener: CLIENT });
    expect(without.html).not.toContain('$550,000');

    const withAmount = orderConfirmationTemplate({
      ...BASE,
      opener: CLIENT,
      loanAmount: '$550,000.00',
    });
    expect(withAmount.html).toContain('Loan amount');
    expect(withAmount.html).toContain('$550,000.00');
  });

  it('an order with none of it entered still renders every row as an em dash', () => {
    const { html } = orderConfirmationTemplate(BASE);
    expect(html).toContain('Loan number');
    expect(html).toContain('Escrow number');
    expect(html).toContain('>—</td>');
  });
});
