import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, sendEmailMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/integrations/sendgrid/client', () => ({
  sendEmail: sendEmailMock,
}));

vi.mock('@/lib/domain/notifications/templates', () => ({
  orderConfirmationTemplate: () => ({ subject: 'Open Order Confirmation - 20018881-OCT', html: '<p>confirmation</p>' }),
  orderClosedTemplate: () => ({ subject: 'Your Order 20018881-OCT has been closed', html: '<p>closed</p>' }),
  milestoneRecordingTemplate: () => ({
    subject: 'Recording confirmed for 20018881-OCT at 5792 Adobe Rd, Twentynine Palms, CA',
    html: '<p>recording</p>',
  }),
  milestoneDisbursementTemplate: () => ({ subject: 'Disbursement completed for 20018881-OCT', html: '<p>disbursement</p>' }),
  documentReceivedTemplate: () => ({ subject: 'New prelim document for Order 20018881-OCT', html: '<p>document</p>' }),
}));

vi.mock('@/lib/domain/notifications/prelim-delivery-send', () => ({
  prelimDeliverySampleTemplate: () => ({
    subject: 'Preliminary Title Report — 5792 Adobe Rd, Twentynine Palms, CA — File 20018881-OCT',
    html: '<p>prelim</p>',
    text: 'prelim',
  }),
}));

import { POST } from './route';

describe('POST /api/admin/dev/send-template-samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    sendEmailMock.mockImplementation(async ({ subject }: { subject: string }) => ({
      success: true,
      data: { messageId: `msg-${subject.replace(/\W+/g, '-').toLowerCase()}` },
    }));
  });

  it('sends one sample email for every notification template to Jerry', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(6);
    expect(sendEmailMock.mock.calls.map(([params]) => params.to)).toEqual([
      'ghernandez@pct.com',
      'ghernandez@pct.com',
      'ghernandez@pct.com',
      'ghernandez@pct.com',
      'ghernandez@pct.com',
      'ghernandez@pct.com',
    ]);
    expect(sendEmailMock.mock.calls.map(([params]) => params.subject)).toEqual([
      '[SAMPLE] Open Order Confirmation - 20018881-OCT',
      '[SAMPLE] Your Order 20018881-OCT has been closed',
      '[SAMPLE] Recording confirmed for 20018881-OCT at 5792 Adobe Rd, Twentynine Palms, CA',
      '[SAMPLE] Disbursement completed for 20018881-OCT',
      '[SAMPLE] New prelim document for Order 20018881-OCT',
      '[SAMPLE] Preliminary Title Report — 5792 Adobe Rd, Twentynine Palms, CA — File 20018881-OCT',
    ]);
    expect(body.success).toBe(true);
    expect(body.count).toBe(6);
    expect(body.sent).toHaveLength(6);
    expect(body.sent.every((item: { messageId?: string }) => item.messageId?.startsWith('msg-'))).toBe(true);
  });

  it('rejects non-admin sessions', async () => {
    getSessionMock.mockResolvedValueOnce({ id: 'user-1', role: 'sales_rep' });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
