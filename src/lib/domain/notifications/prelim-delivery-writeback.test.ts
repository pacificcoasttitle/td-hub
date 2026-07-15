import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retryPrelimDeliveryNoteWriteback, writePrelimDeliveryProofs } from './prelim-delivery-writeback';

const {
  addNotes,
  insertRows,
  noteRows,
  orderRows,
  updateRows,
} = vi.hoisted(() => ({
  addNotes: vi.fn(),
  insertRows: [] as Array<{ table: string; values: Record<string, unknown> }>,
  noteRows: [] as Array<{
    id: number;
    orderId: number;
    body: string;
    softproNoteId: string | null;
  }>,
  orderRows: [] as Array<{ id: number; fileNumber: string }>,
  updateRows: [] as Array<{ table: string; values: Record<string, unknown>; condition: unknown }>,
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: string, value: unknown) => ({ field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  adminActivityLogs: { __table: 'admin_activity_logs' },
  documentAudit: { __table: 'document_audit' },
  orderNotes: {
    __table: 'order_notes',
    id: 'order_notes.id',
    orderId: 'order_notes.order_id',
    body: 'order_notes.body',
    softproNoteId: 'order_notes.softpro_note_id',
  },
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
  },
  orderStatusHistory: { __table: 'order_status_history' },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn((table: { __table: string }) => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        insertRows.push({ table: table.__table, values });
        return [];
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table: { __table: string }) => ({
        where: vi.fn((condition: { field: string; value: unknown }) => ({
          limit: vi.fn(async () => {
            if (table.__table === 'order_notes') {
              return noteRows.filter((row) => row.id === condition.value);
            }
            if (table.__table === 'orders') {
              return orderRows.filter((row) => row.id === condition.value);
            }
            return [];
          }),
        })),
      })),
    })),
    update: vi.fn((table: { __table: string }) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async (condition: unknown) => {
          updateRows.push({ table: table.__table, values, condition });
        }),
      })),
    })),
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({
  addNotes,
}));

describe('prelim delivery writeback', () => {
  beforeEach(() => {
    addNotes.mockReset();
    insertRows.splice(0, insertRows.length);
    noteRows.splice(0, noteRows.length);
    orderRows.splice(0, orderRows.length);
    updateRows.splice(0, updateRows.length);
  });

  it('persists SendGrid and SoftPro AddNotes proofs with deterministic note id', async () => {
    addNotes.mockResolvedValue({
      success: true,
      data: [{ Status: 200, Message: 'Note added successfully to the file', Id: 'prelim-delivery-20018881-OCT-1784145600000' }],
    });

    const result = await writePrelimDeliveryProofs({
      orderId: 5029,
      fileNumber: '20018881-OCT',
      documentId: 3982,
      sendgridMessageId: 'sg-message-id',
      deliveredAt: new Date('2026-07-15T20:00:00.000Z'),
      actor: { id: 'user-1', name: 'PCT User', email: 'user@pct.com' },
      deliveryMode: { mode: 'live', armed: true, message: 'LIVE — will send to the real recipients below' },
      recipients: {
        to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
        cc: [{ email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' }],
      },
    });

    expect(addNotes).toHaveBeenCalledWith(
      '20018881-OCT',
      expect.stringContaining('Prelim delivered via TD Hub on 2026-07-15 13:00 PT by PCT User.'),
      'prelim-delivery-20018881-OCT-1784145600000',
    );
    expect(result).toMatchObject({
      softproNoteId: 'prelim-delivery-20018881-OCT-1784145600000',
      addNotesStatus: 200,
      addNotesMessage: 'Note added successfully to the file',
      softproSynced: true,
      deliveredAtPt: '2026-07-15 13:00 PT',
    });

    const noteInsert = insertRows.find((row) => row.table === 'order_notes')?.values;
    expect(noteInsert).toMatchObject({
      orderId: 5029,
      softproNoteId: 'prelim-delivery-20018881-OCT-1784145600000',
      isSyncedToSoftpro: true,
      subject: 'Prelim delivered',
    });
    expect(noteInsert?.syncedAt).toBeInstanceOf(Date);

    const adminLog = insertRows.find((row) => row.table === 'admin_activity_logs')?.values;
    expect(adminLog).toMatchObject({
      action: 'prelim_delivered',
      entityType: 'order',
      entityId: '5029',
    });
    expect(adminLog?.meta).toMatchObject({
      sendgrid_message_id: 'sg-message-id',
      softpro_note_id: 'prelim-delivery-20018881-OCT-1784145600000',
      addnotes_status: 200,
      addnotes_message: 'Note added successfully to the file',
      document_id: 3982,
    });

    expect(insertRows.find((row) => row.table === 'document_audit')?.values).toMatchObject({
      documentId: 3982,
      action: 'delivered',
    });
    expect(insertRows.find((row) => row.table === 'order_status_history')?.values).toMatchObject({
      orderId: 5029,
      status: 'Prelim delivered → 2 recipients',
      source: 'system',
    });
  });

  it('keeps failed AddNotes proof and retries the same deterministic note id', async () => {
    addNotes.mockResolvedValueOnce({
      success: false,
      error: { vendor: 'softpro', code: 'SOFTPRO_ERROR', message: 'AddNotes failed', retryable: true, httpStatus: 500 },
    });

    const failed = await writePrelimDeliveryProofs({
      orderId: 5029,
      fileNumber: '20018881-OCT',
      documentId: 3982,
      sendgridMessageId: 'sg-message-id',
      deliveredAt: new Date('2026-07-15T20:00:00.000Z'),
      actor: { id: 'user-1', name: 'PCT User' },
      deliveryMode: { mode: 'live', armed: true, message: 'LIVE — will send to the real recipients below' },
      recipients: {
        to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
        cc: [],
      },
    });

    expect(failed).toMatchObject({
      softproSynced: false,
      addNotesStatus: 500,
      addNotesMessage: 'AddNotes failed',
      warning: 'SoftPro note writeback failed or is pending',
    });
    expect(insertRows.find((row) => row.table === 'order_notes')?.values).toMatchObject({
      isSyncedToSoftpro: false,
      softproNoteId: 'prelim-delivery-20018881-OCT-1784145600000',
    });

    noteRows.push({
      id: 10,
      orderId: 5029,
      body: 'Prelim delivered via TD Hub on 2026-07-15 13:00 PT by PCT User.',
      softproNoteId: 'prelim-delivery-20018881-OCT-1784145600000',
    });
    orderRows.push({ id: 5029, fileNumber: '20018881-OCT' });
    addNotes.mockResolvedValueOnce({
      success: true,
      data: [{ Status: 200, Message: 'Note added successfully to the file', Id: 'prelim-delivery-20018881-OCT-1784145600000' }],
    });

    const retry = await retryPrelimDeliveryNoteWriteback(10);

    expect(addNotes).toHaveBeenLastCalledWith(
      '20018881-OCT',
      'Prelim delivered via TD Hub on 2026-07-15 13:00 PT by PCT User.',
      'prelim-delivery-20018881-OCT-1784145600000',
    );
    expect(retry).toMatchObject({
      softproSynced: true,
      addNotesStatus: 200,
      softproNoteId: 'prelim-delivery-20018881-OCT-1784145600000',
    });
    expect(updateRows.at(-1)).toMatchObject({
      table: 'order_notes',
      values: { isSyncedToSoftpro: true },
    });
  });
});
