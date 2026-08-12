import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deliveryMarkerRows,
  insertRows,
  resolvePrelimRecipientsMock,
  getPrelimDeliveryModeMock,
  sendPrelimDeliveryEmailMock,
} = vi.hoisted(() => ({
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
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => deliveryMarkerRows),
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
  // Declared on the mock so `instanceof` in the handler resolves against the
  // same constructor the test throws. A look-alike class would fall through to
  // the generic delivery_failed branch and the test would pass for the wrong
  // reason.
  PrelimContentCheckFailedError: class PrelimContentCheckFailedError extends Error {
    constructor(
      public reason: string,
      public filename: string,
      public matched: string[],
    ) {
      super(`Prelim content check failed (${reason}) for ${filename}`);
      this.name = 'PrelimContentCheckFailedError';
    }
  },
}));

import { maybeAutoDeliverPrelim } from './prelim-auto-delivery';

const CUTOFF = '2026-07-16T00:00:00.000Z';

const baseInput = {
  orderId: 5029,
  documentId: 3982,
  documentCreatedAt: new Date(CUTOFF),
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

function armLiveDelivery() {
  resolvePrelimRecipientsMock.mockResolvedValue(resolvedRecipients);
  getPrelimDeliveryModeMock.mockReturnValue({ mode: 'live', armed: true, message: 'LIVE' });
  sendPrelimDeliveryEmailMock.mockResolvedValue({ messageId: 'sg-message-id' });
}

describe('maybeAutoDeliverPrelim', () => {
  beforeEach(() => {
    deliveryMarkerRows.splice(0, deliveryMarkerRows.length);
    insertRows.splice(0, insertRows.length);
    resolvePrelimRecipientsMock.mockReset();
    getPrelimDeliveryModeMock.mockReset();
    sendPrelimDeliveryEmailMock.mockReset();
    delete process.env.PRELIM_AUTO_DELIVERY_CUTOFF;
  });

  it('skips when the prelim document arrived before the cutoff', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;

    const result = await maybeAutoDeliverPrelim({
      ...baseInput,
      documentCreatedAt: new Date('2026-07-15T23:59:59.000Z'),
    });

    expect(result.outcome).toBe('skipped_before_cutoff');
    expect(result.reason).toBe('prelim arrived before auto-delivery cutoff');
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({
      outcome: 'skipped_before_cutoff',
      reason: 'prelim arrived before auto-delivery cutoff',
    });
  });

  it('delivers a post-cutoff prelim even when the order opened before the cutoff', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
    armLiveDelivery();

    // Arrival-gate proof: order age is irrelevant; only the prelim document's created_at matters.
    const result = await maybeAutoDeliverPrelim({
      ...baseInput,
      documentCreatedAt: new Date('2026-07-16T00:00:00.000Z'),
    });

    expect(result).toMatchObject({ outcome: 'delivered', sent: true, messageId: 'sg-message-id' });
    expect(sendPrelimDeliveryEmailMock).toHaveBeenCalledTimes(1);
    expect(sendPrelimDeliveryEmailMock).toHaveBeenCalledWith(
      5029,
      { to: resolvedRecipients.to, cc: resolvedRecipients.cc },
      expect.objectContaining({ id: 'system:prelim_auto_delivery' }),
      // Automatic delivery MUST demand the content gate. A manual send does not:
      // there, a human chose the document.
      { requirePrelimContent: true },
    );
    expect(latestOutcome()).toMatchObject({ outcome: 'delivered', message_id: 'sg-message-id' });
  });

  it('routes a refused document to manual review — never sent, never silently skipped', async () => {
    // The Aug 11 case: an internal bundle that does not read as a prelim. The
    // send throws PrelimContentCheckFailedError, and auto-delivery must record a
    // DISTINCT outcome so "we caught a wrong document" is not filed under "the
    // vendor broke" — those need completely different responses.
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
    armLiveDelivery();

    const { PrelimContentCheckFailedError } = await import('./prelim-delivery-send');
    sendPrelimDeliveryEmailMock.mockRejectedValueOnce(
      new PrelimContentCheckFailedError('no_prelim_markers', 'dnu_140209.pdf', []),
    );

    const result = await maybeAutoDeliverPrelim({ ...baseInput });

    expect(result.sent).toBe(false);
    expect(result.outcome).toBe('blocked_content_check');
    expect(result.needsManualDelivery).toBe(true);
    expect(result.outcome).not.toBe('delivery_failed');
    expect(latestOutcome()).toMatchObject({
      outcome: 'blocked_content_check',
      needs_manual_delivery: true,
    });
  });

  it('blocks a second send for the same prelim document via idempotency', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
    armLiveDelivery();

    const first = await maybeAutoDeliverPrelim(baseInput);
    expect(first.outcome).toBe('delivered');
    expect(sendPrelimDeliveryEmailMock).toHaveBeenCalledTimes(1);

    deliveryMarkerRows.push({ id: 1 });
    sendPrelimDeliveryEmailMock.mockClear();

    const second = await maybeAutoDeliverPrelim(baseInput);
    expect(second.outcome).toBe('skipped_already_delivered');
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({ outcome: 'skipped_already_delivered' });
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

  it('sends an updated prelim version on a post-cutoff arrival', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
    armLiveDelivery();
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
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
    deliveryMarkerRows.push({ id: 1 });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result.outcome).toBe('skipped_already_delivered');
    expect(resolvePrelimRecipientsMock).not.toHaveBeenCalled();
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({ outcome: 'skipped_already_delivered' });
  });

  it('skips when the same prelim version has only an auto-delivery marker', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
    deliveryMarkerRows.push({ id: 2 });

    const result = await maybeAutoDeliverPrelim(baseInput);

    expect(result.outcome).toBe('skipped_already_delivered');
    expect(sendPrelimDeliveryEmailMock).not.toHaveBeenCalled();
    expect(latestOutcome()).toMatchObject({ outcome: 'skipped_already_delivered' });
  });

  it('blocks and flags manual delivery when recipient resolution blocks', async () => {
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
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
    process.env.PRELIM_AUTO_DELIVERY_CUTOFF = CUTOFF;
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
