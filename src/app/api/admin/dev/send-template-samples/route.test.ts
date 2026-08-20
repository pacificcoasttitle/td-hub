import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, sendEmailMock, buildAllSampleEmailsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  sendEmailMock: vi.fn(),
  buildAllSampleEmailsMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/integrations/sendgrid/client', () => ({
  sendEmail: sendEmailMock,
}));

vi.mock('@/lib/domain/notifications/sample-templates', () => ({
  buildAllSampleEmails: buildAllSampleEmailsMock,
}));

import { POST } from './route';

const SAMPLE_KEYS = [
  'order_confirmation',
  'order_closed',
  'milestone_recording',
  'milestone_disbursement',
  'document_received_prelim',
  'document_received_policy',
  'prelim_delivery',
  'party_wizard_invite',
  'user_invite',
  'ops_daily_report',
] as const;

describe('POST /api/admin/dev/send-template-samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    buildAllSampleEmailsMock.mockReturnValue(
      SAMPLE_KEYS.map((key) => ({
        key,
        label: key,
        subject: `Subject for ${key}`,
        html: `<p>${key}</p>`,
        text: key.includes('prelim') || key.includes('party') || key.includes('ops')
          ? `text-${key}`
          : undefined,
      })),
    );
    sendEmailMock.mockImplementation(async ({ subject }: { subject: string }) => ({
      success: true,
      data: { messageId: `msg-${subject.replace(/\W+/g, '-').toLowerCase()}` },
    }));
  });

  it('sends one sample email for every notification template to Jerry', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(buildAllSampleEmailsMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledTimes(10);
    expect(sendEmailMock.mock.calls.map(([params]) => params.to)).toEqual(
      Array(10).fill('ghernandez@pct.com'),
    );
    expect(sendEmailMock.mock.calls.map(([params]) => params.subject)).toEqual(
      SAMPLE_KEYS.map((key) => `[SAMPLE] Subject for ${key}`),
    );
    expect(body.success).toBe(true);
    expect(body.count).toBe(10);
    expect(body.sent).toHaveLength(10);
    expect(body.sent.map((item: { key: string }) => item.key)).toEqual([...SAMPLE_KEYS]);
    expect(body.sent.every((item: { messageId?: string }) => item.messageId?.startsWith('msg-'))).toBe(true);
  });

  it('rejects non-admin sessions', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 'user-1', role: 'sales_rep' });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
