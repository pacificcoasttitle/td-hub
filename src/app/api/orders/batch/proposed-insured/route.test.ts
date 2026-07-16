import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  canAccessOrderDetailResourceMock,
  generateProposedInsuredMock,
  getProposedInsuredPrefillMock,
  getSessionMock,
} = vi.hoisted(() => ({
  canAccessOrderDetailResourceMock: vi.fn(),
  generateProposedInsuredMock: vi.fn(),
  getProposedInsuredPrefillMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrderDetailResource: canAccessOrderDetailResourceMock,
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

const PREFILL = {
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
};

describe('POST /api/orders/batch/proposed-insured', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue({ id: 'staff-1', role: 'admin', contactId: null });
    canAccessOrderDetailResourceMock.mockResolvedValue(true);
  });

  it('processes multiple orders through prefill with per-order status', async () => {
    getProposedInsuredPrefillMock
      .mockResolvedValueOnce(PREFILL)
      .mockResolvedValueOnce(null);
    generateProposedInsuredMock.mockResolvedValueOnce({ success: true, documentId: 202 });

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

  it('skips unauthorized orderIds and never generates for them', async () => {
    getSessionMock.mockResolvedValue({ id: 'rep-1', role: 'sales_rep', contactId: 3 });
    canAccessOrderDetailResourceMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    getProposedInsuredPrefillMock.mockResolvedValueOnce(PREFILL);
    generateProposedInsuredMock.mockResolvedValueOnce({ success: true, documentId: 303 });

    const response = await POST(request({ orderIds: [99, 11] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getProposedInsuredPrefillMock).toHaveBeenCalledTimes(1);
    expect(getProposedInsuredPrefillMock).toHaveBeenCalledWith(11);
    expect(generateProposedInsuredMock).toHaveBeenCalledTimes(1);
    expect(generateProposedInsuredMock).toHaveBeenCalledWith(11, 'rep-1', expect.any(Object));
    expect(body.results).toEqual([
      { orderId: 99, success: false, error: 'Not found' },
      { orderId: 11, success: true, documentId: 303 },
    ]);
  });
});
