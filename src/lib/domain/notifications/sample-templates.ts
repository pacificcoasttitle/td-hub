/**
 * Sample payloads for every customer/ops email TD Hub can send.
 * Used by the admin sample API and scripts/send-all-notification-samples.ts.
 */

import {
  documentReceivedTemplate,
  milestoneDisbursementTemplate,
  milestoneRecordingTemplate,
  orderClosedTemplate,
  orderConfirmationTemplate,
  type OrderConfirmationData,
} from '@/lib/domain/notifications/templates';
import { prelimDeliverySampleTemplate } from '@/lib/domain/notifications/prelim-delivery-send';
import { buildInviteHtml, buildInviteSubject } from '@/lib/domain/notifications/invite-email';
import {
  buildPartyWizardEmail,
  buildPartyWizardSubject,
  buildPartyWizardText,
} from '@/lib/domain/parties/party-wizard-email';
import {
  buildSubject as buildOpsSubject,
  renderDailySummaryHtml,
  renderDailySummaryText,
} from '@/lib/domain/ops/daily-summary-email';
import { previousPacificDay, formatDayLabel } from '@/lib/domain/ops/calendar-day';
import type { DailySummary } from '@/lib/domain/ops/daily-summary';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');

export interface SampleEmail {
  key: string;
  label: string;
  subject: string;
  html: string;
  text?: string;
}

const orderData = {
  fileNumber: '20018881-OCT',
  address: '5792 Adobe Rd, Twentynine Palms, CA',
  closingDate: 'July 31, 2026',
};

const confirmationData: OrderConfirmationData = {
  fileNumber: '20018881-OCT',
  address: '28817 Park Woodland Pl, Santa Clarita, CA 91390',
  productType: 'Short Form',
  loanNumber: '070319680000081',
  openedAt: '2026-08-17T22:34:00Z',
  opener: {
    name: 'Ryan Robles',
    email: 'ryan@CALUNIONFUNDING.COM',
    phone: '818-579-2964',
    company: 'Calunion Funding, Inc.',
    address: '6400 Laurel Canyon Blvd. Suite 230',
    city: 'North Hollywood',
    zip: '91606',
  },
  property: {
    address: '28817 Park Woodland Pl',
    city: 'Santa Clarita, CA',
    zip: '91390',
    county: 'Los Angeles',
    apn: '2812-060-005',
    legalDescription: 'Lot:4 Tr#:46038 Tr=46038 Lot 4',
  },
  taxData: {
    taxRateArea: '15971',
    useCode: '0101',
    regionCode: 'NEWHALL-SAUGUS',
    zoningCode: 'SCUR2',
    taxRate: '1.337557',
    issueDate: '10/15/2025',
    landValue: '$621,437.00',
    improvementsValue: '$453,906.00',
    firstInstallment: { amount: '$7,191.67', dueDate: '12/10/2025', status: 'PAID', number: '1st', paymentDate: '12/9/2025', penalty: '$0.00', amountPaid: '$7,191.67', taxYear: '2025' },
    secondInstallment: { amount: '$7,191.66', dueDate: '4/10/2026', status: 'PAID', number: '2nd', paymentDate: '4/10/2026', penalty: '$0.00', amountPaid: '$7,191.66', taxYear: '2025' },
  },
  seller: { primary: 'Lenin Sanchez', secondary: 'Sanchez Family Living Trust The' },
  parties: {
    escrow: { name: 'Ana Ortega', email: 'ana@anescrow.com', phone: 'Ana Ortega', company: 'Ana Ortega' },
  },
  assignments: { salesRep: 'GlendaleHouseAccount', titleOfficer: 'PCT\\rdickerson' },
  hasDocuments: true,
  isTitlePointActive: true,
};

function sampleOpsSummary(): DailySummary {
  const now = new Date();
  const window = previousPacificDay(now);
  return {
    dayLabel: formatDayLabel(window.ymd),
    window,
    generatedAt: now,
    attention: [
      '2 SoftPro sync jobs failed overnight and need a look.',
      'Prelim auto-delivery skipped 1 order pending title-officer review.',
    ],
    numbers: {
      ordersFromSoftPro: 12,
      ordersCreatedHere: 3,
      prelimsDelivered: 8,
      prelimsSummarised: 5,
      cplsGenerated: 15,
      emailsSent: 40,
      emailsFailed: 0,
    },
    complete: true,
    unavailable: [],
  };
}

/** All sendable system notification samples. */
export function buildAllSampleEmails(): SampleEmail[] {
  const partyInput = {
    fileNumber: orderData.fileNumber,
    propertyAddress: orderData.address,
    transactionType: 'Purchase',
    escrowOfficerName: 'Jamie Escrow',
    openedAt: new Date('2026-07-15T16:00:00Z'),
    // v1 wizard collects listing_agent only (escrow forwards the link).
    roleLinks: [
      { role: 'listing_agent' as const, url: `${APP_URL}/party/sample-listing-agent-token` },
    ],
  };

  const ops = sampleOpsSummary();
  const opsDashboard = `${APP_URL}/admin/ops`;

  return [
    {
      key: 'order_confirmation',
      label: 'Open order confirmation',
      ...orderConfirmationTemplate(confirmationData),
    },
    {
      key: 'order_closed',
      label: 'Order closed',
      ...orderClosedTemplate(orderData),
    },
    {
      key: 'milestone_recording',
      label: 'Recording confirmation',
      ...milestoneRecordingTemplate(orderData),
    },
    {
      key: 'milestone_disbursement',
      label: 'Funds disbursed',
      ...milestoneDisbursementTemplate(orderData),
    },
    {
      key: 'document_received_prelim',
      label: 'Document ready (prelim summary)',
      ...documentReceivedTemplate({ ...orderData, category: 'prelim' }),
    },
    {
      key: 'document_received_policy',
      label: 'Document ready (policy delivery)',
      ...documentReceivedTemplate({ ...orderData, category: 'policy' }),
    },
    {
      key: 'prelim_delivery',
      label: 'Prelim PDF delivery',
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
    {
      key: 'party_wizard_invite',
      label: 'Party information collection',
      subject: buildPartyWizardSubject(partyInput),
      html: buildPartyWizardEmail(partyInput),
      text: buildPartyWizardText(partyInput),
    },
    {
      key: 'user_invite',
      label: 'User invite (admin)',
      subject: buildInviteSubject(),
      html: buildInviteHtml(
        'Gerardo Hernandez',
        'admin',
        `${APP_URL}/auth/callback?sample=1`,
        APP_URL,
      ),
    },
    {
      key: 'ops_daily_report',
      label: 'Ops daily report',
      subject: buildOpsSubject(ops),
      html: renderDailySummaryHtml(ops, opsDashboard),
      text: renderDailySummaryText(ops, opsDashboard),
    },
  ];
}
