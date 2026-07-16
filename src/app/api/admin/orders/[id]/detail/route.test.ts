import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyVisibilityMock,
  canAccessOrderMock,
  canAccessSalesScopedOrderMock,
  getOrderReadModelMock,
  getSessionMock,
} = vi.hoisted(() => ({
  applyVisibilityMock: vi.fn(),
  canAccessOrderMock: vi.fn(),
  canAccessSalesScopedOrderMock: vi.fn(),
  getOrderReadModelMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrder: canAccessOrderMock,
  canAccessSalesScopedOrder: canAccessSalesScopedOrderMock,
  isSalesScopedRole: (role: string) => role === 'sales_rep' || role === 'sales_manager',
}));

vi.mock('@/lib/domain/orders/read-model', () => ({
  applyVisibility: applyVisibilityMock,
  getOrderReadModel: getOrderReadModelMock,
}));

import { GET } from './route';

function readModel() {
  return {
    id: 123,
    fileNumber: '20012345-OCT',
    source: 'softpro_sync',
    marketingSource: 'Sales Rep Referral',
    status: { value: 'open', label: 'Open', color: 'bg-blue-50 text-blue-700 border-blue-200' },
    transactionType: 'Purchase',
    productType: 'Residential',
    orderType: 'Title only',
    property: {
      addressFormatted: '123 Main St, Orange, CA 92868',
      line1: '123 Main St',
      line2: null,
      city: 'Orange',
      state: 'CA',
      zip: '92868',
      county: 'Orange',
      apn: '123-456-789',
      legalDescription: 'Lot 1',
      propertyType: 'Single Family',
    },
    financials: {
      salesPriceFormatted: '$500,000',
      loanAmountFormatted: '$400,000',
      premiumFormatted: '—',
    },
    dates: {
      openedAt: 'Jul 15, 2026',
      closedAt: '—',
      completedAt: '—',
      receivedAt: 'Jul 15, 2026',
    },
    parties: [
      { role: 'buyer', name: 'Buyer One', company: null, email: 'buyer@example.com', phone: null, isPrimary: true },
      { role: 'seller', name: 'Seller One', company: null, email: 'seller@example.com', phone: null, isPrimary: true },
      { role: 'lender', name: 'Lender Contact', company: 'Order Party Lending', email: 'lender@example.com', phone: '555-0101', isPrimary: true },
      { role: 'listing_agent', name: 'Listing Agent', company: 'Order Party Realty', email: 'listing@example.com', phone: '555-0102', isPrimary: true },
      { role: 'other', name: 'Title Contact', company: 'Pacific Coast Title Company', email: 'title-company@example.com', phone: '555-0103', isPrimary: true },
      { role: 'other', name: null, company: 'Westcor Land Title Insurance Company', email: 'claims@wltic.com', phone: '555-0104', isPrimary: false },
    ],
    relatedParties: {
      titleCompany: { role: 'other', name: 'Title Contact', company: 'Pacific Coast Title Company', email: 'title-company@example.com', phone: '555-0103', isPrimary: true },
      underwriter: { role: 'other', name: null, company: 'Westcor Land Title Insurance Company', email: 'claims@wltic.com', phone: '555-0104', isPrimary: false },
    },
    assignments: {
      escrowOfficer: { name: 'Escrow Officer', email: 'escrow@example.com' },
      titleOfficer: { name: 'Title Officer', email: 'title@example.com' },
      salesRep: { name: 'Sales Rep', email: 'sales@example.com' },
      createdBy: { id: 'profile-1', name: 'Opener User', email: 'opener@pct.com' },
    },
    documents: {
      active: [],
      activeByCategory: { prelim: { count: 1, latestId: 10, latestFilename: 'prelim.pdf', latestCreatedAt: 'Jul 16, 2026' } },
      prelimAvailable: true,
      activeCount: 1,
    },
    milestones: [
      { key: 'opened', label: 'Order Opened', state: 'complete', date: 'Jul 15, 2026', documentId: null },
      { key: 'prelim', label: 'Prelim Received', state: 'complete', date: 'Jul 16, 2026', documentId: 10 },
    ],
  };
}

describe('GET /api/admin/orders/[id]/detail sales scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'manager-1', role: 'sales_manager', contactId: 10 });
    canAccessOrderMock.mockResolvedValue(false);
    canAccessSalesScopedOrderMock.mockResolvedValue(true);
    getOrderReadModelMock.mockResolvedValue(readModel());
    applyVisibilityMock.mockImplementation((model) => model);
  });

  it('uses the sales-scoped predicate for sales manager detail access', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '123' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.order.fileNumber).toBe('20012345-OCT');
    expect(canAccessSalesScopedOrderMock).toHaveBeenCalledWith(
      { id: 'manager-1', role: 'sales_manager', contactId: 10 },
      123,
    );
    expect(canAccessOrderMock).not.toHaveBeenCalled();
    expect(getOrderReadModelMock).toHaveBeenCalledWith(123);
    expect(applyVisibilityMock).toHaveBeenCalledWith(expect.objectContaining({ id: 123 }), 'staff');
  });

  it('sources lender and listing agent cards from order parties when header FKs are null', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '123' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.parties.lender).toMatchObject({
      name: 'Lender Contact',
      company: 'Order Party Lending',
      email: 'lender@example.com',
      phone: '555-0101',
    });
    expect(body.parties.listingAgent).toMatchObject({
      name: 'Listing Agent',
      company: 'Order Party Realty',
      email: 'listing@example.com',
      phone: '555-0102',
    });
    expect(body.parties.titleCompany).toMatchObject({
      name: 'Title Contact',
      company: 'Pacific Coast Title Company',
      email: 'title-company@example.com',
      phone: '555-0103',
    });
    expect(body.parties.underwriter).toMatchObject({
      name: null,
      company: 'Westcor Land Title Insurance Company',
      email: 'claims@wltic.com',
      phone: '555-0104',
    });
  });

  it('returns staff-visible financials, APN, legal description, and canonical milestones', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '123' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.order.salesPrice).toBe('$500,000');
    expect(body.order.loanAmount).toBe('$400,000');
    expect(body.order.source).toBe('softpro_sync');
    expect(body.order.marketingSource).toBe('Sales Rep Referral');
    expect(body.property.apn).toBe('123-456-789');
    expect(body.property.legalDescription).toBe('Lot 1');
    expect(body.property.propertyType).toBe('Single Family');
    expect(body.assignments.createdBy).toMatchObject({
      id: 'profile-1',
      name: 'Opener User',
      email: 'opener@pct.com',
    });
    expect(body.milestones).toEqual([
      { id: 1, status: 'complete', label: 'Order Opened', notes: null, occurredAt: 'Jul 15, 2026' },
      { id: 2, status: 'complete', label: 'Prelim Received', notes: null, occurredAt: 'Jul 16, 2026' },
    ]);
  });
});
