import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ingestMock,
  getSettingMock,
  resolveSelectMock,
  insertValuesMock,
  analyzeMock,
} = vi.hoisted(() => ({
  ingestMock: vi.fn(),
  getSettingMock: vi.fn(),
  resolveSelectMock: vi.fn(),
  insertValuesMock: vi.fn(),
  analyzeMock: vi.fn(),
}));

vi.mock('@/lib/domain/documents/ingest-prelim-from-softpro', () => ({
  ingestPrelimFromSoftPro: (...args: unknown[]) => ingestMock(...args),
}));

vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('@/lib/tessa', () => ({
  analyzePrelim: (...args: unknown[]) => analyzeMock(...args),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'orders.id', fileNumber: 'orders.file_number' },
  documents: { id: 'documents.id', storageKey: 'documents.storage_key' },
  documentAudit: {},
  orderStatusHistory: {},
  eventOutbox: {},
  vendorApiLogs: {},
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => resolveSelectMock()),
    insert: vi.fn(() => ({ values: insertValuesMock })),
  },
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(),
}));

import { handlePrelimWebhook, prelimPayloadSchema } from './softpro-handler';

function chainLimit(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { from, where, limit };
}

describe('prelimPayloadSchema (legacy PHP + array shape)', () => {
  it('accepts DocumentAdded legacy payload', () => {
    const parsed = prelimPayloadSchema.safeParse({
      Event: 'DocumentAdded',
      OrderNumber: '20012345-OCT',
      DocumentUrl: 'https://softpro.example/p.pdf',
      StoredDocumentName: 'Prelim.pdf',
      OrderId: 12345,
      OccurredAt: '2026-07-10T12:00:00Z',
      Source: 'legacy-post-prelim-report',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts data[] shape', () => {
    const parsed = prelimPayloadSchema.safeParse({
      OrderNumber: '20012345-OCT',
      data: ['https://softpro.example/p.pdf'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects missing document reference', () => {
    const parsed = prelimPayloadSchema.safeParse({ OrderNumber: '20012345-OCT' });
    expect(parsed.success).toBe(false);
  });
});

describe('handlePrelimWebhook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSettingMock.mockResolvedValue('false');
    insertValuesMock.mockResolvedValue(undefined);
    analyzeMock.mockResolvedValue({ status: 'complete' });
    resolveSelectMock.mockImplementation(() =>
      chainLimit([{ id: 7, fileNumber: '20012345-OCT' }]),
    );
  });

  it('routes legacy DocumentAdded through shared ingest + delivery', async () => {
    ingestMock.mockResolvedValue({
      outcome: 'ingested',
      documentId: 55,
      checksum: 'abc',
      storageKey: 'prelim-upload-doc/20012345-OCT/1_Prelim.pdf',
      isUpdate: false,
      delivery: { outcome: 'delivered', sent: true, needsManualDelivery: false },
    });

    const result = await handlePrelimWebhook({
      Event: 'DocumentAdded',
      OrderNumber: '20012345-OCT',
      DocumentUrl: 'https://softpro.example/p.pdf',
      StoredDocumentName: 'Prelim.pdf',
      OccurredAt: '2026-07-10T12:00:00Z',
      Source: 'legacy-post-prelim-report',
    });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(ingestMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 7,
      documentUrl: 'https://softpro.example/p.pdf',
      storedDocumentName: 'Prelim.pdf',
      source: 'softpro_webhook',
      deliver: true,
      triggeredBy: 'softpro_webhook',
    }));
    expect(result.outcomes?.[0]?.outcome).toBe('ingested');
    expect(result.outcomes?.[0]?.delivered).toBe(true);

    const vendors = insertValuesMock.mock.calls
      .map((c) => (c[0] as { vendor?: string }).vendor)
      .filter(Boolean);
    expect(vendors.every((v) => v === 'softpro_webhook')).toBe(true);
  });

  it('same prelim as cron → dedupe no-op (processed stays 0)', async () => {
    ingestMock.mockResolvedValue({
      outcome: 'deduped',
      documentId: 10,
      reason: 'prelim identity already stored (url / name / checksum)',
    });

    const result = await handlePrelimWebhook({
      OrderNumber: '20012345-OCT',
      DocumentUrl: 'https://softpro.example/same.pdf',
      StoredDocumentName: 'same.pdf',
    });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.outcomes?.[0]?.outcome).toBe('deduped');
  });
});
