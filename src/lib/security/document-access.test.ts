import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessOrderDetailResourceMock,
  clientCanAccessOrderMock,
} = vi.hoisted(() => ({
  canAccessOrderDetailResourceMock: vi.fn(),
  clientCanAccessOrderMock: vi.fn(),
}));

vi.mock('./client-scope', () => ({
  canAccessOrder: clientCanAccessOrderMock,
}));

vi.mock('./permissions', () => ({
  canAccessOrderDetailResource: canAccessOrderDetailResourceMock,
}));

import type { SessionUser } from './auth';
import { canAccessDocumentOrder } from './document-access';

function session(partial: Pick<SessionUser, 'id' | 'role' | 'contactId'>): SessionUser {
  return {
    email: `${partial.id}@example.com`,
    displayName: null,
    branchId: null,
    ...partial,
  };
}

describe('canAccessDocumentOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses client-scope for client roles', async () => {
    clientCanAccessOrderMock.mockResolvedValue(true);

    await expect(
      canAccessDocumentOrder(session({ id: 'client-1', role: 'client', contactId: 9 }), 100),
    ).resolves.toBe(true);

    expect(clientCanAccessOrderMock).toHaveBeenCalledWith('client-1', 100);
    expect(canAccessOrderDetailResourceMock).not.toHaveBeenCalled();
  });

  it('uses DC-2 detail gate for staff/sales roles', async () => {
    canAccessOrderDetailResourceMock.mockResolvedValue(true);
    const staff = session({ id: 'staff-1', role: 'admin', contactId: null });

    await expect(canAccessDocumentOrder(staff, 100)).resolves.toBe(true);

    expect(canAccessOrderDetailResourceMock).toHaveBeenCalledWith(staff, 100);
    expect(clientCanAccessOrderMock).not.toHaveBeenCalled();
  });

  it('denies when the selected gate denies', async () => {
    canAccessOrderDetailResourceMock.mockResolvedValue(false);

    await expect(
      canAccessDocumentOrder(session({ id: 'rep-1', role: 'sales_rep', contactId: 3 }), 999),
    ).resolves.toBe(false);
  });
});
