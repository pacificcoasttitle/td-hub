import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ProposedInsuredInput } from '@/lib/domain/documents/proposed-insured';

const {
  canAccessOrderMock,
  generateProposedInsuredMock,
  getSessionMock,
} = vi.hoisted(() => ({
  canAccessOrderMock: vi.fn(),
  generateProposedInsuredMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/client-scope', () => ({
  canAccessOrder: canAccessOrderMock,
}));

vi.mock('@/lib/domain/documents/proposed-insured', async () => {
  const { z } = await import('zod');
  return {
    proposedInsuredInputSchema: z.object({
      lenderCompany: z.string().min(1),
      lenderCompanyId: z.number().int().positive().optional(),
      lenderCompanyLookupCode: z.string().optional(),
      assignmentClause: z.string().optional(),
      lenderAddress: z.string().min(1),
      lenderCity: z.string().min(1),
      lenderState: z.string().optional(),
      lenderZipcode: z.string().min(1),
      isNewLender: z.boolean(),
      propertyAddress: z.string().min(1),
      propertyCity: z.string().min(1),
      propertyState: z.string().min(1),
      propertyZipcode: z.string().min(1),
      titleOfficer: z.string().min(1),
      loanAmount: z.number().min(0),
      loanNumber: z.string(),
      borrowersVesting: z.string().min(1),
      supplementalReportDate: z.string().min(1),
      preliminaryReportDate: z.string().optional(),
      branchId: z.number().int().positive(),
    }),
    generateProposedInsured: generateProposedInsuredMock,
  };
});

vi.mock('@/lib/db/client', () => ({
  db: {},
}));

vi.mock('@/lib/db/schema', () => ({
  documents: {
    id: 'documents.id',
    filename: 'documents.filename',
    description: 'documents.description',
    sizeBytes: 'documents.sizeBytes',
    createdAt: 'documents.createdAt',
    orderId: 'documents.orderId',
    category: 'documents.category',
    status: 'documents.status',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

import { POST } from './route';

const canonicalInput: ProposedInsuredInput = {
  branchId: 1,
  titleOfficer: '66',
  lenderCompany: 'Pacific Lending',
  assignmentClause: 'Its successors and/or assigns',
  lenderAddress: '1 Lender Way',
  lenderCity: 'Irvine',
  lenderState: 'CA',
  lenderZipcode: '92618',
  isNewLender: true,
  propertyAddress: '123 Main St',
  propertyCity: 'Glendale',
  propertyState: 'CA',
  propertyZipcode: '91203',
  loanNumber: 'LN-123',
  loanAmount: 425000,
  borrowersVesting: 'Bea Buyer',
  supplementalReportDate: '2026-07-16',
  preliminaryReportDate: '2026-07-15',
};

function request(body: unknown) {
  return new NextRequest('http://localhost/api/client/orders/42/proposed-insured', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/client/orders/[id]/proposed-insured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'client-1', role: 'client' });
    canAccessOrderMock.mockResolvedValue(true);
    generateProposedInsuredMock.mockResolvedValue({ success: true, documentId: 456 });
  });

  it('accepts the shared canonical ProposedInsuredInput contract', async () => {
    const response = await POST(request(canonicalInput), { params: Promise.resolve({ id: '42' }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, documentId: 456 });
    expect(canAccessOrderMock).toHaveBeenCalledWith('client-1', 42);
    expect(generateProposedInsuredMock).toHaveBeenCalledWith(42, 'client-1', canonicalInput);
  });
});
