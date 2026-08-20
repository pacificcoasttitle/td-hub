import { describe, expect, it } from 'vitest';
import {
  documentReceivedTemplate,
  milestoneDisbursementTemplate,
  milestoneRecordingTemplate,
  orderClosedTemplate,
  type DocumentEmailData,
  type OrderEmailData,
} from './templates';
import { HEADER_BG } from './email-layout';

const orderData: OrderEmailData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  closingDate: '2026-07-15',
};

const documentData: DocumentEmailData = {
  ...orderData,
  category: 'prelim',
};

function expectRedesignShell(html: string) {
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('Pacific Coast Title');
  expect(html).toContain(`background:${HEADER_BG}`);
  expect(html).toContain('border-radius:18px');
  expect(html).toContain('pct.com');
}

describe('notification templates', () => {
  it('renders order closed in the redesign shell', () => {
    const rendered = orderClosedTemplate(orderData);
    expect(rendered.subject).toBe('Your Order 20018881-OCT has been closed');
    expectRedesignShell(rendered.html);
    expect(rendered.html).toContain('Your order is closed.');
    expect(rendered.html).toContain('View Order Details');
  });

  it('renders recording milestone in the redesign shell', () => {
    const rendered = milestoneRecordingTemplate(orderData);
    expect(rendered.subject).toBe('Recording confirmed for 20018881-OCT at 5792 Adobe Rd, Twentynine Palms, CA');
    expectRedesignShell(rendered.html);
    expect(rendered.html).toContain('Recording confirmed.');
    expect(rendered.html).toContain('View Order');
  });

  it('renders disbursement milestone in the redesign shell', () => {
    const rendered = milestoneDisbursementTemplate(orderData);
    expect(rendered.subject).toBe('Disbursement completed for 20018881-OCT');
    expectRedesignShell(rendered.html);
    expect(rendered.html).toContain('Funds have been disbursed.');
    expect(rendered.html).toContain('View Order');
  });

  it('renders document received in the redesign shell', () => {
    const rendered = documentReceivedTemplate(documentData);
    expect(rendered.subject).toBe('New prelim document for Order 20018881-OCT');
    expectRedesignShell(rendered.html);
    expect(rendered.html).toContain('A new prelim is ready.');
    expect(rendered.html).toContain('View Documents');
  });
});
