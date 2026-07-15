import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRows } = vi.hoisted(() => ({
  queryRows: [] as unknown[][],
}));

function chain() {
  const query = {
    from: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    groupBy: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => queryRows.shift() ?? []),
  };
  return query;
}

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  desc: (field: unknown) => ({ op: 'desc', field }),
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
  gte: (field: unknown, value: unknown) => ({ op: 'gte', field, value }),
  lte: (field: unknown, value: unknown) => ({ op: 'lte', field, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => chain()),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  adminActivityLogs: {
    id: 'admin_activity_logs.id',
    entityId: 'admin_activity_logs.entity_id',
    meta: 'admin_activity_logs.meta',
    createdAt: 'admin_activity_logs.created_at',
    action: 'admin_activity_logs.action',
  },
  notificationLogs: {
    id: 'notification_logs.id',
    eventType: 'notification_logs.event_type',
    orderId: 'notification_logs.order_id',
    recipientEmail: 'notification_logs.recipient_email',
    recipientName: 'notification_logs.recipient_name',
    recipientRole: 'notification_logs.recipient_role',
    subject: 'notification_logs.subject',
    status: 'notification_logs.status',
    provider: 'notification_logs.provider',
    providerId: 'notification_logs.provider_id',
    createdAt: 'notification_logs.created_at',
    sentAt: 'notification_logs.sent_at',
  },
  orderNotes: {
    softproNoteId: 'order_notes.softpro_note_id',
    isSyncedToSoftpro: 'order_notes.is_synced_to_softpro',
  },
  orders: {
    id: 'orders.id',
    fileNumber: 'orders.file_number',
  },
  vendorApiLogs: {
    id: 'vendor_api_logs.id',
    vendor: 'vendor_api_logs.vendor',
    operation: 'vendor_api_logs.operation',
    orderId: 'vendor_api_logs.order_id',
    requestId: 'vendor_api_logs.request_id',
    requestMeta: 'vendor_api_logs.request_meta',
    responseMeta: 'vendor_api_logs.response_meta',
    success: 'vendor_api_logs.success',
    createdAt: 'vendor_api_logs.created_at',
  },
}));

import { getDeliveryLog } from './delivery-log';

describe('delivery log reconciliation', () => {
  beforeEach(() => {
    queryRows.splice(0, queryRows.length);
  });

  it('renders prelim TO and CC recipients from the stored recipientMeta array shape', async () => {
    queryRows.push(
      [{
        id: 10,
        entityId: '5029',
        orderId: 5029,
        fileNumber: '20018881-OCT',
        createdAt: new Date('2026-07-15T20:00:00.000Z'),
        softproSynced: true,
        meta: {
          recipients: [
            { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer', kind: 'to' },
            { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer', kind: 'cc' },
          ],
          sendgrid_message_id: 'sg-message-id',
          softpro_note_id: 'prelim-delivery-20018881-OCT-1784145600000',
        },
      }],
      [],
      [],
    );

    const result = await getDeliveryLog({ page: 1, pageSize: 25 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.recipients).toEqual([
      { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer', kind: 'to' },
      { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', kind: 'cc' },
    ]);
    expect(result.rows[0]).toMatchObject({
      type: 'prelim_delivered',
      fileNumber: '20018881-OCT',
      sendgridMessageId: 'sg-message-id',
      softproSynced: true,
    });
  });
});
