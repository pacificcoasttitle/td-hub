import { describe, expect, it } from 'vitest';
import {
  documentReceivedTemplate,
  milestoneDisbursementTemplate,
  milestoneRecordingTemplate,
  orderClosedTemplate,
  type DocumentEmailData,
  type OrderEmailData,
} from './templates';

const orderData: OrderEmailData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  closingDate: '2026-07-15',
};

const documentData: DocumentEmailData = {
  ...orderData,
  category: 'prelim',
};

function expectSharedShell(html: string, title: string) {
  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('Pacific Coast Title');
  expect(html).toContain(`>${title}</td>`);
  expect(html).toContain('border-radius:16px');
  expect(html).toContain('hub.pctitle.com');
}

describe('notification templates', () => {
  it('renders order closed through the shared shell without changing subject or wording', () => {
    const rendered = orderClosedTemplate(orderData);

    expect(rendered.subject).toBe('Your Order 20018881-OCT has been closed');
    expectSharedShell(rendered.html, 'Order Closed');
    expect(rendered.html).toContain('Order Closed');
    expect(rendered.html).toContain('The following order has been');
    expect(rendered.html).toContain('All parties have been notified. Please review the final documents in the portal.');
    expect(rendered.html).toContain('View Order Details');
  });

  it('renders recording milestone through the shared shell without changing subject or wording', () => {
    const rendered = milestoneRecordingTemplate(orderData);

    expect(rendered.subject).toBe('Recording confirmed for 20018881-OCT at 5792 Adobe Rd, Twentynine Palms, CA');
    expectSharedShell(rendered.html, 'Recording');
    expect(rendered.html).toContain('Recording Confirmed');
    expect(rendered.html).toContain('Recording has been');
    expect(rendered.html).toContain('The recording confirmation has been received and the order is progressing.');
    expect(rendered.html).toContain('View Order');
  });

  it('renders disbursement milestone through the shared shell without changing subject or wording', () => {
    const rendered = milestoneDisbursementTemplate(orderData);

    expect(rendered.subject).toBe('Disbursement completed for 20018881-OCT');
    expectSharedShell(rendered.html, 'Disbursement');
    expect(rendered.html).toContain('Disbursement Completed');
    expect(rendered.html).toContain('Disbursement has been');
    expect(rendered.html).toContain('Funds have been disbursed. Please verify receipt and review details in the portal.');
    expect(rendered.html).toContain('View Order');
  });

  it('renders document received through the shared shell without changing subject or wording', () => {
    const rendered = documentReceivedTemplate(documentData);

    expect(rendered.subject).toBe('New prelim document for Order 20018881-OCT');
    expectSharedShell(rendered.html, 'Document');
    expect(rendered.html).toContain('New Document Available');
    expect(rendered.html).toContain('A new');
    expect(rendered.html).toContain('Prelim');
    expect(rendered.html).toContain('document has been added to this order.');
    expect(rendered.html).toContain('You can view and download the document from the portal.');
    expect(rendered.html).toContain('View Documents');
  });
});
