import { describe, expect, it, vi } from 'vitest';
import {
  applyVisibility,
  buildOrderReadModel,
  deriveOrderMilestones,
  summarizeActiveDocuments,
  type OrderReadModelData,
} from './read-model';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn((value) => value),
  eq: vi.fn(),
}));
vi.mock('drizzle-orm/pg-core', () => ({
  alias: vi.fn((table) => table),
}));
vi.mock('@/lib/db/schema', () => {
  const column = (name: string) => name;
  return {
    contacts: {
      id: column('contacts.id'),
      fullName: column('contacts.fullName'),
      officerName: column('contacts.officerName'),
      firstName: column('contacts.firstName'),
      lastName: column('contacts.lastName'),
      companyName: column('contacts.companyName'),
      email: column('contacts.email'),
    },
    companies: {
      id: column('companies.id'),
      name: column('companies.name'),
    },
    documents: {
      id: column('documents.id'),
      orderId: column('documents.orderId'),
      category: column('documents.category'),
      filename: column('documents.filename'),
      status: column('documents.status'),
      createdAt: column('documents.createdAt'),
    },
    orderParties: {
      id: column('orderParties.id'),
      orderId: column('orderParties.orderId'),
      role: column('orderParties.role'),
      externalName: column('orderParties.externalName'),
      externalCompany: column('orderParties.externalCompany'),
      externalEmail: column('orderParties.externalEmail'),
      externalPhone: column('orderParties.externalPhone'),
      isPrimary: column('orderParties.isPrimary'),
      createdAt: column('orderParties.createdAt'),
    },
    orderProperties: {
      orderId: column('orderProperties.orderId'),
      address: column('orderProperties.address'),
      city: column('orderProperties.city'),
      state: column('orderProperties.state'),
      zip: column('orderProperties.zip'),
      county: column('orderProperties.county'),
      apn: column('orderProperties.apn'),
      legalDescription: column('orderProperties.legalDescription'),
      fullAddress: column('orderProperties.fullAddress'),
    },
    orderStatusHistory: {
      id: column('orderStatusHistory.id'),
      orderId: column('orderStatusHistory.orderId'),
      status: column('orderStatusHistory.status'),
      notes: column('orderStatusHistory.notes'),
      changedAt: column('orderStatusHistory.changedAt'),
    },
    orders: {
      id: column('orders.id'),
      fileNumber: column('orders.fileNumber'),
      operationalStatus: column('orders.operationalStatus'),
      transactionType: column('orders.transactionType'),
      productType: column('orders.productType'),
      orderType: column('orders.orderType'),
      salesPrice: column('orders.salesPrice'),
      loanAmount: column('orders.loanAmount'),
      openedAt: column('orders.openedAt'),
      closedAt: column('orders.closedAt'),
      completedAt: column('orders.completedAt'),
      createdAt: column('orders.createdAt'),
      escrowOfficerId: column('orders.escrowOfficerId'),
      titleOfficerId: column('orders.titleOfficerId'),
      salesRepId: column('orders.salesRepId'),
    },
    profiles: {
      id: column('profiles.id'),
      displayName: column('profiles.displayName'),
      email: column('profiles.email'),
    },
    titlePointData: {
      orderId: column('titlePointData.orderId'),
      status: column('titlePointData.status'),
      updatedAt: column('titlePointData.updatedAt'),
    },
  };
});

const baseData: OrderReadModelData = {
  order: {
    id: 42,
    fileNumber: '20019922-GLT',
    escrowNumber: '20019922-GLT',
    operationalStatus: 'in_process',
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
    fullAddress: '123 Main St Unit 4, Glendale, CA 91203',
  },
  parties: [
    { id: 5, role: 'listing_agent', name: 'List Agent', company: 'Agent Co', email: 'list@example.com', phone: '555-5555', isPrimary: true, createdAt: '2026-07-15T18:04:00.000Z' },
    { id: 2, role: 'seller', name: 'Sam Seller', company: null, email: 'seller@example.com', phone: null, isPrimary: true, createdAt: '2026-07-15T18:02:00.000Z' },
    { id: 1, role: 'buyer', name: 'Bea Buyer', company: null, email: 'buyer@example.com', phone: null, isPrimary: true, createdAt: '2026-07-15T18:01:00.000Z' },
    { id: 4, role: 'lender', name: 'Lender Contact', company: 'Pacific Lending', email: 'loan@example.com', phone: '555-1212', isPrimary: true, createdAt: '2026-07-15T18:03:00.000Z' },
  ],
  assignments: {
    escrowOfficer: { name: 'Ella Escrow', email: 'ella@pct.com' },
    titleOfficer: { name: 'Tina Title', email: 'unit66@pct.com' },
    salesRep: { name: 'Ryan Rep', email: 'ryan@pct.com' },
  },
  documents: [
    { id: 10, category: 'prelim', filename: 'prelim-v1.pdf', sizeBytes: 1000, createdAt: '2026-07-16T17:00:00.000Z' },
    { id: 11, category: 'prelim', filename: 'prelim-v2.pdf', sizeBytes: 2000, createdAt: '2026-07-17T17:00:00.000Z' },
    { id: 12, category: 'cpl', filename: 'cpl.pdf', sizeBytes: null, createdAt: '2026-07-16T19:00:00.000Z' },
  ],
  statusHistory: [
    { status: 'recording_confirmation', notes: 'Recording confirmed', changedAt: '2026-07-18T18:00:00.000Z' },
  ],
  titleSearchCompletedAt: null,
};

describe('buildOrderReadModel', () => {
  it('returns the canonical shape formatted through P1 formatters', () => {
    const model = buildOrderReadModel(baseData);

    expect(model).toMatchObject({
      id: 42,
      fileNumber: '20019922-GLT',
      escrowNumber: '20019922-GLT',
      status: {
        value: 'in_process',
        label: 'In Process',
        color: 'bg-amber-50 text-amber-700 border-amber-200',
      },
      property: {
        addressFormatted: '123 Main St Unit 4, Glendale, CA 91203',
        county: 'Los Angeles',
        apn: '5641-001-002',
      },
      financials: {
        salesPriceFormatted: '$490,000',
        loanAmountFormatted: '$425,000',
        premiumFormatted: '—',
      },
      dates: {
        openedAt: 'Jul 15, 2026',
        closedAt: '—',
        completedAt: '—',
        receivedAt: 'Jul 15, 2026',
      },
      assignments: baseData.assignments,
    });
  });

  it('uses order_parties as the source of truth for lender and listing agent', () => {
    const model = buildOrderReadModel({
      ...baseData,
      assignments: {
        ...baseData.assignments,
        escrowOfficer: null,
      },
    });

    expect(model.parties.map((party) => party.role)).toEqual(['buyer', 'seller', 'lender', 'listing_agent']);
    expect(model.parties.find((party) => party.role === 'lender')).toMatchObject({
      name: 'Lender Contact',
      company: 'Pacific Lending',
    });
    expect(model.parties.find((party) => party.role === 'listing_agent')).toMatchObject({
      name: 'List Agent',
      company: 'Agent Co',
    });
  });

  it('keeps county separate and out of addressFormatted', () => {
    const model = buildOrderReadModel(baseData);

    expect(model.property.county).toBe('Los Angeles');
    expect(model.property.addressFormatted).toBe('123 Main St Unit 4, Glendale, CA 91203');
    expect(model.property.addressFormatted).not.toContain('Los Angeles');
  });
});

describe('document summary', () => {
  it('groups active documents by category with latest metadata', () => {
    expect(summarizeActiveDocuments(baseData.documents)).toEqual({
      active: [
        { id: 10, category: 'prelim', filename: 'prelim-v1.pdf', sizeBytes: 1000, createdAt: 'Jul 16, 2026' },
        { id: 11, category: 'prelim', filename: 'prelim-v2.pdf', sizeBytes: 2000, createdAt: 'Jul 17, 2026' },
        { id: 12, category: 'cpl', filename: 'cpl.pdf', sizeBytes: null, createdAt: 'Jul 16, 2026' },
      ],
      activeByCategory: {
        prelim: {
          count: 2,
          latestId: 11,
          latestFilename: 'prelim-v2.pdf',
          latestCreatedAt: 'Jul 17, 2026',
        },
        cpl: {
          count: 1,
          latestId: 12,
          latestFilename: 'cpl.pdf',
          latestCreatedAt: 'Jul 16, 2026',
        },
      },
      prelimAvailable: true,
      activeCount: 3,
    });
  });
});

describe('milestone derivation', () => {
  it('gives a purchase sensible states from open through recording', () => {
    const milestones = deriveOrderMilestones(baseData);

    expect(milestones.map(({ key, state, date }) => ({ key, state, date }))).toEqual([
      { key: 'opened', state: 'complete', date: 'Jul 15, 2026' },
      { key: 'prelim', state: 'complete', date: 'Jul 16, 2026' },
      { key: 'recording', state: 'complete', date: 'Jul 18, 2026' },
      { key: 'disbursement', state: 'in_progress', date: '—' },
      { key: 'closed', state: 'pending', date: '—' },
    ]);
  });

  it('gives a refi without prelim a single in-progress next step', () => {
    const milestones = deriveOrderMilestones({
      ...baseData,
      order: { ...baseData.order, transactionType: 'Refinance', loanAmount: '650000.00' },
      documents: [],
      statusHistory: [],
    });

    expect(milestones.map(({ key, state }) => ({ key, state }))).toEqual([
      { key: 'opened', state: 'complete' },
      { key: 'prelim', state: 'in_progress' },
      { key: 'recording', state: 'pending' },
      { key: 'disbursement', state: 'pending' },
      { key: 'closed', state: 'pending' },
    ]);
  });

  it('marks a closed order closed without fabricating missing intermediate dates', () => {
    const milestones = deriveOrderMilestones({
      ...baseData,
      order: {
        ...baseData.order,
        operationalStatus: 'closed',
        closedAt: '2026-07-20T18:00:00.000Z',
      },
      statusHistory: [
        ...baseData.statusHistory,
        { status: 'disbursement', notes: 'Funds disbursed', changedAt: '2026-07-19T18:00:00.000Z' },
      ],
    });

    expect(milestones.map(({ key, state, date }) => ({ key, state, date }))).toEqual([
      { key: 'opened', state: 'complete', date: 'Jul 15, 2026' },
      { key: 'prelim', state: 'complete', date: 'Jul 16, 2026' },
      { key: 'recording', state: 'complete', date: 'Jul 18, 2026' },
      { key: 'disbursement', state: 'complete', date: 'Jul 19, 2026' },
      { key: 'closed', state: 'complete', date: 'Jul 20, 2026' },
    ]);
  });
});

describe('applyVisibility', () => {
  it('redacts client-hidden financial and property fields', () => {
    const visible = applyVisibility(buildOrderReadModel(baseData), 'client');

    expect(visible.financials).toEqual({
      salesPriceFormatted: '—',
      loanAmountFormatted: '—',
      premiumFormatted: '—',
    });
    expect(visible.property.apn).toBeNull();
    expect(visible.property.legalDescription).toBeNull();
    expect(visible.property.addressFormatted).toBe('123 Main St Unit 4, Glendale, CA 91203');
  });
});
