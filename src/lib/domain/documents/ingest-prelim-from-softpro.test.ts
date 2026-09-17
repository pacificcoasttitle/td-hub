import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  maybeAutoDeliverMock,
  s3UploadMock,
  insertValuesMock,
  insertReturningMock,
  selectLimitMock,
  fetchMock,
} = vi.hoisted(() => ({
  maybeAutoDeliverMock: vi.fn(),
  s3UploadMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/domain/notifications/prelim-auto-delivery', () => ({
  maybeAutoDeliverPrelim: (...args: unknown[]) => maybeAutoDeliverMock(...args),
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: (...args: unknown[]) => s3UploadMock(...args),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
}));

vi.mock('@/lib/db/schema', () => ({
  documents: {
    id: 'documents.id',
    orderId: 'documents.order_id',
    category: 'documents.category',
    status: 'documents.status',
    checksum: 'documents.checksum',
    filename: 'documents.filename',
    originalFilename: 'documents.original_filename',
    createdAt: 'documents.created_at',
    storageKey: 'documents.storage_key',
  },
  documentAudit: {
    id: 'document_audit.id',
    documentId: 'document_audit.document_id',
    action: 'document_audit.action',
    meta: 'document_audit.meta',
    performedAt: 'document_audit.performed_at',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => selectLimitMock()),
    insert: vi.fn(() => ({
      values: (vals: unknown) => {
        insertValuesMock(vals);
        return {
          returning: insertReturningMock,
        };
      },
    })),
  },
}));

import {
  checksumBuffer,
  identitiesMatch,
  ingestPrelimFromSoftPro,
  isNewerThanExisting,
} from './ingest-prelim-from-softpro';

const PDF = Buffer.from('%PDF-1.4 softpro prelim');

function chainSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({
    limit,
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  }));
  const where = vi.fn(() => ({
    orderBy,
    limit,
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  }));
  const from = vi.fn(() => ({ where }));
  return { from, where, orderBy, limit };
}

describe('prelim identity helpers', () => {
  it('matches by checksum, URL, or StoredDocumentName', () => {
    const checksum = checksumBuffer(PDF);
    expect(identitiesMatch(
      { checksum, filename: 'a.pdf', originalFilename: null, sourceUrl: null },
      { sourceUrl: 'https://x/a', checksum, storedDocumentName: 'a.pdf' },
    )).toBe(true);

    expect(identitiesMatch(
      { checksum: null, filename: 'other.pdf', originalFilename: null, sourceUrl: 'https://sp/doc1' },
      { sourceUrl: 'https://sp/doc1', checksum: 'abc', storedDocumentName: 'n.pdf' },
    )).toBe(true);

    expect(identitiesMatch(
      { checksum: null, filename: 'Prelim Report.pdf', originalFilename: 'Prelim Report.pdf', sourceUrl: null },
      { sourceUrl: 'https://sp/new', checksum: 'abc', storedDocumentName: 'prelim report.pdf' },
    )).toBe(true);

    expect(identitiesMatch(
      { checksum: 'zzz', filename: 'a.pdf', originalFilename: null, sourceUrl: 'https://sp/old' },
      { sourceUrl: 'https://sp/new', checksum: 'abc', storedDocumentName: 'b.pdf' },
    )).toBe(false);
  });

  it('defines newer as OccurredAt >= latest existing (or missing OccurredAt)', () => {
    const latest = new Date('2026-07-01T12:00:00Z');
    expect(isNewerThanExisting(new Date('2026-07-01T12:00:00Z'), latest)).toBe(true);
    expect(isNewerThanExisting(new Date('2026-07-02T00:00:00Z'), latest)).toBe(true);
    expect(isNewerThanExisting(new Date('2026-06-30T00:00:00Z'), latest)).toBe(false);
    expect(isNewerThanExisting(null, latest)).toBe(true);
    expect(isNewerThanExisting(new Date('2026-01-01T00:00:00Z'), null)).toBe(true);
  });
});

describe('ingestPrelimFromSoftPro', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => PDF.buffer.slice(PDF.byteOffset, PDF.byteOffset + PDF.byteLength),
    });
    s3UploadMock.mockResolvedValue({ success: true });
    maybeAutoDeliverMock.mockResolvedValue({ outcome: 'delivered', sent: true, needsManualDelivery: false });
    insertReturningMock.mockResolvedValue([{ id: 99, createdAt: new Date('2026-07-10T00:00:00Z') }]);
  });

  it('NO-OPs when same prelim identity already stored (cron/webhook race)', async () => {
    const checksum = checksumBuffer(PDF);
    // First select: existing docs; second would be audit — return meta with same URL
    let call = 0;
    selectLimitMock.mockImplementation(() => {
      call++;
      if (call === 1) {
        return chainSelect([{
          id: 10,
          checksum,
          filename: 'prelim.pdf',
          originalFilename: 'prelim.pdf',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        }]);
      }
      return chainSelect([{
        meta: { sourceUrl: 'https://softpro.example/prelim.pdf', storedDocumentName: 'prelim.pdf' },
      }]);
    });

    const result = await ingestPrelimFromSoftPro({
      orderId: 1,
      fileNumber: '20012345-OCT',
      documentUrl: 'https://softpro.example/prelim.pdf',
      storedDocumentName: 'prelim.pdf',
      source: 'softpro_webhook',
      createdBy: 'webhook:softpro',
      deliver: true,
      triggeredBy: 'softpro_webhook',
    });

    expect(result.outcome).toBe('deduped');
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(maybeAutoDeliverMock).not.toHaveBeenCalled();
  });

  it('ingests new-order prelim, stamps SoftPro-origin, and delivers once', async () => {
    selectLimitMock.mockImplementation(() => chainSelect([]));

    const result = await ingestPrelimFromSoftPro({
      orderId: 1,
      fileNumber: '20012345-OCT',
      documentUrl: 'https://softpro.example/new.pdf',
      storedDocumentName: 'New Prelim.pdf',
      occurredAt: new Date('2026-07-10T15:00:00Z'),
      source: 'softpro_webhook',
      createdBy: 'webhook:softpro',
      deliver: true,
      triggeredBy: 'softpro_webhook',
    });

    expect(result.outcome).toBe('ingested');
    if (result.outcome !== 'ingested') return;
    expect(result.isUpdate).toBe(false);
    expect(result.documentId).toBe(99);
    expect(maybeAutoDeliverMock).toHaveBeenCalledTimes(1);
    expect(maybeAutoDeliverMock).toHaveBeenCalledWith(expect.objectContaining({
      softproDocumentAt: new Date('2026-07-10T15:00:00Z'),
    }));

    const inserted = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.isSyncedToSoftpro).toBe(true);
    expect(inserted.softproListingConfirmed).toBe(true);
    expect(inserted.category).toBe('prelim');
    expect(inserted.checksum).toBe(checksumBuffer(PDF));
  });

  it('updated prelim (new identity + later OccurredAt) re-delivers once', async () => {
    let call = 0;
    selectLimitMock.mockImplementation(() => {
      call++;
      if (call === 1) {
        return chainSelect([{
          id: 10,
          checksum: 'oldhash',
          filename: 'old.pdf',
          originalFilename: 'old.pdf',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        }]);
      }
      return chainSelect([{
        meta: {
          sourceUrl: 'https://softpro.example/old.pdf',
          storedDocumentName: 'old.pdf',
          occurredAt: '2026-07-01T00:00:00Z',
        },
      }]);
    });

    const result = await ingestPrelimFromSoftPro({
      orderId: 1,
      fileNumber: '20012345-OCT',
      documentUrl: 'https://softpro.example/updated.pdf',
      storedDocumentName: 'Updated Prelim.pdf',
      occurredAt: new Date('2026-07-15T00:00:00Z'),
      source: 'softpro_webhook',
      createdBy: 'webhook:softpro',
      deliver: true,
      triggeredBy: 'softpro_webhook',
    });

    expect(result.outcome).toBe('ingested');
    if (result.outcome !== 'ingested') return;
    expect(result.isUpdate).toBe(true);
    expect(maybeAutoDeliverMock).toHaveBeenCalledTimes(1);
  });

  it('repeat of the same update is deduped — no re-delivery', async () => {
    const checksum = checksumBuffer(PDF);
    let call = 0;
    selectLimitMock.mockImplementation(() => {
      call++;
      if (call === 1) {
        return chainSelect([{
          id: 22,
          checksum,
          filename: 'Updated Prelim.pdf',
          originalFilename: 'Updated Prelim.pdf',
          createdAt: new Date('2026-07-15T00:00:00Z'),
        }]);
      }
      return chainSelect([{
        meta: {
          sourceUrl: 'https://softpro.example/updated.pdf',
          storedDocumentName: 'Updated Prelim.pdf',
        },
      }]);
    });

    const result = await ingestPrelimFromSoftPro({
      orderId: 1,
      fileNumber: '20012345-OCT',
      documentUrl: 'https://softpro.example/updated.pdf',
      storedDocumentName: 'Updated Prelim.pdf',
      occurredAt: new Date('2026-07-15T00:00:00Z'),
      source: 'softpro_webhook',
      createdBy: 'webhook:softpro',
      deliver: true,
      triggeredBy: 'softpro_webhook',
    });

    expect(result).toEqual(expect.objectContaining({ outcome: 'deduped', documentId: 22 }));
    expect(maybeAutoDeliverMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('SoftPro-origin document is never write-back eligible (isSyncedToSoftpro=true)', async () => {
    selectLimitMock.mockImplementation(() => chainSelect([]));

    await ingestPrelimFromSoftPro({
      orderId: 1,
      fileNumber: '20012345-OCT',
      documentUrl: 'https://softpro.example/x.pdf',
      source: 'softpro_fetch',
      createdBy: 'job:fetch_prelims',
      deliver: false,
      triggeredBy: 'fetch_prelims',
    });

    const inserted = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.isSyncedToSoftpro).toBe(true);
    expect(inserted.softproListingConfirmed).toBe(true);
    expect(maybeAutoDeliverMock).not.toHaveBeenCalled();
  });
});
