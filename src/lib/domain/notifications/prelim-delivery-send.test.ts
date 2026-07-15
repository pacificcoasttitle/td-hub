import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPrelimDeliveryEmail } from './prelim-delivery-send';

const {
  downloadFile,
  orderContextRows,
  prelimDocRows,
  resolvePrelimRecipients,
  sendEmail,
  writePrelimDeliveryProofs,
} = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  orderContextRows: [] as Array<{
    fileNumber: string;
    propertyAddress: string | null;
    fallbackAddress: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    apn: string | null;
    titleOfficerEmail: string | null;
    titleOfficerName: string | null;
    titleOfficerPhone: string | null;
    titleOfficerCell: string | null;
  }>,
  prelimDocRows: [] as Array<{
    id: number;
    filename: string;
    contentType: string | null;
    storageKey: string;
    sizeBytes: number | null;
    createdAt: Date;
  }>,
  resolvePrelimRecipients: vi.fn(),
  sendEmail: vi.fn(),
  writePrelimDeliveryProofs: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  desc: (field: unknown) => field,
  eq: (field: unknown, value: unknown) => ({ type: 'eq', field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    id: 'contacts.id',
    email: 'contacts.email',
    fullName: 'contacts.full_name',
    phone: 'contacts.phone',
    cell: 'contacts.cell',
  },
  documents: {
    __table: 'documents',
    id: 'documents.id',
    orderId: 'documents.order_id',
    category: 'documents.category',
    status: 'documents.status',
    filename: 'documents.filename',
    contentType: 'documents.content_type',
    storageKey: 'documents.storage_key',
    sizeBytes: 'documents.size_bytes',
    createdAt: 'documents.created_at',
  },
  orderProperties: {
    orderId: 'order_properties.order_id',
    fullAddress: 'order_properties.full_address',
    address: 'order_properties.address',
    city: 'order_properties.city',
    state: 'order_properties.state',
    zip: 'order_properties.zip',
    apn: 'order_properties.apn',
  },
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    titleOfficerId: 'orders.title_officer_id',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) => {
        const rows = table.__table === 'documents' ? prelimDocRows : orderContextRows;
        const query = {
          leftJoin: vi.fn(() => query),
          where: vi.fn(() => ({
            limit: vi.fn(async (count: number) => rows.slice(0, count)),
            orderBy: vi.fn(async () => rows),
          })),
        };
        return query;
      }),
    })),
  },
}));

vi.mock('./prelim-recipient-resolution', () => ({
  resolvePrelimRecipients,
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  downloadFile,
}));

vi.mock('@/lib/integrations/sendgrid/client', () => ({
  sendEmail,
}));

vi.mock('./prelim-delivery-writeback', () => ({
  writePrelimDeliveryProofs,
}));

describe('sendPrelimDeliveryEmail', () => {
  const originalOverride = process.env.PRELIM_DELIVERY_TEST_RECIPIENT;
  const originalLive = process.env.PRELIM_DELIVERY_LIVE;

  beforeEach(() => {
    process.env.PRELIM_DELIVERY_TEST_RECIPIENT = 'safe-test@example.com';
    delete process.env.PRELIM_DELIVERY_LIVE;
    orderContextRows.splice(0, orderContextRows.length, {
      fileNumber: '12345-PCT',
      propertyAddress: '123 Main St, Downey, CA 90241',
      fallbackAddress: null,
      city: null,
      state: null,
      zip: null,
      apn: '999-111-222',
      titleOfficerEmail: 'unit42@pct.com',
      titleOfficerName: 'Title Unit 42',
      titleOfficerPhone: '562-555-0100',
      titleOfficerCell: null,
    });
    prelimDocRows.splice(0, prelimDocRows.length,
      {
        id: 1,
        filename: 'not-the-pdf.txt',
        contentType: 'text/plain',
        storageKey: 'prelim/not-the-pdf.txt',
        sizeBytes: 12,
        createdAt: new Date('2026-07-15T17:00:00.000Z'),
      },
      {
        id: 2,
        filename: 'prelim-report.pdf',
        contentType: 'application/pdf',
        storageKey: 'prelim/prelim-report.pdf',
        sizeBytes: 1024,
        createdAt: new Date('2026-07-15T17:01:00.000Z'),
      },
    );
    resolvePrelimRecipients.mockResolvedValue({
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [],
      warnings: [],
      blocked: false,
    });
    downloadFile.mockResolvedValue({
      success: true,
      data: Buffer.from('%PDF smoke test'),
    });
    sendEmail.mockResolvedValue({
      success: true,
      data: { messageId: 'sg-message-id' },
    });
    writePrelimDeliveryProofs.mockResolvedValue({
      deliveredAt: '2026-07-15T20:00:00.000Z',
      deliveredAtPt: '2026-07-15 13:00 PT',
      softproNoteId: 'prelim-delivery-12345-PCT-1780000000000',
      addNotesStatus: 200,
      addNotesMessage: 'Note added successfully to the file',
      softproSynced: true,
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

  it('sends only to the test override while showing real intended recipients and attaching the prelim PDF', async () => {
    const reviewedRecipients = {
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [
        { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' },
        { email: 'assistant@example.com', name: 'Assistant', role: 'Assistant', source: 'officer_cc_defaults' },
      ],
    };
    const result = await sendPrelimDeliveryEmail(123, reviewedRecipients, {
      id: 'user-1',
      name: 'PCT User',
      email: 'user@pct.com',
    });

    expect(downloadFile).toHaveBeenCalledWith('prelim/prelim-report.pdf');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'safe-test@example.com',
      cc: [],
      from: 'openorders@pct.com',
      replyTo: 'unit42@pct.com',
      subject: 'Preliminary Title Report — 123 Main St, Downey, CA 90241 — File 12345-PCT',
      attachments: [
        {
          content: Buffer.from('%PDF smoke test').toString('base64'),
          type: 'application/pdf',
          filename: 'prelim-report.pdf',
          disposition: 'attachment',
        },
      ],
    }));
    const emailParams = sendEmail.mock.calls[0]?.[0];
    expect(emailParams.html).toContain('Pacific Coast Title');
    expect(emailParams.html).toContain('Preliminary Title Report');
    expect(emailParams.html).toContain('TEST — would have gone to:');
    expect(emailParams.html.indexOf('TEST — would have gone to:')).toBeLessThan(emailParams.html.indexOf('Hello,'));
    expect(emailParams.html).toContain('TO: Escrow Officer &lt;eo@example.com&gt;');
    expect(emailParams.html).toContain('CC: Title Rep &lt;title@example.com&gt;');
    expect(emailParams.html).toContain('The Preliminary Title Report for the property below is attached. <b>Please review it carefully.</b>');
    expect(emailParams.html).toContain('Preliminary Title Report.pdf · 15 B');
    expect(emailParams.html).toContain('Property');
    expect(emailParams.html).toContain('123 Main St, Downey, CA 90241');
    expect(emailParams.html).toContain('Questions about this prelim?');
    expect(emailParams.text).toContain('CC: Assistant <assistant@example.com> (Assistant via officer_cc_defaults)');
    expect(emailParams.text).toContain('Hello,');
    expect(emailParams.text).toContain('The Preliminary Title Report for the property below is attached.');
    expect(emailParams.text).toContain('Please review it carefully.');
    expect(emailParams.text).toContain('Preliminary Title Report.pdf · 15 B');
    expect(emailParams.text).toContain('APN: 999-111-222');
    expect(emailParams.html).toContain('Title Unit 42 · unit42@pct.com · 562-555-0100');
    expect(emailParams.text).toContain('Title officer: Title Unit 42 · unit42@pct.com · 562-555-0100');
    expect(emailParams.text).toContain('Questions about this prelim? Contact the title unit — reply to this email or call the number below.');

    expect(result).toMatchObject({
      messageId: 'sg-message-id',
      deliveryMode: {
        mode: 'test',
        armed: true,
        testRecipient: 'safe-test@example.com',
      },
      testMode: true,
      sentTo: ['safe-test@example.com'],
      sentCc: [],
      from: 'openorders@pct.com',
      replyTo: 'unit42@pct.com',
      attachment: {
        documentId: 2,
        filename: 'prelim-report.pdf',
        contentType: 'application/pdf',
        sizeBytes: Buffer.from('%PDF smoke test').length,
      },
    });
    expect(writePrelimDeliveryProofs).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 123,
      fileNumber: '12345-PCT',
      documentId: 2,
      sendgridMessageId: 'sg-message-id',
      recipients: reviewedRecipients,
      actor: { id: 'user-1', name: 'PCT User', email: 'user@pct.com' },
    }));
  });

  it('sends to the real resolved To and CC when live delivery is explicitly armed', async () => {
    delete process.env.PRELIM_DELIVERY_TEST_RECIPIENT;
    process.env.PRELIM_DELIVERY_LIVE = 'true';

    const result = await sendPrelimDeliveryEmail(123, {
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [
        { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' },
        { email: 'assistant@example.com', name: 'Assistant', role: 'Assistant', source: 'officer_cc_defaults' },
      ],
    }, {
      id: 'user-1',
      name: 'PCT User',
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'eo@example.com',
      cc: ['title@example.com', 'assistant@example.com'],
      from: 'openorders@pct.com',
      replyTo: 'unit42@pct.com',
      attachments: expect.any(Array),
    }));
    const emailParams = sendEmail.mock.calls[0]?.[0];
    expect(emailParams.html).not.toContain('TEST — would have gone to:');
    expect(emailParams.html).toContain('Preliminary Title Report.pdf · 15 B');
    expect(emailParams.html).toContain('background:#FFF4EE;border-left:3px solid #F26B2B');
    expect(emailParams.text).not.toContain('TEST — would have gone to:');
    expect(emailParams.to).not.toBe('safe-test@example.com');
    expect(result).toMatchObject({
      deliveryMode: {
        mode: 'live',
        armed: true,
      },
      testMode: false,
      sentTo: ['eo@example.com'],
      sentCc: ['title@example.com', 'assistant@example.com'],
    });
  });

  it('blocks without sending when neither test override nor live arming is set', async () => {
    delete process.env.PRELIM_DELIVERY_TEST_RECIPIENT;
    delete process.env.PRELIM_DELIVERY_LIVE;

    await expect(sendPrelimDeliveryEmail(123, {
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [],
    }, {
      id: 'user-1',
      name: 'PCT User',
    })).rejects.toThrow('prelim delivery not armed');

    expect(downloadFile).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to open orders as Reply-To when no title officer email resolves', async () => {
    orderContextRows.splice(0, orderContextRows.length, {
      fileNumber: '12345-PCT',
      propertyAddress: '123 Main St, Downey, CA 90241',
      fallbackAddress: null,
      city: null,
      state: null,
      zip: null,
      apn: '999-111-222',
      titleOfficerEmail: null,
      titleOfficerName: null,
      titleOfficerPhone: null,
      titleOfficerCell: null,
    });

    const result = await sendPrelimDeliveryEmail(123, {
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [],
    }, {
      id: 'user-1',
      name: 'PCT User',
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      replyTo: 'openorders@pct.com',
    }));
    expect(result.replyTo).toBe('openorders@pct.com');
  });

  it('does not send when the prelim PDF attachment cannot be fetched', async () => {
    downloadFile.mockResolvedValue({
      success: false,
      error: {
        code: 'STREAM_FAILED',
        message: 'S3 download failed',
        retryable: true,
        vendor: 's3',
      },
    });

    await expect(sendPrelimDeliveryEmail(123, {
      to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [],
    }, {
      id: 'user-1',
      name: 'PCT User',
    })).rejects.toThrow('S3 download failed');

    expect(downloadFile).toHaveBeenCalledWith('prelim/prelim-report.pdf');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
