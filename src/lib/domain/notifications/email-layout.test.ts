import { describe, expect, it, vi } from 'vitest';
import {
  BG_LIGHT,
  BORDER_SOFT,
  CARD_BG,
  PCT_NAVY,
  PCT_ORANGE,
  PCT_DARK_LOGO_PATH,
  PCT_LIGHT_LOGO_URL,
  TEXT_MUTED,
  TEXT_PRIMARY,
  button,
  detailsRow,
  emailLayout,
  esc,
} from './email-layout';
import { orderConfirmationTemplate, type FullConfirmationData } from './confirmation-template';

function legacyEsc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function legacyRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 14px;font-size:13px;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER_SOFT};width:38%;">${label}</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:600;color:${TEXT_PRIMARY};border-bottom:1px solid ${BORDER_SOFT};">${legacyEsc(value)}</td>
  </tr>`;
}

function legacyButton(text: string, href: string): string {
  return `<td style="background:${PCT_ORANGE};border:1px solid ${PCT_ORANGE};border-radius:8px;padding:12px 18px;">
    <a href="${href}" style="color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:700;display:block;">${text}</a>
  </td>`;
}

function legacyLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:${BG_LIGHT};font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG_LIGHT};padding:24px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD_BG};border-radius:16px;overflow:hidden;border:1px solid ${BORDER_SOFT};">
  <tr><td style="background:${PCT_NAVY};padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${PCT_LIGHT_LOGO_URL}" height="30" alt="Pacific Coast Title" style="display:block;height:30px;width:auto;border:0;outline:none;text-decoration:none;"/></td>
      <td align="right" style="color:${PCT_ORANGE};font-size:12px;text-transform:uppercase;letter-spacing:1px;">${legacyEsc(title)}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;">${body}</td></tr>
  <tr><td style="padding:0 32px 24px;border-top:1px solid ${BORDER_SOFT};">
    <p style="font-size:12px;color:${TEXT_MUTED};margin:16px 0 0;">
      Pacific Coast Title Company &bull; Automated notification<br/>
      <a href="https://www.pct.com" style="color:${PCT_ORANGE};text-decoration:none;">www.pct.com</a>
    </p>
  </td></tr>
</table>
</td></tr></table></body></html>`.trim();
}

function extractLayoutBody(html: string): string {
  const prefix = `<tr><td style="padding:32px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;">`;
  const suffix = `</td></tr>
  <tr><td style="padding:0 32px 24px;border-top:1px solid ${BORDER_SOFT};">`;
  const start = html.indexOf(prefix);
  const end = html.indexOf(suffix);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Unable to extract email layout body');
  }
  return html.slice(start + prefix.length, end);
}

const confirmationFixture: FullConfirmationData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  transactionType: 'Purchase',
  productType: 'Standard',
  salesPrice: '$500,000',
  loanAmount: '$400,000',
  loanNumber: 'LN-123',
  escrowNumber: 'ESC-456',
  opener: {
    name: 'Open Order Desk',
    email: 'openorders@pct.com',
    phone: '555-0100',
    company: 'Pacific Coast Title',
  },
  property: {
    address: '5792 Adobe Rd',
    city: 'Twentynine Palms',
    zip: '92277',
    county: 'San Bernardino',
    apn: '0618-123-45',
    legalDescription: 'Lot 1',
  },
  seller: { primary: 'Seller One', secondary: 'Seller Two' },
  parties: {
    buyerAgent: { name: 'Buyer Agent', email: 'buyer@example.com', phone: '555-0101', company: 'Buyer Realty' },
    listingAgent: { name: 'Listing Agent', email: 'listing@example.com', phone: '555-0102', company: 'Listing Realty' },
    lender: { name: 'Lender Contact', email: 'lender@example.com', phone: '555-0103', company: 'Lender Co' },
    escrow: { name: 'Escrow Contact', email: 'escrow@example.com', phone: '555-0104', company: 'Escrow Co' },
  },
  assignments: { salesRep: 'Sales Rep', titleOfficer: 'Title Officer' },
  taxData: {
    taxRateArea: '123',
    firstInstallment: { amount: '$1,000', dueDate: '2026-12-10' },
  },
  hasDocuments: true,
  isTitlePointActive: true,
};

describe('emailLayout', () => {
  it('renders the shared branded shell and helpers', () => {
    const body = '<p>Body & content</p>';
    const html = emailLayout('Order Confirmation', body);

    expect(esc('A & "B" < C > D')).toBe(legacyEsc('A & "B" < C > D'));
    expect(detailsRow('Label', 'Value & <x>')).toBe(legacyRow('Label', 'Value & <x>'));
    expect(button('Open', 'https://hub.pctitle.com/orders')).toBe(legacyButton('Open', 'https://hub.pctitle.com/orders'));
    expect(html).toBe(legacyLayout('Order Confirmation', body));
    expect(PCT_LIGHT_LOGO_URL).toMatch(/^https?:\/\//);
    expect(html).toContain(`<img src="${PCT_LIGHT_LOGO_URL}" height="30" alt="Pacific Coast Title"`);
    expect(html).toContain('<a href="https://www.pct.com" style="color:#F26B2B;text-decoration:none;">www.pct.com</a>');
    expect(html).not.toContain('hub.pctitle.com</a>');
    expect(PCT_DARK_LOGO_PATH).toBe('/logo2-dark.png');
  });

  it('order-confirmation uses the PCT redesign shell (not the legacy emailLayout wrapper)', () => {
    const rendered = orderConfirmationTemplate(confirmationFixture);

    expect(rendered.html).toContain('background:#10213A');
    expect(rendered.html).toContain('ORDER CONFIRMATION');
    expect(rendered.html).toContain('Your title order is open');
    expect(rendered.html).toContain('https://www.pct.com/logo2.png');
    expect(rendered.html).not.toContain('logo2-light.png');
  });

  it('normalizes trailing slashes before appending the logo path', async () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://td-hub.vercel.app/';
    vi.resetModules();
    const layout = await import('./email-layout');

    expect(layout.PCT_LIGHT_LOGO_URL).toBe('https://td-hub.vercel.app/logo2-light.png');
    expect(layout.emailLayout('Sample', '<p>Body</p>')).toContain('src="https://td-hub.vercel.app/logo2-light.png"');
    expect(layout.emailLayout('Sample', '<p>Body</p>')).not.toContain('td-hub.vercel.app//logo2-light.png');

    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
    vi.resetModules();
  });
});
