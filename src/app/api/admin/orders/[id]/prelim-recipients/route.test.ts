import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessOrderMock,
  getPrelimDeliveryEligibilityMock,
  getSessionMock,
  resolvePrelimRecipientsMock,
} = vi.hoisted(() => ({
  canAccessOrderMock: vi.fn(),
  getPrelimDeliveryEligibilityMock: vi.fn(),
  getSessionMock: vi.fn(),
  resolvePrelimRecipientsMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrder: canAccessOrderMock,
}));

vi.mock('@/lib/domain/notifications/prelim-delivery-eligibility', () => ({
  getPrelimDeliveryEligibility: getPrelimDeliveryEligibilityMock,
}));

vi.mock('@/lib/domain/notifications/prelim-recipient-resolution', () => ({
  resolvePrelimRecipients: resolvePrelimRecipientsMock,
}));

vi.mock('@/lib/domain/notifications/prelim-delivery-mode', () => ({
  getPrelimDeliveryMode: () => ({
    mode: 'blocked',
    armed: false,
    message: 'prelim delivery not armed',
  }),
}));

import { GET } from './route';

describe('GET /api/admin/orders/[id]/prelim-recipients', () => {
  const originalOverride = process.env.PRELIM_DELIVERY_TEST_RECIPIENT;
  const originalLive = process.env.PRELIM_DELIVERY_LIVE;

  beforeEach(() => {
    delete process.env.PRELIM_DELIVERY_TEST_RECIPIENT;
    delete process.env.PRELIM_DELIVERY_LIVE;
    getSessionMock.mockResolvedValue({ id: 'user-1', role: 'admin' });
    canAccessOrderMock.mockResolvedValue(true);
    getPrelimDeliveryEligibilityMock.mockResolvedValue({ blocked: false });
    resolvePrelimRecipientsMock.mockResolvedValue({
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [{ email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' }],
      warnings: [],
      blocked: false,
    });
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.PRELIM_DELIVERY_TEST_RECIPIENT;
    } else {
      process.env.PRELIM_DELIVERY_TEST_RECIPIENT = originalOverride;
    }
    if (originalLive === undefined) {
      delete process.env.PRELIM_DELIVERY_LIVE;
    } else {
      process.env.PRELIM_DELIVERY_LIVE = originalLive;
    }
    vi.clearAllMocks();
  });

  it('returns the D2 resolver shape when delivery is eligible', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '123' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolvePrelimRecipientsMock).toHaveBeenCalledWith(123);
    expect(body).toEqual({
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [{ email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' }],
      warnings: [],
      blocked: false,
      deliveryMode: {
        mode: 'blocked',
        armed: false,
        message: 'prelim delivery not armed',
      },
    });
  });

  it('preserves the resolver shape and overlays the eligibility block reason', async () => {
    getPrelimDeliveryEligibilityMock.mockResolvedValueOnce({
      blocked: true,
      blockReason: 'Canceled orders cannot deliver prelims.',
    });

    const response = await GET({} as never, { params: Promise.resolve({ id: '456' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [{ email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' }],
      warnings: [],
      blocked: true,
      blockReason: 'Canceled orders cannot deliver prelims.',
      deliveryMode: {
        mode: 'blocked',
        armed: false,
        message: 'prelim delivery not armed',
      },
    });
  });
});
