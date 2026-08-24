import { describe, expect, it } from 'vitest';
import { buildOrderReadModel, type OrderReadModelData } from './read-model';
import { mapStaffOrderDetailResponse } from './staff-order-detail';
import { orderConfirmationTemplate } from '@/lib/domain/notifications/confirmation-template';

const sampleData: OrderReadModelData = {
  order: {
    id: 42,
    fileNumber: '20019922-GLT',
    escrowNumber: '20019922-GLT',
    source: 'softpro_sync',
    marketingSource: 'Sales Rep Referral',
    operationalStatus: 'in_process',
    softproStatus: 'In Process',
    softproLastSyncedAt: '2026-07-16T12:00:00.000Z',
    isImported: false,
    branchId: 1,
    lenderId: 9,
    underwriterId: 3,
    escrowOfficerId: 4,
    listingAgentId: 5,
    transactionType: 'Purchase',
    productType: 'Residential',
    orderType: 'Sale',
    salesPrice: '490000.00',
    loanAmount: '425000.00',
    premium: null,
    openedAt: '2026-07-15T18:00:00.000Z',
    completedAt: null,
    closedAt: null,
    receivedAt: '2026-07-15T17:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  },
  property: {
    address: '123 Main St',
    line2: 'Unit 4',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    county: 'Los Angeles',
    apn: '5641-001-002',
    legalDescription: 'Lot 1 of Tract 2',
    propertyType: 'Single Family',
    fullAddress: '123 Main St Unit 4, Glendale, CA 91203',
    primaryOwner: 'Sam Seller',
    secondaryOwner: null,
  },
  parties: [
    { id: 1, role: 'buyer', name: 'Bea Buyer', company: null, email: 'buyer@example.com', phone: null, isPrimary: true },
  ],
  assignments: {
    escrowOfficer: { name: 'Ella Escrow', email: 'ella@pct.com' },
    titleOfficer: { name: 'Tina Title', email: 'unit66@pct.com', phone: '555-0002' },
    salesRep: { name: 'Ryan Rep', email: 'ryan@pct.com' },
    createdBy: { id: 'profile-1', name: 'Opener User', email: 'opener@pct.com' },
  },
  documents: [
    { id: 11, category: 'prelim', filename: 'prelim-v2.pdf', sizeBytes: 2000, createdAt: '2026-07-17T17:00:00.000Z' },
  ],
  statusHistory: [
    { id: 7, status: 'recording_confirmation', source: 'softpro_sync', notes: 'Recording confirmed', changedAt: '2026-07-18T18:00:00.000Z' },
    { id: 6, status: 'in_process', source: 'manual_entry', notes: null, changedAt: '2026-07-15T18:00:00.000Z' },
  ],
  titleSearchCompletedAt: null,
};

describe('mapStaffOrderDetailResponse (full-page parity)', () => {
  it('maps every full-page field without inventing nulls for shown values', () => {
    const model = buildOrderReadModel(sampleData);
    const detail = mapStaffOrderDetailResponse(model);

    expect(detail).toMatchObject({
      id: 42,
      fileNumber: '20019922-GLT',
      operationalStatus: 'in_process',
      softproStatus: 'In Process',
      softproLastSyncedAt: '2026-07-16T12:00:00.000Z',
      transactionType: 'Purchase',
      productType: 'Residential',
      orderType: 'Sale',
      source: 'softpro_sync',
      salesPrice: '490000.00',
      loanAmount: '425000.00',
      isImported: false,
      openedAt: '2026-07-15T18:00:00.000Z',
      completedAt: null,
      closedAt: null,
      documents: { prelim: { exists: true } },
    });

    expect(detail.property).toMatchObject({
      address: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      county: 'Los Angeles',
      apn: '5641-001-002',
      legalDescription: 'Lot 1 of Tract 2',
      propertyType: 'Single Family',
      fullAddress: '123 Main St Unit 4, Glendale, CA 91203',
    });

    expect(detail.statusHistory).toEqual([
      {
        id: 7,
        status: 'recording_confirmation',
        source: 'softpro_sync',
        notes: 'Recording confirmed',
        changedAt: '2026-07-18T18:00:00.000Z',
      },
      {
        id: 6,
        status: 'in_process',
        source: 'manual_entry',
        notes: null,
        changedAt: '2026-07-15T18:00:00.000Z',
      },
    ]);

    // P3-2: never hard-null fields the UI shows
    expect(detail.source).not.toBeNull();
    expect(detail.property?.propertyType).not.toBeNull();
    expect(detail.softproStatus).not.toBeNull();
  });
});

describe('order-confirmation email parity with canonical formatters', () => {
  it('renders the same address/money/assignments the UI would show', () => {
    const model = buildOrderReadModel(sampleData);
    const to = model.assignments.titleOfficer;
    const { subject, html } = orderConfirmationTemplate({
      fileNumber: model.fileNumber,
      address: model.property.addressFormatted,
      transactionType: model.transactionType,
      productType: model.productType,
      salesPrice: model.financials.salesPriceFormatted,
      loanAmount: model.financials.loanAmountFormatted,
      opener: null,
      titleOfficer: to
        ? { name: to.name, email: to.email, phone: to.phone ?? null, company: null }
        : null,
      property: {
        address: model.property.line1,
        city: model.property.city,
        zip: model.property.zip,
        county: model.property.county === '—' ? null : model.property.county,
        apn: model.property.apn,
        legalDescription: model.property.legalDescription,
      },
      taxData: null,
      seller: { primary: model.property.primaryOwner, secondary: model.property.secondaryOwner },
      parties: {},
      assignments: {
        salesRep: model.assignments.salesRep?.name ?? null,
        titleOfficer: to?.name ?? null,
      },
      hasDocuments: true,
      isTitlePointActive: true,
    });

    expect(subject).toBe('20019922-GLT · 123 Main St, Glendale · Confirmation');
    // Snapshot Property uses addressFormatted from the read model
    expect(html).toContain(model.property.addressFormatted);
    // Purchase → Sales price only (never Loan amount / never Sales price: 0)
    expect(html).toContain('Sales price');
    expect(html).toContain('$490,000');
    expect(html).not.toContain('Loan amount');
    expect(html).not.toContain('$425,000');
    expect(html).toContain('Tina Title');
    expect(html).toContain('Title officer');
    expect(html).toContain('Los Angeles');
    expect(html).toContain('5641-001-002');
  });
});

describe('prelim email context parity', () => {
  it('uses formatOrderAddress-equivalent address + title officer from read model', () => {
    const model = buildOrderReadModel(sampleData);
    expect(model.property.addressFormatted).toBe('123 Main St Unit 4, Glendale, CA 91203');
    expect(model.assignments.titleOfficer).toMatchObject({
      name: 'Tina Title',
      email: 'unit66@pct.com',
      phone: '555-0002',
    });
    expect(model.property.apn).toBe('5641-001-002');
  });
});
