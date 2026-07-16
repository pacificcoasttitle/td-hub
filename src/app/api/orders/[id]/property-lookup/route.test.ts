import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  canAccessOrderMock,
  dbMock,
  getSessionMock,
  insertValuesMock,
  propertyLookupMock,
  selectLimitMock,
  updateSetMock,
} = vi.hoisted(() => {
  const selectLimitMock = vi.fn();
  const updateSetMock = vi.fn();
  const insertValuesMock = vi.fn();
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    limit: selectLimitMock,
  };
  const updateBuilder = {
    set: updateSetMock,
    where: vi.fn(() => Promise.resolve()),
  };
  const insertBuilder = {
    values: insertValuesMock,
  };

  return {
    canAccessOrderMock: vi.fn(),
    dbMock: {
      select: vi.fn(() => selectBuilder),
      update: vi.fn(() => updateBuilder),
      insert: vi.fn(() => insertBuilder),
    },
    getSessionMock: vi.fn(),
    insertValuesMock,
    propertyLookupMock: vi.fn(),
    selectLimitMock,
    updateSetMock,
  };
});

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrder: canAccessOrderMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: dbMock,
}));

vi.mock('@/lib/db/schema', () => ({
  orderProperties: {
    id: 'orderProperties.id',
    orderId: 'orderProperties.orderId',
  },
}));

vi.mock('@/lib/integrations/sitex/client', () => ({
  propertyLookup: propertyLookupMock,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/orders/42/property-lookup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/orders/[id]/property-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'staff-1', role: 'admin' });
    canAccessOrderMock.mockResolvedValue(true);
    selectLimitMock.mockResolvedValue([{ id: 7 }]);
    updateSetMock.mockReturnValue({
      where: vi.fn(() => Promise.resolve()),
    });
    propertyLookupMock.mockResolvedValue({
      success: true,
      data: {
        matchCode: 'S',
        apn: '123-456-789',
        county: 'Los Angeles',
        legalDescription: 'Lot 1',
        propertyType: 'Single Family',
        primaryOwner: 'Owner One',
        secondaryOwner: null,
        fullAddress: '123 Main St, Glendale, CA 91203',
        city: 'Glendale',
        state: 'CA',
        zip: '91203',
      },
    });
  });

  it('looks up and persists property data for the order', async () => {
    const response = await POST(request({
      street: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
    }), { params: Promise.resolve({ id: '42' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(propertyLookupMock).toHaveBeenCalledWith({
      street: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      address: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      county: 'Los Angeles',
      apn: '123-456-789',
      legalDescription: 'Lot 1',
      propertyType: 'Single Family',
      primaryOwner: 'Owner One',
    }));
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
