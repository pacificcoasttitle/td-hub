import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/security/client-scope', () => ({ canAccessOrder: canAccessOrderMock }));
vi.mock('@/lib/domain/orders/read-model', () => ({
  applyVisibility: applyVisibilityMock,
  getOrderReadModel: getOrderReadModelMock,
}));

import { GET } from './route';

const readModel = {
  id: 100,
  fileNumber: '20019968-GLT',
  status: { value: 'in_process', label: 'In Process', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  transactionType: 'Purchase',
  property: {
    addressFormatted: '37833 Tackstem St, Palmdale, CA',
    line1: '37833 Tackstem St',
    city: 'Palmdale',
    state: 'CA',
    zip: null,
    county: 'Los Angeles',
    propertyType: 'Single Family',
    apn: null,
    legalDescription: null,
  },
  dates: {
    openedAt: 'Jul 15, 2026',
    completedAt: '—',
    closedAt: '—',
  },
  financials: {
    salesPriceFormatted: '—',
    loanAmountFormatted: '—',
    premiumFormatted: '—',
  },
  parties: [
    {
      role: 'buyer',
      name: 'Bea Buyer',
      company: null,
      email: null,
      phone: null,
      isPrimary: true,
    },
    {
      role: 'lender',
      name: 'Lender Contact',
      company: 'Pacific Lending',
      email: null,
      phone: null,
      isPrimary: true,
    },
  ],
  documents: {
    active: [
      { id: 1, filename: 'prelim.pdf', category: 'prelim', sizeBytes: 1234, createdAt: 'Jul 16, 2026' },
    ],
  },
};

describe('GET /api/client/orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    canAccessOrderMock.mockResolvedValue(true);
    getOrderReadModelMock.mockResolvedValue(readModel);
    applyVisibilityMock.mockImplementation((model) => model);
  });

  it('returns the client-visible read model shape including order_parties', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '100' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getOrderReadModelMock).toHaveBeenCalledWith(100);
    expect(applyVisibilityMock).toHaveBeenCalledWith(readModel, 'client');
    expect(body).toEqual({
      id: 100,
      fileNumber: '20019968-GLT',
      operationalStatus: 'in_process',
      transactionType: 'Purchase',
      openedAt: 'Jul 15, 2026',
      completedAt: '—',
      closedAt: '—',
      property: {
        address: '37833 Tackstem St',
        city: 'Palmdale',
        state: 'CA',
        zip: null,
        county: 'Los Angeles',
        propertyType: 'Single Family',
        fullAddress: '37833 Tackstem St, Palmdale, CA',
      },
      documents: [
        { id: 1, filename: 'prelim.pdf', category: 'prelim', sizeBytes: 1234, createdAt: 'Jul 16, 2026' },
      ],
      parties: [
        {
          role: 'buyer',
          isPrimary: true,
          externalName: 'Bea Buyer',
          externalCompany: null,
          externalEmail: null,
          externalPhone: null,
        },
        {
          role: 'lender',
          isPrimary: true,
          externalName: 'Lender Contact',
          externalCompany: 'Pacific Lending',
          externalEmail: null,
          externalPhone: null,
        },
      ],
    });
    expect(body.parties).not.toEqual([]);
    expect(JSON.stringify(body)).not.toContain('financials');
    expect(JSON.stringify(body)).not.toContain('apn');
    expect(JSON.stringify(body)).not.toContain('legalDescription');
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('assignments');
    expect(body).not.toHaveProperty('marketingSource');
  });
});
