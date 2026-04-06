import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import {
  orderConfirmationTemplate,
  orderClosedTemplate,
  milestoneRecordingTemplate,
  milestoneDisbursementTemplate,
  documentReceivedTemplate,
} from '@/lib/domain/notifications/templates';
import type { FullConfirmationData } from '@/lib/domain/notifications/confirmation-template';

const ALLOWED_ROLES = ['super_admin', 'admin'];

const SAMPLE_ORDER = {
  fileNumber: '20015999-GLT',
  address: '1234 Main St, Los Angeles, CA 90001',
  closingDate: 'March 15, 2026',
};

const SAMPLE_CONFIRMATION: FullConfirmationData = {
  fileNumber: '20015999-GLT',
  address: '1234 Main St, Los Angeles, CA 90001',
  transactionType: 'Purchase',
  productType: 'Full ALTA',
  salesPrice: '$500,000',
  loanAmount: '$400,000',
  loanNumber: 'LN-2026-12345',
  escrowNumber: 'ESC-98765',
  opener: { name: 'CS Team (cs@pct.com)', email: 'cs@pct.com', phone: '(714) 555-0100', company: 'Pacific Coast Title' },
  property: { address: '1234 Main St', city: 'Los Angeles', zip: '90001', county: 'Los Angeles', apn: '1234-567-890', legalDescription: 'Lot 5, Block 3, Tract 12345' },
  taxData: {
    taxRateArea: '00-001',
    useCode: 'SFR',
    landValue: '$200,000',
    improvementsValue: '$300,000',
    taxRate: '1.15%',
    issueDate: 'January 1, 2026',
    firstInstallment: { amount: '$2,500', status: 'Paid', dueDate: 'November 1, 2025' },
    secondInstallment: { amount: '$2,500', status: 'Unpaid', dueDate: 'February 1, 2026' },
  },
  seller: { primary: 'Jane Doe', secondary: null },
  parties: {
    buyerAgent: { name: 'John Smith', email: 'jsmith@realty.com', phone: '(310) 555-0200', company: 'Smith Realty' },
    listingAgent: { name: 'Sarah Johnson', email: 'sarah@listings.com', phone: '(213) 555-0300', company: 'Premier Listings' },
    lender: { name: 'First National Bank', email: 'loans@fnb.com', phone: '(800) 555-0400', company: 'First National Bank' },
    escrow: { name: 'Pacific Escrow', email: 'escrow@pacific.com', phone: '(714) 555-0500', company: 'Pacific Escrow Services' },
  },
  assignments: { salesRep: 'Jerry Hernandez', titleOfficer: 'Eddie LasMarias' },
  hasDocuments: true,
  isTitlePointActive: true,
};

type TemplateResult = { subject: string; html: string };

const SLUG_TEMPLATES: Record<string, () => TemplateResult> = {
  'order.confirmation': () => orderConfirmationTemplate(SAMPLE_CONFIRMATION),
  'order.closed':       () => orderClosedTemplate(SAMPLE_ORDER),
  'order.milestone.recording':    () => milestoneRecordingTemplate(SAMPLE_ORDER),
  'order.milestone.disbursement': () => milestoneDisbursementTemplate(SAMPLE_ORDER),
  'order.document.received':      () => documentReceivedTemplate({ ...SAMPLE_ORDER, category: 'CPL' }),
  'prelim.summary':               () => documentReceivedTemplate({ ...SAMPLE_ORDER, category: 'Preliminary Report' }),
  'policy.delivery':              () => documentReceivedTemplate({ ...SAMPLE_ORDER, category: 'Title Policy' }),
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;
  const builder = SLUG_TEMPLATES[slug];

  if (!builder) {
    return NextResponse.json({
      error: 'No template mapped for this notification type',
      subject: null,
      html: `<div style="padding:40px;text-align:center;font-family:Arial,sans-serif;color:#6B7280;">
        <p style="font-size:16px;font-weight:600;">No email template available</p>
        <p style="font-size:13px;margin-top:8px;">This notification type does not have a preview template configured.</p>
      </div>`,
    });
  }

  const { subject, html } = builder();
  return NextResponse.json({ subject, html });
}
