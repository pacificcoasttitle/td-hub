import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orderRows,
  deliveryMarkerRows,
  insertRows,
  resolvePrelimRecipientsMock,
  getPrelimDeliveryModeMock,
  sendPrelimDeliveryEmailMock,
} = vi.hoisted(() => ({
  orderRows: [] as Array<{ openedAt: Date }>,
  deliveryMarkerRows: [] as Array<{ id: number }>,
  insertRows: [] as Array<{ table: string; values: Record<string, unknown> }>,
  resolvePrelimRecipientsMock: vi.fn(),
  getPrelimDeliveryModeMock: vi.fn(),
  sendPrelimDeliveryEmailMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }),
}));

vi.mock('@/lib/db/schema', () => ({
  adminActivityLogs: {
    __table: 'admin_activity_logs',
    id: 'admin_activity_logs.id',
    action: 'admin_activity_logs.action',
    entityType: 'admin_activity_logs.entity_type',
    entityId: 'admin_activity_logs.entity_id',
    meta: 'admin_activity_logs.meta',
  },
  orders: {
    __table: 'orders',
    id: 'orders.id',
    openedAt: 'orders.opened_at',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table.__table === 'orders') return orderRows;
            return deliveryMarkerRows;
          }),
        })),
      })),
    })),
    insert: vi.fn((table: { __table: string }) => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        insertRows.push({ table: table.__table, values });
        return [];
      }),
    })),
  },
}));

vi.mock('./prelim-recipient-resolution', () => ({
  resolvePrelimRecipients: resolvePrelimRecipientsMock,
}));

vi.mock('./prelim-delivery-mode', () => ({
  getPrelimDeliveryMode: getPrelimDeliveryModeMock,
}));

vi.mock('./prelim-delivery-send', () => ({
  sendPrelimDeliveryEmail: sendPrelimDeliveryEmailMock,
}));

import { maybeAutoDeliverPrelim } from './prelim-auto-delivery';

const baseInput = {
  orderId: 5029,
  documentId: 3982,
  documentCreatedAt: new Date('2026-07-16T00:00:00.000Z'),
  triggeredBy: 'fetch_prelims' as const,
};

const resolvedRecipients = {
  to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
  cc: [{ email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' }],
  warnings: [],
  blocked: false,
};

function latestOutcome() {
  return insertRows.at(-1)?.values.meta as { outcome?: string; needs_manual_delivery?: boolean; reason?: string; message_id?: string };
}

describe('maybeAutoDeliverPrelim', () => {
  beforeEach(() => {
    orderRows.splice(0, orderRows.length, { openedAt: new Date('2026-07-16T00:00:00.000Z') });
    deliveryMarkerRows.splice(0, deliveryMarkerRows.length);
    insertRows.splice(0, insertRows.length);
    resolvePrelimRecipientsMock.mockReset();
    getPrelimDeliveryModeMock.mockReset();
    sendPrelimDeliveryEmailMock.mockReset();
    delete process.env.PRELIM_AUTO_DELIVERY_CUTOFF;
  });

  it('does not send legacy pre-cutoff orders even when the prelim document is fetched after go-live', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    orderRows.splice(0, orderRows.length, { openedAt: new Date('2026-07-15T23:59:59.000Z') });

    const result = await maybeAutoDeliverPrelim({
      ...baseInput,
      documentCreatedAt: new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(result.outcome).toBe('skipped_before_cutoff');
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({ outcome: 'skipped_before_cutoff' });
  });

  it('does not send anything when the forward-only cutoff is unset', async () => {
    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result).toMatchObject({
      outcome: 'skipped_before_cutoff',
      sent: false,
      reason: 'PRELIM_AUTO_DELIVERY_CUTOFF is not set',
    });
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({
      outcome: 'skipped_before_cutoff',
      reason: 'PRELIM_AUTO_DELIVERY_CUTOFF is not set',
    });
  });

  it('sends post-cutoff prelims exactly once through the existing delivery path', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    resolvePrelimRecipientsMock.mockResolvedValue(resolvedRecipients);
    getPrelimDeliveryModeMock.mockReturnValue({ mode: 'live', armed: true, message: 'LIVE' });
    sendPrelimDeliveryEmailMock.mockResolvedValue({ messageId: 'sg-message-id' });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result).toMatchObject({ outcome: 'delivered', sent: true, messageId: 'sg-message-id' });
    expect(sendPrelimDeliveryEmailMock).toHaveBeenCalledTimes(1);
    expect(sendPrelimDeliveryEmailMock).toHaveBeenCalledWith(
      5029,
      { to: resolvedRecipients.to, cc: resolvedRecipients.cc },
      expect.objectContaining({ id: 'system:prelim_auto_delivery' }),
    );
    expect(latestOutcome()).toMatchObject({ outcome: 'delivered', message_id: 'sg-message-id' });
  });

  it('sends an updated prelim version on a post-cutoff order', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    resolvePrelimRecipientsMock.mockResolvedValue(resolvedRecipients);
    getPrelimDeliveryModeMock.mockReturnValue({ mode: 'live', armed: true, message: 'LIVE' });
    sendPrelimDeliveryEmailMock.mockResolvedValue({ messageId: 'sg-updated-version' });

    const result = await maybeAutoDeliverPrelim({
      ...baseInput,
      documentId: 3983,
      documentCreatedAt: new Date('2026-07-20T00:00:00.000Z'),
    });

    expect(result).toMatchObject({ outcome: 'delivered', sent: true, messageId: 'sg-updated-version' });
    expect(sendPrelimDeliveryEmailMock).toHaveBeenCalledTimes(1);
    expect(latestOutcome()).toMatchObject({ outcome: 'delivered', message_id: 'sg-updated-version' });
  });

  it('skips when the same prelim version already has a manual delivery marker', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    deliveryMarkerRows.push({ id: 1 });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result.outcome).toBe('skipped_already_delivered');
    expect(resolvePrelimRecipientsMock).not.toHaveBeenCalled();
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({ outcome: 'skipped_already_delivered' });
  });

  it('skips when the same prelim version has only an auto-delivery marker', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    deliveryMarkerRows.push({ id: 2 });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result.outcome).toBe('skipped_already_delivered');
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({ outcome: 'skipped_already_delivered' });
  });

  it('blocks and flags manual delivery when recipient resolution blocks', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    resolvePrelimRecipientsMock.mockResolvedValue({
      to: null,
      cc: [],
      warnings: [],
      blocked: true,
      blockReason: 'No valid primary prelim recipient resolved',
    });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result).toMatchObject({
      outcome: 'blocked_no_recipient',
      sent: false,
      needsManualDelivery: true,
    });
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({
      outcome: 'blocked_no_recipient',
      needs_manual_delivery: true,
    });
  });

  it('does not auto-send in test mode', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = '2026-07-16T00:00:00.000Z';
    resolvePrelimRecipientsMock.mockResolvedValue(resolvedRecipients);
    getPrelimDeliveryModeMock.mockReturnValue({ mode: 'test', armed: true, testRecipient: 'test@example.com', message: 'TEST' });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result.outcome).toBe('not_armed');
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({
      outcome: 'not_armed',
      reason: 'prelim auto-delivery requires PRELIM_DELIVERY_LIVE=true',
    });
  });
});
