import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  generateProposedInsuredMock,
  getProposedInsuredPrefillMock,
  getSessionMock,
} = vi.hoisted(() => ({
  generateProposedInsuredMock: vi.fn(),
  getProposedInsuredPrefillMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/domain/documents/proposed-insured', () => ({
  generateProposedInsured: generateProposedInsuredMock,
  getProposedInsuredPrefill: getProposedInsuredPrefillMock,
}));

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/orders/batch/proposed-insured', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/orders/batch/proposed-insured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'staff-1', role: 'admin' });
    getProposedInsuredPrefillMock
      .mockResolvedValueOnce({
        lender: {
          company: 'Prefill Lender',
          companyId: null,
          lookupCode: '',
          assignmentClause: '',
          address: '1 Lender Way',
          city: 'Irvine',
          state: 'CA',
          zipcode: '92618',
        },
        property: {
          address: '123 Main St',
          city: 'Glendale',
          state: 'CA',
          zipcode: '91203',
        },
        titleOfficer: { id: 66, name: 'Title Officer', email: null, phone: null },
        branch: { id: 2, name: 'Orange County' },
        loanAmount: 425000,
        loanNumber: '',
        borrowersVesting: 'Bea Buyer',
      })
      .mockResolvedValueOnce(null);
    generateProposedInsuredMock.mockResolvedValueOnce({ success: true, documentId: 202 });
  });

  it('processes multiple orders through prefill with per-order status', async () => {
    const response = await POST(request({
      orderIds: [11, 22],
      sharedData: {
        lenderCompany: 'Shared Lender',
        lenderAddress: '2 Shared Ave',
        lenderCity: 'Irvine',
        lenderState: 'CA',
        lenderZipcode: '92618',
        isNewLender: true,
        branchId: 2,
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(generateProposedInsuredMock).toHaveBeenCalledWith(11, 'staff-1', expect.objectContaining({
      lenderCompany: 'Shared Lender',
      lenderAddress: '2 Shared Ave',
      lenderCity: 'Irvine',
      lenderZipcode: '92618',
      isNewLender: true,
      propertyAddress: '123 Main St',
      propertyZipcode: '91203',
      titleOfficer: '66',
      branchId: 2,
    }));
    expect(body.results).toEqual([
      { orderId: 11, success: true, documentId: 202 },
      { orderId: 22, success: false, error: 'Order not found' },
    ]);
  });
});
