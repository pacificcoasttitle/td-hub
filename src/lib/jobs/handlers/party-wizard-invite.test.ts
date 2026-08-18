import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The unreachable counter is the point of these tests ─────────────────────
//
// ~54% of orders have no escrow-officer email at day 3. The job must COUNT what
// it cannot reach, by reason, and never let an unreachable order look like a
// quiet success. These tests hold that line.

const candidatesMock = vi.fn();
const sendEmailMock = vi.fn();
const getSettingMock = vi.fn();
const findLiveLinkMock = vi.fn();
const mintLinkMock = vi.fn();
const insertLogMock = vi.fn();

vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'o.id', openedAt: 'o.opened_at', operationalStatus: 'o.status', fileNumber: 'o.file_number', transactionType: 'o.tx', escrowOfficerId: 'o.eo' },
  orderProperties: { orderId: 'op.order_id', fullAddress: 'op.full', address: 'op.addr', city: 'op.city', state: 'op.state', zip: 'op.zip' },
  orderParties: { orderId: 'p.order_id', role: 'p.role' },
  contacts: { id: 'c.id', fullName: 'c.full_name', email: 'c.email' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  isNull: (a: unknown) => a,
  sql: Object.assign((...a: unknown[]) => a, { raw: (s: string) => s }),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ limit: candidatesMock }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/integrations/sendgrid/client', () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
}));
vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...a: unknown[]) => getSettingMock(...a),
}));
vi.mock('@/lib/domain/notifications/dispatch', () => ({
  insertNotificationLog: (...a: unknown[]) => insertLogMock(...a),
}));
vi.mock('@/lib/domain/parties/party-wizard-service', () => ({
  findLiveLink: (...a: unknown[]) => findLiveLinkMock(...a),
  mintLinkForOrder: (...a: unknown[]) => mintLinkMock(...a),
}));

import {
  handlePartyWizardInvite, PARTY_INVITE_DELAY_DAYS, PARTY_INVITE_MAX_AGE_DAYS,
  PARTY_INVITE_STATUSES, PARTY_INVITE_SHUT_OFF_SETTING,
} from './party-wizard-invite';

function candidate(over: Record<string, unknown> = {}) {
  return {
    orderId: 1,
    fileNumber: '20020625-OCT',
    openedAt: new Date('2026-08-15T00:00:00Z'),
    transactionType: 'Purchase',
    fullAddress: '1 Main St, Irvine, CA',
    address: null, city: null, state: null, zip: null,
    escrowOfficerId: 7,
    escrowOfficerName: 'Liliana Arias',
    escrowOfficerEmail: 'officer@example.com',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettingMock.mockResolvedValue('false');
  findLiveLinkMock.mockResolvedValue(null);
  mintLinkMock.mockResolvedValue({ linkId: 1, url: 'https://hub.pctitle.com/party-wizard/tok' });
  sendEmailMock.mockResolvedValue({ success: true });
  insertLogMock.mockResolvedValue(1);
});

describe('party wizard invite', () => {
  it('fires 3 days after the order opens', () => {
    expect(PARTY_INVITE_DELAY_DAYS).toBe(3);
  });

  /**
   * Regression guard. The first cut scoped to operational_status = 'open',
   * which is 2 rows in production against 903 'in_process' in this job's own
   * window — so it scanned nothing and reported a clean all-zero result. Every
   * test here mocks the database, so none of them could catch it; this asserts
   * the status list directly instead.
   */
  it('targets in_process, not just open — the near-unused status', () => {
    expect(PARTY_INVITE_STATUSES).toContain('in_process');
    expect(PARTY_INVITE_STATUSES).toContain('open');
  });

  /**
   * Pilot bound. At 30 days the first run clears a 27-day backlog in one
   * morning (93 emails measured against production); at 7 it sends 11. Widen
   * only once real sends are confirmed to land and get forwarded.
   */
  it('ships with a narrow pilot window, not the full 30 days', () => {
    expect(PARTY_INVITE_MAX_AGE_DAYS).toBe(7);
    expect(PARTY_INVITE_MAX_AGE_DAYS).toBeGreaterThan(PARTY_INVITE_DELAY_DAYS);
  });

  it('does not chase agents on finished or abandoned files', () => {
    for (const dead of ['completed', 'closed', 'canceled', 'duplicate', 'hold']) {
      expect(PARTY_INVITE_STATUSES).not.toContain(dead);
    }
  });

  it('sends to a reachable escrow officer', async () => {
    candidatesMock.mockResolvedValue([candidate()]);
    const r = await handlePartyWizardInvite();
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(0);
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'officer@example.com' });
  });

  describe('counts what it cannot reach', () => {
    it('counts an order with NO escrow officer, and does not email', async () => {
      candidatesMock.mockResolvedValue([candidate({ escrowOfficerId: null, escrowOfficerEmail: null })]);
      const r = await handlePartyWizardInvite();
      expect(r.unreachable.noEscrowOfficer).toBe(1);
      expect(r.sent).toBe(0);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('counts an officer with no email SEPARATELY — a different problem to fix', async () => {
      candidatesMock.mockResolvedValue([candidate({ escrowOfficerEmail: null })]);
      const r = await handlePartyWizardInvite();
      expect(r.unreachable.escrowOfficerNoEmail).toBe(1);
      expect(r.unreachable.noEscrowOfficer).toBe(0);
      expect(r.sent).toBe(0);
    });

    it('treats a whitespace-only email as unreachable, not as a valid address', async () => {
      candidatesMock.mockResolvedValue([candidate({ escrowOfficerEmail: '   ' })]);
      const r = await handlePartyWizardInvite();
      expect(r.unreachable.escrowOfficerNoEmail).toBe(1);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('never mints a link for an order it cannot reach', async () => {
      candidatesMock.mockResolvedValue([candidate({ escrowOfficerId: null })]);
      await handlePartyWizardInvite();
      expect(mintLinkMock).not.toHaveBeenCalled();
    });

    it('reports the reachable percentage — the number to watch weekly', async () => {
      candidatesMock.mockResolvedValue([
        candidate({ orderId: 1 }),
        candidate({ orderId: 2 }),
        candidate({ orderId: 3, escrowOfficerId: null }),
        candidate({ orderId: 4, escrowOfficerEmail: null }),
      ]);
      const r = await handlePartyWizardInvite();
      expect(r.scanned).toBe(4);
      expect(r.sent).toBe(2);
      expect(r.unreachable).toEqual({ noEscrowOfficer: 1, escrowOfficerNoEmail: 1 });
      expect(r.reachablePct).toBe(50);
    });

    it('every scanned order lands in exactly one bucket — nothing vanishes', async () => {
      candidatesMock.mockResolvedValue([
        candidate({ orderId: 1 }),
        candidate({ orderId: 2, escrowOfficerId: null }),
        candidate({ orderId: 3, escrowOfficerEmail: null }),
        candidate({ orderId: 4 }),
      ]);
      findLiveLinkMock.mockImplementation(async (orderId: number) => (orderId === 4 ? { id: 9 } : null));

      const r = await handlePartyWizardInvite();
      const accounted = r.sent + r.failed + r.skippedExistingLink
        + r.unreachable.noEscrowOfficer + r.unreachable.escrowOfficerNoEmail;
      expect(accounted).toBe(r.scanned);
    });

    it('reports 0% rather than dividing by zero when nothing is scanned', async () => {
      candidatesMock.mockResolvedValue([]);
      const r = await handlePartyWizardInvite();
      expect(r.reachablePct).toBe(0);
      expect(r.scanned).toBe(0);
    });
  });

  it('skips an order that already has a live link instead of sending twice', async () => {
    candidatesMock.mockResolvedValue([candidate()]);
    findLiveLinkMock.mockResolvedValue({ id: 42 });
    const r = await handlePartyWizardInvite();
    expect(r.skippedExistingLink).toBe(1);
    expect(r.sent).toBe(0);
    expect(mintLinkMock).not.toHaveBeenCalled();
  });

  it('counts a send failure as failed, not as unreachable', async () => {
    candidatesMock.mockResolvedValue([candidate()]);
    sendEmailMock.mockResolvedValue({ success: false, error: { message: 'SendGrid 500' } });
    const r = await handlePartyWizardInvite();
    expect(r.failed).toBe(1);
    expect(r.unreachable.noEscrowOfficer).toBe(0);
    expect(insertLogMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('logs the send so the same order is not emailed again tomorrow', async () => {
    candidatesMock.mockResolvedValue([candidate()]);
    await handlePartyWizardInvite();
    expect(insertLogMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'party_wizard.invite',
      orderId: 1,
      status: 'sent',
      recipientRole: 'escrow_officer',
    }));
  });

  it('does nothing at all when the kill switch is on', async () => {
    getSettingMock.mockResolvedValue('true');
    candidatesMock.mockResolvedValue([candidate()]);
    const r = await handlePartyWizardInvite();
    expect(r.shutOff).toBe(true);
    expect(r.sent).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(getSettingMock).toHaveBeenCalledWith(PARTY_INVITE_SHUT_OFF_SETTING);
  });

  it('one bad order does not abort the rest of the batch', async () => {
    candidatesMock.mockResolvedValue([candidate({ orderId: 1 }), candidate({ orderId: 2 })]);
    sendEmailMock.mockRejectedValueOnce(new Error('network'));
    const r = await handlePartyWizardInvite();
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(1);
  });
});
