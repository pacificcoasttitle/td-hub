import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retryPrelimDeliveryNoteWriteback, writePrelimDeliveryProofs } from './prelim-delivery-writeback';

const {
  addNotes,
  insertRows,
  noteRows,
  orderRows,
  updateRows,
  failTables,
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
  /** Tables the db mock should throw for, so one artefact can fail alone. */
  failTables: new Set<string>(),
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
        if (failTables.has(table.__table)) {
          const err = new Error(`insert or update on table "${table.__table}" violates foreign key constraint`) as Error & { code?: string };
          err.code = '23503';
          throw err;
        }
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
    failTables.clear();
  });

  const systemInput = {
    orderId: 8173,
    fileNumber: '20021690-OCT',
    documentId: 4471,
    sendgridMessageId: 'sg-auto',
    deliveredAt: new Date('2026-09-10T02:15:38.000Z'),
    actor: { id: 'system:prelim_auto_delivery', name: 'TD Hub Auto Delivery', email: 'openorders@pct.com' },
    deliveryMode: { mode: 'live', armed: true, message: 'LIVE' } as const,
    recipients: {
      to: { email: 'jenny@successescrow.net', name: 'Jenny', role: 'escrow_officer' },
      cc: [],
    },
  };

  // REGRESSION. order_notes.author_id is a foreign key onto profiles, and
  // 'system:prelim_auto_delivery' is not a person. Sending it raised 23503 and
  // took the whole writeback down 1,082 times without ever surfacing.
  it('writes a system-authored note with a null author_id and keeps the actor elsewhere', async () => {
    addNotes.mockResolvedValue({ success: true, data: [{ Status: 200, Message: 'Note added successfully' }] });

    const result = await writePrelimDeliveryProofs(systemInput);

    const note = insertRows.find((r) => r.table === 'order_notes');
    expect(note?.values.authorId).toBeNull();
    expect(note?.values.authorName).toBe('TD Hub Auto Delivery');

    // No FK on these two, so they stay attributable to the system actor.
    for (const table of ['admin_activity_logs', 'document_audit']) {
      const row = insertRows.find((r) => r.table === table);
      expect(row, `${table} row missing`).toBeDefined();
    }
    expect(insertRows.find((r) => r.table === 'admin_activity_logs')?.values.userId)
      .toBe('system:prelim_auto_delivery');
    expect(result.failedArtefacts).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  // REGRESSION. The four artefacts used to be four bare awaits, so the first
  // failure discarded the other three — including the proof row the delivery
  // log reads. They must now stand or fall alone.
  it('still writes the other three artefacts when one fails, and records the failure', async () => {
    addNotes.mockResolvedValue({ success: true, data: [{ Status: 200, Message: 'Note added successfully' }] });
    failTables.add('order_notes');

    const result = await writePrelimDeliveryProofs(systemInput);

    // The proof row the delivery log reads survives a failure below it.
    const proof = insertRows.filter((r) => r.table === 'admin_activity_logs');
    expect(proof.some((r) => r.values.action === 'prelim_delivered')).toBe(true);
    expect(insertRows.some((r) => r.table === 'order_status_history')).toBe(true);
    expect(insertRows.some((r) => r.table === 'document_audit')).toBe(true);

    // And the failure is persisted rather than downgraded to a dropped string.
    const recorded = proof.find((r) => r.values.action === 'prelim_delivery_writeback_failed');
    expect(recorded).toBeDefined();
    expect((recorded!.values.meta as { failed: { artefact: string; code: string }[] }).failed[0])
      .toMatchObject({ artefact: 'order_notes', code: '23503' });

    expect(result.failedArtefacts.map((f) => f.artefact)).toEqual(['order_notes']);
    expect(result.warning).toContain('order_notes');
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
