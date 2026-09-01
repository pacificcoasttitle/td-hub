import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSignedUrlMock = vi.fn();
const softproUploadMock = vi.fn();
const getAttachedMock = vi.fn();
const selectLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(),
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
  downloadFile: vi.fn(),
}));

vi.mock('@/lib/integrations/softpro/client', () => ({
  uploadDocument: (...args: unknown[]) => softproUploadMock(...args),
  getAttachedDocuments: (...args: unknown[]) => getAttachedMock(...args),
}));

vi.mock('./softpro-fetch-token', () => ({
  buildSoftProFetchUrl: (documentId: number, filename: string) =>
    `https://hub.pctitle.com/api/softpro/fetch-doc/${documentId}/9999999999/testsigabcdefghijklmn/${filename}`,
}));

const docRow = {
  id: 42,
  orderId: 7,
  category: 'cpl' as const,
  filename: 'westcor_20015761-GLT_1.pdf',
  status: 'active' as const,
  storageKey: 'cpl/westcor_20015761-GLT_1.pdf',
  isSyncedToSoftpro: false,
  softproDocumentId: null,
  softproAttachAttemptCount: 0,
  softproSyncError: null,
};

function mockSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const whereResult = {
    limit,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const where = vi.fn(() => whereResult);
  const from = vi.fn(() => ({ where, limit, orderBy: vi.fn(() => Promise.resolve(rows)) }));
  return { from, where, limit };
}

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => selectLimitMock()),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return { where: (...wArgs: unknown[]) => {
          updateWhereMock(...wArgs);
          return Promise.resolve();
        } };
      },
    })),
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValuesMock(...args);
        return Promise.resolve();
      },
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  documents: {
    id: 'documents.id',
    orderId: 'documents.order_id',
    category: { enumValues: ['cpl', 'grant_deed', 'tax'] },
    status: 'documents.status',
    createdAt: 'documents.created_at',
    isSyncedToSoftpro: 'documents.is_synced',
    softproListingConfirmed: 'documents.softpro_listing_confirmed',
    softproAttachAttemptCount: 'documents.softpro_attach_attempt_count',
    softproAttachNextRetryAt: 'documents.softpro_attach_next_retry_at',
  },
  documentAudit: {},
  orders: { id: 'orders.id', fileNumber: 'orders.file_number' },
  titlePointData: { orderId: 'tp.order_id', status: 'tp.status', searchType: 'tp.search_type' },
  vendorApiLogs: {},
  documentRequests: {},
  eventOutbox: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
}));

describe('attachToSoftPro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOFTPRO_DOC_FETCH_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';

    // getDocumentById then order lookup
    selectLimitMock
      .mockReturnValueOnce(mockSelectChain([docRow]))
      .mockReturnValueOnce(mockSelectChain([{ id: 7, fileNumber: '20015761-GLT' }]));
  });

  it('200 + empty list → accepted, not listing-confirmed', async () => {
    softproUploadMock.mockResolvedValue({
      success: true,
      requestId: 'req-1',
      data: [{ Status: 200, FileUploadedStatus: true, Id: 'SP-99', Message: 'ok' }],
    });
    getAttachedMock.mockResolvedValue({ success: true, data: [] });

    const { attachToSoftPro } = await import('./service');
    const result = await attachToSoftPro(42, 'CPL');

    expect(result).toEqual({ success: true, softproDocumentId: 'SP-99' });
    expect(softproUploadMock).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 42,
      orderId: 7,
      orderNumber: '20015761-GLT',
      documentName: 'cpl-42.pdf',
      folderName: 'CPL',
      fileUrl: expect.stringMatching(/\/api\/softpro\/fetch-doc\/42\/.*\/cpl-42\.pdf$/),
    }));
    expect(getAttachedMock).toHaveBeenCalledWith('20015761-GLT');
    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: true,
      softproListingConfirmed: false,
      softproDocumentId: 'SP-99',
      softproSyncError: null,
      softproAttachNextRetryAt: null,
    }));
  });

  it('200 + name on listing → confirmed', async () => {
    softproUploadMock.mockResolvedValue({
      success: true,
      requestId: 'req-listed',
      data: [{ Status: 200, FileUploadedStatus: true, Id: 'SP-99', Message: 'ok' }],
    });
    getAttachedMock.mockResolvedValue({
      success: true,
      data: ['https://softpro.example/files/cpl-42.pdf'],
    });

    const { attachToSoftPro } = await import('./service');
    const result = await attachToSoftPro(42, 'CPL');

    expect(result.success).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: true,
      softproListingConfirmed: true,
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'attached_to_softpro',
      meta: expect.objectContaining({ acceptSource: 'listed', verifyState: 'confirmed' }),
    }));
  });

  it('already-exists + empty list → accepted, not failed', async () => {
    softproUploadMock.mockResolvedValue({
      success: false,
      requestId: 'req-exists',
      error: { message: 'An item already exists by that name.', code: 'SOFTPRO', vendor: 'softpro', retryable: false },
    });
    getAttachedMock.mockResolvedValue({ success: true, data: [] });

    const { attachToSoftPro } = await import('./service');
    const result = await attachToSoftPro(42, 'CPL');

    expect(result.success).toBe(true);
    expect(getAttachedMock).toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: true,
      softproListingConfirmed: false,
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'attached_to_softpro',
      meta: expect.objectContaining({ acceptSource: 'already_exists', verifyState: 'accepted' }),
    }));
  });

  it('records failure + attempt count without throwing (user op unaffected)', async () => {
    softproUploadMock.mockResolvedValue({
      success: false,
      requestId: 'req-2',
      error: { message: 'path too long', code: 'SOFTPRO', vendor: 'softpro', retryable: false },
    });

    // failure path re-reads the doc for attempt count
    selectLimitMock
      .mockReset()
      .mockReturnValueOnce(mockSelectChain([docRow]))
      .mockReturnValueOnce(mockSelectChain([{ id: 7, fileNumber: '20015761-GLT' }]))
      .mockReturnValueOnce(mockSelectChain([docRow]));

    const { attachToSoftPro } = await import('./service');
    const result = await attachToSoftPro(42, 'CPL');

    expect(result.success).toBe(false);
    expect(result.error).toContain('path too long');
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: false,
      softproSyncError: expect.stringContaining('path too long'),
      softproAttachAttemptCount: 1,
      softproAttachNextRetryAt: expect.any(Date),
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'attach_failed',
    }));
  });
});

describe('softProAttachNextRetryAt / extractSoftProDocumentId', () => {
  it('caps retries and extracts SoftPro Id from array envelope', async () => {
    const {
      softProAttachNextRetryAt,
      extractSoftProDocumentId,
      SOFTPRO_ATTACH_MAX_ATTEMPTS,
    } = await import('./softpro-attach-retry');

    expect(softProAttachNextRetryAt(SOFTPRO_ATTACH_MAX_ATTEMPTS)).toBeNull();
    expect(softProAttachNextRetryAt(1)).toBeInstanceOf(Date);
    const { softProAlreadyExistsByName } = await import('./softpro-attach-retry');
    expect(softProAlreadyExistsByName('An item already exists by that name.')).toBe(true);
    expect(softProAlreadyExistsByName('Property Address is required.')).toBe(false);
    expect(extractSoftProDocumentId([{ Id: 'ABC' }], 1)).toBe('ABC');
    expect(extractSoftProDocumentId([], 42)).toBe('42');
  });
});

const vestRow = {
  id: 5744,
  orderId: 8123,
  category: 'legal_vesting' as const,
  filename: 'tp_vest.pdf',
  status: 'active' as const,
  storageKey: 'legal_vesting/tp_vest.pdf',
  isSyncedToSoftpro: false,
  softproDocumentId: null,
  softproAttachAttemptCount: 0,
  softproSyncError: null,
};

function queueTitleDocSelects() {
  selectLimitMock
    .mockReturnValueOnce(mockSelectChain([{ id: 8123, fileNumber: '20021642-OCT' }]))
    .mockReturnValueOnce(mockSelectChain([vestRow]))
    .mockReturnValueOnce(mockSelectChain([vestRow]));
}

describe('attachTitleDocsToSoftPro verify states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOFTPRO_DOC_FETCH_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';
    queueTitleDocSelects();
  });

  it('200 + empty list → accepted, no retry', async () => {
    softproUploadMock.mockResolvedValue({
      success: true,
      requestId: 'req-200',
      data: [{ Status: 200, FileUploadedStatus: true, Id: 'SP-1', Message: 'Success' }],
    });
    getAttachedMock.mockResolvedValue({ success: true, data: [] });

    const { attachTitleDocsToSoftPro } = await import('./service');
    const result = await attachTitleDocsToSoftPro(8123);

    expect(result.success).toBe(true);
    expect(result.attached).toBe(0);
    expect(getAttachedMock).toHaveBeenCalledWith('20021642-OCT');
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: true,
      softproListingConfirmed: false,
      softproAttachNextRetryAt: null,
    }));
    expect(updateSetMock).not.toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: false,
    }));
  });

  it('already-exists → accepted, higher confidence, no retry', async () => {
    softproUploadMock.mockResolvedValue({
      success: false,
      requestId: 'req-exists',
      error: { message: 'An item already exists by that name.', code: 'SOFTPRO', vendor: 'softpro', retryable: false },
    });
    getAttachedMock.mockResolvedValue({ success: true, data: [] });

    const { attachTitleDocsToSoftPro } = await import('./service');
    const result = await attachTitleDocsToSoftPro(8123);

    expect(result.success).toBe(true);
    expect(getAttachedMock).toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: true,
      softproListingConfirmed: false,
      softproAttachNextRetryAt: null,
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'attached_to_softpro',
      meta: expect.objectContaining({ acceptSource: 'already_exists', verifyState: 'accepted' }),
    }));
  });

  it('address 400 → failed, not accepted', async () => {
    softproUploadMock.mockResolvedValue({
      success: false,
      requestId: 'req-addr',
      error: { message: 'Property Address is required.', code: 'SOFTPRO', vendor: 'softpro', retryable: false },
    });

    selectLimitMock
      .mockReset()
      .mockReturnValueOnce(mockSelectChain([{ id: 8123, fileNumber: '20021642-OCT' }]))
      .mockReturnValueOnce(mockSelectChain([vestRow]))
      .mockReturnValueOnce(mockSelectChain([vestRow]));

    const { attachTitleDocsToSoftPro } = await import('./service');
    const result = await attachTitleDocsToSoftPro(8123);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Property Address is required');
    expect(getAttachedMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: false,
      softproSyncError: expect.stringContaining('Property Address is required'),
    }));
  });

  it('listed names → confirmed', async () => {
    softproUploadMock.mockResolvedValue({
      success: true,
      requestId: 'req-listed',
      data: [{ Status: 200, FileUploadedStatus: true, Id: 'SP-9', Message: 'Success' }],
    });
    getAttachedMock.mockResolvedValue({
      success: true,
      data: ['https://softpro.example/files/vest-5744.pdf'],
    });

    const { attachTitleDocsToSoftPro } = await import('./service');
    const result = await attachTitleDocsToSoftPro(8123);

    expect(result.success).toBe(true);
    expect(result.attached).toBe(1);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      isSyncedToSoftpro: true,
      softproListingConfirmed: true,
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'attached_to_softpro',
      meta: expect.objectContaining({ acceptSource: 'listed', verifyState: 'confirmed' }),
    }));
  });
});
