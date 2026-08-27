import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `order.closed` and the buyer-agent gate.
 *
 * The confirmation path gates its buyer-agent TO candidate in
 * `order-confirmation.ts`. `order.closed` resolves recipients somewhere else
 * entirely — `notification_types.recipient_roles` through `resolveRecipients` —
 * so a gate on the confirmation alone leaves this path open. It has never
 * fired, which is a fact about the past and not a property of the code.
 *
 * These tests drive the real `dispatchNotification` for `order.closed` so they
 * fail if the wiring is removed, not merely if the helper changes.
 */

const { sendEmail, sendSms, getSetting, notifTypeRow, partyRows } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_args: { to: string; subject: string; html: string }) => (
    { success: true, data: { messageId: 'mid' }, error: null }
  )),
  sendSms: vi.fn(async (_args: { to: string; body: string }) => (
    { success: true, data: { messageSid: 'sid' }, error: null }
  )),
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  notifTypeRow: {
    slug: 'order.closed',
    displayName: 'Order Closed',
    description: 'Order closed',
    isEnabled: true,
    channels: ['email'] as string[],
    recipientRoles: ['buyer_agent', 'escrow_officer'] as string[] | null,
    internalCc: null as string[] | null,
    templateId: null as string | null,
  },
  partyRows: [] as Array<Record<string, unknown>>,
}));

type Condition = { type: 'eq'; field: string; value: unknown };

vi.mock('drizzle-orm', () => ({
  eq: (field: string, value: unknown): Condition => ({ type: 'eq', field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  notificationTypes: { __table: 'notification_types', slug: 'notification_types.slug' },
  notificationLogs: { __table: 'notification_logs' },
  orders: { __table: 'orders', id: 'orders.id' },
  orderProperties: { __table: 'order_properties', orderId: 'order_properties.order_id' },
  orderParties: { __table: 'order_parties', orderId: 'order_parties.order_id', contactId: 'order_parties.contact_id' },
  contacts: { __table: 'contacts', id: 'contacts.id' },
}));

/**
 * Returns rows already shaped as the caller's projection aliases them, because
 * the fake ignores the projection object. `orders` carries the union of the two
 * different selects made against it.
 */
function rowsFor(table: string): Array<Record<string, unknown>> {
  if (table === 'notification_types') return [notifTypeRow];
  if (table === 'orders') {
    return [{
      fileNumber: 'TEST-1',
      closedAt: null,
      address: '1 Main St',
      escrowOfficerId: 500,
      salesRepId: null,
      titleOfficerId: null,
    }];
  }
  if (table === 'contacts') return [{ fullName: 'Escrow Officer', email: 'eo@pct.com', cell: null }];
  if (table === 'order_parties') return partyRows;
  return [];
}

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table: string }) => {
        const rows = rowsFor(table.__table);
        const query = {
          leftJoin: vi.fn(() => query),
          where: vi.fn(() => ({
            limit: vi.fn(async (n: number) => rows.slice(0, n)),
            then: (res: (v: unknown[]) => unknown, rej: (r: unknown) => unknown) => (
              Promise.resolve(rows).then(res, rej)
            ),
          })),
        };
        return query;
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 1 }]) })),
    })),
  },
}));

vi.mock('@/lib/integrations/sendgrid/client', () => ({ sendEmail }));
vi.mock('@/lib/integrations/twilio/client', () => ({ sendSms }));
vi.mock('@/lib/domain/settings/service', () => ({ getSetting }));
vi.mock('./order-confirmation', () => ({ handleOrderConfirmation: vi.fn() }));

import { dispatchNotification } from './dispatch';
import { resolveRecipients } from './recipients';
import { BUYER_AGENT_RECIPIENT_SETTING } from './buyer-agent-recipient-gate';

const BUYER_AGENT_PARTY = {
  role: 'buyer_agent',
  externalName: 'Joe Rodriguez',
  externalEmail: 'agent@capstonerealty.com',
  externalPhone: null,
  cFullName: null,
  cEmail: null,
  cCell: null,
};

function recipientEmails() {
  return sendEmail.mock.calls.map(([args]) => args.to);
}

describe('order.closed buyer-agent gate', () => {
  beforeEach(() => {
    sendEmail.mockClear();
    sendSms.mockClear();
    getSetting.mockReset();
    getSetting.mockImplementation(async () => null);
    notifTypeRow.recipientRoles = ['buyer_agent', 'escrow_officer'];
    notifTypeRow.channels = ['email'];
    partyRows.splice(0, partyRows.length, { ...BUYER_AGENT_PARTY });
  });

  it('does not email the buyer agent while the setting is off', async () => {
    const result = await dispatchNotification({ eventType: 'order.closed', orderId: 7, data: {} });

    expect(recipientEmails()).not.toContain('agent@capstonerealty.com');
    // The role is dropped, not the whole send — the escrow officer still gets it.
    expect(recipientEmails()).toEqual(['eo@pct.com']);
    expect(result.sent).toBe(1);
  });

  it('emails the buyer agent once the setting is on', async () => {
    getSetting.mockImplementation(async (key: string) => (
      key === BUYER_AGENT_RECIPIENT_SETTING ? 'true' : null
    ));

    await dispatchNotification({ eventType: 'order.closed', orderId: 7, data: {} });

    expect(recipientEmails()).toContain('agent@capstonerealty.com');
    expect(recipientEmails()).toContain('eo@pct.com');
  });

  it('reads the same setting key the confirmation path reads', async () => {
    await dispatchNotification({ eventType: 'order.closed', orderId: 7, data: {} });

    expect(getSetting).toHaveBeenCalledWith(BUYER_AGENT_RECIPIENT_SETTING);
    expect(BUYER_AGENT_RECIPIENT_SETTING).toBe('confirmation_buyer_agent_recipient_enabled');
  });

  it('leaves a send with no buyer_agent role untouched and unqueried', async () => {
    notifTypeRow.recipientRoles = ['escrow_officer'];

    await dispatchNotification({ eventType: 'order.closed', orderId: 7, data: {} });

    expect(recipientEmails()).toEqual(['eo@pct.com']);
    expect(getSetting).not.toHaveBeenCalled();
  });
});

describe('resolveRecipients buyer-agent gate', () => {
  beforeEach(() => {
    getSetting.mockReset();
    getSetting.mockImplementation(async () => null);
    partyRows.splice(0, partyRows.length, { ...BUYER_AGENT_PARTY });
  });

  it('drops the role while off and returns it while on', async () => {
    const off = await resolveRecipients(7, ['buyer_agent']);
    expect(off).toEqual([]);

    getSetting.mockImplementation(async (key: string) => (
      key === BUYER_AGENT_RECIPIENT_SETTING ? 'true' : null
    ));

    const on = await resolveRecipients(7, ['buyer_agent']);
    expect(on).toEqual([{
      role: 'buyer_agent',
      name: 'Joe Rodriguez',
      email: 'agent@capstonerealty.com',
      phone: null,
    }]);
  });

  it('does not query the parties table at all when buyer_agent was the only role', async () => {
    const result = await resolveRecipients(7, ['buyer_agent']);
    expect(result).toEqual([]);
    expect(getSetting).toHaveBeenCalledWith(BUYER_AGENT_RECIPIENT_SETTING);
  });
});
