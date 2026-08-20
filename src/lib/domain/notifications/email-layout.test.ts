import { describe, expect, it, vi } from 'vitest';
import {
  COASTLINE_HEADER,
  PCT_DARK_LOGO_PATH,
  PCT_LIGHT_LOGO_URL,
  PCT_LOGO_URL,
  PCT_ORANGE,
  button,
  detailsRow,
  emailLayout,
  emailShell,
  esc,
} from './email-layout';
import { orderConfirmationTemplate, type FullConfirmationData } from './confirmation-template';

const confirmationFixture: FullConfirmationData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  transactionType: 'Purchase',
  productType: 'Standard',
  salesPrice: '$500,000',
  loanAmount: '$400,000',
  hasDocuments: true,
  isTitlePointActive: true,
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
  assignments: { salesRep: 'Sales Rep', titleOfficer: 'Title Officer' },
  taxData: {
    firstInstallment: { amount: '$1,000', dueDate: '2026-12-10', status: 'Open' },
  },
};

describe('emailLayout / emailShell redesign', () => {
  it('escapes and builds field helpers', () => {
    expect(esc('A & "B" < C > D')).toBe('A &amp; &quot;B&quot; &lt; C &gt; D');
    expect(detailsRow('Label', 'Value & <x>')).toContain('Value &amp; &lt;x&gt;');
    expect(button('Open', 'https://hub.pctitle.com/orders')).toContain('href="https://hub.pctitle.com/orders"');
    expect(button('Open', 'https://hub.pctitle.com/orders')).toContain(PCT_ORANGE);
  });

  it('locks brand colors for dark mode', () => {
    const html = emailShell({
      title: 'Sample',
      badge: 'Order confirmation',
      hero: { icon: '✓', eyebrow: 'Order received', headline: 'Open.', subcopy: 'Ready.' },
      bodyHtml: '<p>Body</p>',
    });

    expect(html).toContain('color-scheme" content="light only"');
    expect(html).toContain('supported-color-schemes" content="light"');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('data-ogsc');
    expect(html).toContain('class="pct-navy pct-text-on-navy"');
    expect(html).toContain(`background-color: ${COASTLINE_HEADER} !important`);
    expect(html).toContain(`background-color: ${PCT_ORANGE} !important`);
  });


  it('emailLayout wraps content in the redesign shell', () => {
    const html = emailLayout('Order Confirmation', '<p>Body</p>');
    expect(html).toContain('Order Confirmation');
    expect(html).toContain('linear-gradient(180deg,#2C3564 0%,#15193A 100%)');
    expect(html).toContain('PACIFIC COAST TITLE COMPANY');
  });

  it('order-confirmation uses the PCT redesign shell', () => {
    const rendered = orderConfirmationTemplate(confirmationFixture);
    expect(rendered.html).toContain('linear-gradient(180deg,#2C3564 0%,#15193A 100%)');
    expect(rendered.html).toContain('Order confirmation');
    expect(rendered.html).toContain('Your title order is open.');
    expect(rendered.html).toContain('Order opened');
    expect(rendered.html).toContain('Wire disbursed');
    expect(rendered.html).not.toContain('logo2-light.png');
  });

  it('normalizes trailing slashes before appending the logo path', async () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://td-hub.vercel.app/';
    vi.resetModules();
    const layout = await import('./email-layout');

    expect(layout.PCT_LIGHT_LOGO_URL).toBe('https://td-hub.vercel.app/logo2-light.png');
    expect(layout.emailLayout('Sample', '<p>Body</p>')).not.toContain('td-hub.vercel.app//');

    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
    vi.resetModules();
  });
});
