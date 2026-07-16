import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const {
  handlePrelimWebhookMock,
  insertValuesMock,
  logRejectionMock,
  unauthorizedResponseMock,
  verifyMock,
  warnMock,
} = vi.hoisted(() => ({
  handlePrelimWebhookMock: vi.fn(),
  insertValuesMock: vi.fn(),
  logRejectionMock: vi.fn(),
  unauthorizedResponseMock: vi.fn((reason: string) =>
    NextResponse.json({ error: reason }, { status: 401 }),
  ),
  verifyMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('@/lib/security/softpro-webhook-auth', () => ({
  verifySoftProWebhookRequest: verifyMock,
  logSoftProWebhookRejection: logRejectionMock,
  softProWebhookUnauthorizedResponse: unauthorizedResponseMock,
}));

vi.mock('@/lib/domain/webhooks/softpro-handler', () => ({
  prelimPayloadSchema: {
    safeParse: (body: unknown) => ({ success: true as const, data: body }),
  },
  handlePrelimWebhook: handlePrelimWebhookMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn(() => ({ values: insertValuesMock })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  vendorApiLogs: {},
}));

import { POST } from './route';

const BODY = JSON.stringify({
  OrderNumber: '20012345-OCT',
  data: ['https://example.com/prelim.pdf'],
});

function request(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/webhooks/softpro/prelim', {
    method: 'POST',
    body: BODY,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('POST /api/webhooks/softpro/prelim signature gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    insertValuesMock.mockResolvedValue(undefined);
    handlePrelimWebhookMock.mockResolvedValue({ success: true, processed: 1, errors: [] });
    unauthorizedResponseMock.mockImplementation((reason: string) =>
      NextResponse.json({ error: reason }, { status: 401 }),
    );
    vi.spyOn(console, 'warn').mockImplementation(warnMock);
  });

  it('returns 401 when signature is missing', async () => {
    verifyMock.mockReturnValue({ ok: false, reason: 'missing_signature' });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(handlePrelimWebhookMock).not.toHaveBeenCalled();
    expect(logRejectionMock).toHaveBeenCalledWith(
      '/api/webhooks/softpro/prelim',
      'missing_signature',
    );
  });

  it('returns 401 when signature is invalid', async () => {
    verifyMock.mockReturnValue({ ok: false, reason: 'invalid_signature' });

    const response = await POST(request({
      'x-softpro-signature': 'sha256=deadbeef',
    }));

    expect(response.status).toBe(401);
    expect(handlePrelimWebhookMock).not.toHaveBeenCalled();
    expect(logRejectionMock).toHaveBeenCalledWith(
      '/api/webhooks/softpro/prelim',
      'invalid_signature',
    );
  });

  it('processes the webhook when signature verification passes', async () => {
    verifyMock.mockReturnValue({ ok: true });

    const response = await POST(request({
      authorization: 'Bearer test-secret',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(verifyMock).toHaveBeenCalled();
    expect(handlePrelimWebhookMock).toHaveBeenCalledTimes(1);
  });
});
