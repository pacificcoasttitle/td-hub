import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSetting, getOrderReadModel, sendEmail, insertNotificationLog } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => 'false'),
  getOrderReadModel: vi.fn(async () => ({ id: 1 })),
  sendEmail: vi.fn(async () => ({ success: true, data: { messageId: 'mid' }, error: null })),
  insertNotificationLog: vi.fn(async () => 1),
}));

vi.mock('@/lib/domain/settings/service', () => ({ getSetting }));
vi.mock('@/lib/domain/orders/read-model', () => ({
  getOrderReadModel,
  applyVisibility: (m: unknown) => m,
}));
vi.mock('@/lib/integrations/sendgrid/client', () => ({ sendEmail }));
vi.mock('@/lib/integrations/s3/client', () => ({
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(),
}));
vi.mock('@/lib/integrations/softpro', () => ({ addNotes: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }), insert: () => ({ values: async () => [] }), update: () => ({ set: () => ({ where: async () => [] }) }) } }));
vi.mock('./dispatch', () => ({
  dispatchNotification: vi.fn(),
  insertNotificationLog,
}));

import { deliverPolicyDocument } from './policy-delivery-send';

describe('policy delivery stays dark until the flag is flipped', () => {
  beforeEach(() => {
    getSetting.mockReset();
    getSetting.mockResolvedValue('false');
    getOrderReadModel.mockClear();
    sendEmail.mockClear();
    insertNotificationLog.mockClear();
  });

  it('stores nothing to send when the flag is off', async () => {
    const result = await deliverPolicyDocument({
      orderId: 6142,
      documentId: 99,
      kind: 'lender_policy',
    });
    expect(result).toEqual({ outcome: 'disabled', sent: false, kind: 'lender_policy' });
    expect(getOrderReadModel).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(insertNotificationLog).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      metadata: expect.objectContaining({ reason: 'policy_delivery_disabled' }),
    }));
  });

  it('a missing row is off, not on', async () => {
    getSetting.mockResolvedValue(null);
    const result = await deliverPolicyDocument({
      orderId: 1,
      documentId: 1,
      kind: 'owner_policy',
    });
    expect(result.outcome).toBe('disabled');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
