import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  handlePolicyWebhookMock,
  insertValuesMock,
  logRejectionMock,
  unauthorizedResponseMock,
  verifyMock,
} = vi.hoisted(() => ({
  handlePolicyWebhookMock: vi.fn(),
  insertValuesMock: vi.fn(),
  logRejectionMock: vi.fn(),
  unauthorizedResponseMock: vi.fn((reason: string) =>
    NextResponse.json({ error: reason }, { status: 401 }),
  ),
  verifyMock: vi.fn(),
}));

vi.mock('@/lib/security/softpro-webhook-auth', () => ({
  verifySoftProWebhookRequest: verifyMock,
  logSoftProWebhookRejection: logRejectionMock,
  softProWebhookUnauthorizedResponse: unauthorizedResponseMock,
}));

vi.mock('@/lib/domain/webhooks/softpro-handler', () => ({
  policyPayloadSchema: {
    safeParse: (body: unknown) => ({ success: true as const, data: body }),
  },
  handlePolicyWebhook: handlePolicyWebhookMock,
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
  data: [{ FileName: 'policy.pdf', FileUrl: 'https://example.com/policy.pdf' }],
});

describe('POST /api/webhooks/softpro/policy signature gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    insertValuesMock.mockResolvedValue(undefined);
    handlePolicyWebhookMock.mockResolvedValue({ success: true, processed: 1, errors: [] });
    unauthorizedResponseMock.mockImplementation((reason: string) =>
      NextResponse.json({ error: reason }, { status: 401 }),
    );
  });

  it('rejects invalid signature with 401', async () => {
    verifyMock.mockReturnValue({ ok: false, reason: 'invalid_signature' });

    const req = new NextRequest('http://localhost/api/webhooks/softpro/policy', {
      method: 'POST',
      body: BODY,
      headers: {
        'content-type': 'application/json',
        'x-softpro-signature': 'sha256=deadbeef',
      },
    });
    const response = await POST(req);

    expect(response.status).toBe(401);
    expect(handlePolicyWebhookMock).not.toHaveBeenCalled();
  });

  it('accepts a valid signature', async () => {
    verifyMock.mockReturnValue({ ok: true });

    const req = new NextRequest('http://localhost/api/webhooks/softpro/policy', {
      method: 'POST',
      body: BODY,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(handlePolicyWebhookMock).toHaveBeenCalledTimes(1);
  });
});
