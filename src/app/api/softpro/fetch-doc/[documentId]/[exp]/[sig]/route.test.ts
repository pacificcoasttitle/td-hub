import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDocumentByIdMock = vi.fn();
const downloadFileMock = vi.fn();

vi.mock('@/lib/domain/documents/service', () => ({
  getDocumentById: (...args: unknown[]) => getDocumentByIdMock(...args),
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  downloadFile: (...args: unknown[]) => downloadFileMock(...args),
}));

const ENV_KEYS = [
  'SOFTPRO_DOC_FETCH_SECRET',
  'SOFTPRO_WEBHOOK_SECRET',
  'JOB_RUNNER_SECRET',
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe('GET /api/softpro/fetch-doc', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    getDocumentByIdMock.mockReset();
    downloadFileMock.mockReset();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects when dedicated and JOB_RUNNER secrets are missing (webhook alone does not open the door)', async () => {
    process.env.SOFTPRO_WEBHOOK_SECRET = 'webhook-only';

    const { GET } = await import('./route');
    const res = await GET(
      new Request('https://hub.pctitle.com/api/softpro/fetch-doc/1/9999999999/ffffffffffffffffffffff') as never,
      { params: Promise.resolve({ documentId: '1', exp: '9999999999', sig: 'ffffffffffffffffffffff' }) },
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Server misconfigured' });
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  it('rejects when no signing secret is configured at all', async () => {
    const { GET } = await import('./route');
    const res = await GET(
      new Request('https://hub.pctitle.com/api/softpro/fetch-doc/1/9999999999/ffffffffffffffffffffff') as never,
      { params: Promise.resolve({ documentId: '1', exp: '9999999999', sig: 'ffffffffffffffffffffff' }) },
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Server misconfigured' });
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });
});
