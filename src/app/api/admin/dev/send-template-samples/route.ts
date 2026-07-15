import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import {
  documentReceivedTemplate,
  milestoneDisbursementTemplate,
  milestoneRecordingTemplate,
  orderClosedTemplate,
  orderConfirmationTemplate,
  type OrderConfirmationData,
} from '@/lib/domain/notifications/templates';
import { prelimDeliverySampleTemplate } from '@/lib/domain/notifications/prelim-delivery-send';

const ADMIN_ROLES = ['super_admin', 'admin'];
const SAMPLE_RECIPIENT = 'ghernandez@pct.com';

const orderData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  closingDate: 'July 31, 2026',
};

const confirmationData: OrderConfirmationData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  transactionType: 'Purchase',
  productType: 'Standard',
  salesPrice: '$500,000',
  loanAmount: '$400,000',
  loanNumber: 'LN-123456',
  escrowNumber: 'ESC-78910',
  opener: {
    name: 'Open Order Desk',
    email: 'openorders@pct.com',
    phone: '(562) 555-0100',
    company: 'Pacific Coast Title',
  },
  property: {
    address: '5792 Adobe Rd',
    city: 'Twentynine Palms',
    zip: '92277',
    county: 'San Bernardino',
    apn: '0618-123-45',
    legalDescription: 'Lot 1 of Tract 12345',
  },
  taxData: {
    taxRateArea: '123-456',
    taxRate: '1.125%',
    firstInstallment: { amount: '$2,100.00', dueDate: '2026-12-10', status: 'Open' },
    secondInstallment: { amount: '$2,100.00', dueDate: '2027-04-10', status: 'Open' },
  },
  seller: { primary: 'Sample Seller', secondary: 'Sample Co-Seller' },
  parties: {
    buyerAgent: { name: 'Buyer Agent', email: 'buyer.agent@example.com', phone: '(562) 555-0101', company: 'Buyer Realty' },
    listingAgent: { name: 'Listing Agent', email: 'listing.agent@example.com', phone: '(562) 555-0102', company: 'Listing Realty' },
    lender: { name: 'Lender Contact', email: 'lender@example.com', phone: '(562) 555-0103', company: 'Lender Co' },
    escrow: { name: 'Escrow Officer', email: 'escrow@example.com', phone: '(562) 555-0104', company: 'Escrow Co' },
  },
  assignments: { salesRep: 'Sample Sales Rep', titleOfficer: 'Sample Title Officer' },
  hasDocuments: true,
  isTitlePointActive: true,
};

function sampleTemplates() {
  return [
    { key: 'order_confirmation', ...orderConfirmationTemplate(confirmationData) },
    { key: 'order_closed', ...orderClosedTemplate(orderData) },
    { key: 'milestone_recording', ...milestoneRecordingTemplate(orderData) },
    { key: 'milestone_disbursement', ...milestoneDisbursementTemplate(orderData) },
    { key: 'document_received', ...documentReceivedTemplate({ ...orderData, category: 'prelim' }) },
    {
      key: 'prelim_delivery',
      ...prelimDeliverySampleTemplate({
        fileNumber: orderData.fileNumber,
        propertyAddress: orderData.address,
        apn: '0618-123-45',
        titleOfficerName: 'Sample Title Officer',
        titleOfficerEmail: 'unit66@pct.com',
        titleOfficerPhone: '(818) 662-6720',
        attachmentSizeBytes: 505_352,
      }),
    },
  ];
}

export async function POST() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = [];
  for (const template of sampleTemplates()) {
    const subject = `[SAMPLE] ${template.subject}`;
    const result = await sendEmail({
      to: SAMPLE_RECIPIENT,
      subject,
      html: template.html,
      text: 'text' in template ? template.text : undefined,
    });

    if (!result.success || !result.data) {
      return NextResponse.json({
        success: false,
        error: result.error?.message ?? `Failed to send ${template.key}`,
        sent: results,
        failedTemplate: template.key,
      }, { status: 502 });
    }

    results.push({
      key: template.key,
      to: SAMPLE_RECIPIENT,
      subject,
      messageId: result.data.messageId,
    });
  }

  return NextResponse.json({
    success: true,
    sent: results,
    count: results.length,
  });
}
