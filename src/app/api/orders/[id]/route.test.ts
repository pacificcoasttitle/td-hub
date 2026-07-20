import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  applyVisibilityMock,
  canAccessOrderMock,
  getOrderReadModelMock,
  getSessionMock,
} = vi.hoisted(() => ({
  applyVisibilityMock: vi.fn(),
  canAccessOrderMock: vi.fn(),
  getOrderReadModelMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/security/permissions', () => ({ canAccessOrder: canAccessOrderMock }));
vi.mock('@/lib/domain/orders/read-model', () => ({
  applyVisibility: applyVisibilityMock,
  getOrderReadModel: getOrderReadModelMock,
}));

vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => []);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
  return { db: { select: vi.fn(() => chain) } };
});

vi.mock('@/lib/db/schema', () => ({
  contacts: {},
  companies: {},
  orderExternalRefs: { orderId: 'oer.order_id', refType: 'oer.ref_type', refValue: 'oer.ref_value' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  like: vi.fn((...args) => ({ like: args })),
}));

import { GET } from './route';

function staffModel() {
  return {
    id: 123,
    fileNumber: '20012345-OCT',
    escrowNumber: null,
    source: 'manual_entry',
    marketingSource: null,
    status: { value: 'open', label: 'Open', color: 'bg-blue-50' },
    softproStatus: 'Open',
    softproLastSyncedAt: '2026-07-10T10:00:00.000Z',
    isImported: true,
    branchId: 2,
    lenderId: null,
    underwriterId: null,
    escrowOfficerId: null,
    listingAgentId: null,
    transactionType: 'Refinance',
    productType: 'Residential',
    orderType: null,
    property: {
      addressFormatted: '9 Oak Ave, Downey, CA 90241',
      line1: '9 Oak Ave',
      line2: null,
      city: 'Downey',
      state: 'CA',
      zip: '90241',
      county: 'Los Angeles',
      apn: '111',
      legalDescription: 'Lot A',
      propertyType: 'Condo',
      primaryOwner: null,
      secondaryOwner: null,
    },
    financials: {
      salesPriceFormatted: '—',
      loanAmountFormatted: '$300,000',
      premiumFormatted: '—',
      salesPrice: null,
      loanAmount: '300000',
    },
    dates: {
      openedAt: 'Jul 1, 2026',
      closedAt: '—',
      completedAt: '—',
      receivedAt: 'Jul 1, 2026',
      openedAtIso: '2026-07-01T15:00:00.000Z',
      closedAtIso: null,
      completedAtIso: null,
      createdAtIso: '2026-07-01T14:00:00.000Z',
      updatedAtIso: '2026-07-10T10:00:00.000Z',
    },
    parties: [],
    relatedParties: { titleCompany: null, underwriter: null },
    assignments: {
      escrowOfficer: null,
      titleOfficer: null,
      salesRep: null,
      createdBy: { id: 'u1', name: 'Opener', email: 'o@pct.com' },
    },
    documents: {
      active: [],
      activeByCategory: {},
      prelimAvailable: false,
      activeCount: 0,
    },
    milestones: [],
    statusHistory: [
      { id: 1, status: 'open', source: 'manual_entry', notes: null, changedAt: '2026-07-01T15:00:00.000Z' },
    ],
  };
}

describe('GET /api/orders/[id] (Phase B — read model)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'staff-1', role: 'admin' });
    canAccessOrderMock.mockResolvedValue(true);
    const model = staffModel();
    getOrderReadModelMock.mockResolvedValue(model);
    applyVisibilityMock.mockImplementation((m) => m);
  });

  it('loads via getOrderReadModel + applyVisibility(staff), not getOrderById', async () => {
    const res = await GET({} as never, { params: Promise.resolve({ id: '123' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getOrderReadModelMock).toHaveBeenCalledWith(123);
    expect(applyVisibilityMock).toHaveBeenCalledWith(expect.objectContaining({ id: 123 }), 'staff');
    expect(body.fileNumber).toBe('20012345-OCT');
    expect(body.operationalStatus).toBe('open');
    expect(body.softproStatus).toBe('Open');
    expect(body.source).toBe('manual_entry');
    expect(body.property.propertyType).toBe('Condo');
    expect(body.loanAmount).toBe('300000');
    expect(body.statusHistory).toHaveLength(1);
    expect(body.documents.prelim.exists).toBe(false);
    expect(body.createdByName).toBe('Opener');
  });

  it('route source no longer imports getOrderById', () => {
    const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    expect(src).toContain('getOrderReadModel');
    expect(src).toContain('applyVisibility');
    expect(src).toContain('mapStaffOrderDetailResponse');
    expect(src).not.toContain('getOrderById');
  });
});
