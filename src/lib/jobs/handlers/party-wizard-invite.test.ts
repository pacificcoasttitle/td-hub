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
  jobs: { id: 'j.id' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  isNull: (a: unknown) => a,
  sql: Object.assign((...a: unknown[]) => a, { raw: (s: string) => s }),
}));

const jobUpdates: Array<Record<string, unknown>> = [];

const executeMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: (...a: unknown[]) => executeMock(...a),
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ limit: candidatesMock }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        jobUpdates.push(values);
        return { where: async () => undefined };
      },
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
  PARTY_INVITE_STATUSES, PARTY_INVITE_ENABLED_SETTING, PARTY_INVITE_MAX_PER_RECIPIENT,
} from './party-wizard-invite';

function candidate(over: Record<string, unknown> = {}) {
  const row = {
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
  // Distinct address per order unless a test pins one. Asks are deduped by
  // property, so fixtures sharing one address would collapse into a single send
  // and quietly change what the surrounding test is measuring.
  if (!('fullAddress' in over)) row.fullAddress = `${row.orderId} Main St, Irvine, CA`;
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  jobUpdates.length = 0;
  // Sending is opt-in, so every test that expects a send has to turn it on.
  getSettingMock.mockResolvedValue('true');
  // No property has been invited before, unless a test says otherwise.
  executeMock.mockResolvedValue([]);
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
        + r.skippedDuplicateProperty + r.skippedRecipientCap
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

  it('one bad order does not abort the rest of the batch', async () => {
    candidatesMock.mockResolvedValue([candidate({ orderId: 1 }), candidate({ orderId: 2 })]);
    sendEmailMock.mockRejectedValueOnce(new Error('network'));
    const r = await handlePartyWizardInvite();
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(1);
  });
});

// ─── One ask per property ────────────────────────────────────────────────────
//
// Production sent 20021227-OCT and -PRV in one run: both 8613 Bonita Rd, same
// escrow officer, same listing agent. Two files is a SoftPro distinction; from an
// inbox it is the same ask twice.

describe('one ask per property, not per file', () => {
  const bonita = { fullAddress: '8613 BONITA RD' };

  it('asks once when two files share a property', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fileNumber: '20021227-OCT', ...bonita }),
      candidate({ orderId: 2, fileNumber: '20021227-PRV', ...bonita }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(1);
    expect(r.skippedDuplicateProperty).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(mintLinkMock).toHaveBeenCalledOnce();
  });

  it('names the file that carries the ask, so the skip is explainable', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fileNumber: '20021227-OCT', ...bonita }),
      candidate({ orderId: 2, fileNumber: '20021227-PRV', ...bonita }),
    ]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report![0]).toMatchObject({ fileNumber: '20021227-OCT', outcome: 'would_send' });
    expect(r.report![1]).toMatchObject({
      fileNumber: '20021227-PRV',
      outcome: 'skipped_duplicate_property',
      duplicateOf: '20021227-OCT',
    });
  });

  it('picks the same file every run — lowest order id, not database order', async () => {
    const rows = [
      candidate({ orderId: 9, fileNumber: 'LATER', ...bonita }),
      candidate({ orderId: 4, fileNumber: 'EARLIER', ...bonita }),
    ];
    candidatesMock.mockResolvedValue(rows);
    const first = await handlePartyWizardInvite({ dryRun: true });

    candidatesMock.mockResolvedValue([...rows].reverse());
    const second = await handlePartyWizardInvite({ dryRun: true });

    expect(first.sampleEmail!.fileNumber).toBe('EARLIER');
    expect(second.sampleEmail!.fileNumber).toBe('EARLIER');
  });

  it('does not ask again when an earlier run already asked for that property', async () => {
    executeMock.mockResolvedValue([
      { full_address: '8613 Bonita Rd', address: null, city: null, state: null, zip: null },
    ]);
    candidatesMock.mockResolvedValue([candidate({ orderId: 1, ...bonita })]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(0);
    expect(r.skippedDuplicateProperty).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('matches addresses across punctuation and case, which production varies', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fullAddress: '127 Avenida De La Paz,, San Clemente, CA, 92672' }),
      candidate({ orderId: 2, fullAddress: '127 AVENIDA DE LA PAZ, SAN CLEMENTE CA 92672' }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(1);
    expect(r.skippedDuplicateProperty).toBe(1);
  });

  it('treats adjacent properties as separate asks — they are different files AND different homes', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fullAddress: '127 Avenida De La Paz, San Clemente, CA' }),
      candidate({ orderId: 2, fullAddress: '129 Avenida De La Paz, San Clemente, CA' }),
    ]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report!.every(row => row.outcome === 'would_send')).toBe(true);
  });

  /**
   * Two orders with no address are not evidence of the same property. Grouping
   * them would suppress a real ask, which is worse than one redundant email.
   */
  it('never groups orders that have no address', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fullAddress: null }),
      candidate({ orderId: 2, fullAddress: null }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(2);
    expect(r.skippedDuplicateProperty).toBe(0);
  });

  it('keeps sending when the invite history cannot be read', async () => {
    executeMock.mockRejectedValue(new Error('pg down'));
    candidatesMock.mockResolvedValue([candidate()]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(1);
  });
});

// ─── Per-recipient cap ───────────────────────────────────────────────────────
//
// One officer received 12 of 21 invites in a single run, four of them adjacent
// files. Someone who thinks the system is malfunctioning does not forward the
// link, which is the only thing this job is for.

describe('caps how many emails one person gets per run', () => {
  function forOneOfficer(count: number) {
    return Array.from({ length: count }, (_, i) => candidate({
      orderId: i + 1,
      fileNumber: `FILE-${i + 1}`,
      escrowOfficerEmail: 'cquintanar@example.com',
    }));
  }

  it('sends at most two to the same recipient', async () => {
    candidatesMock.mockResolvedValue(forOneOfficer(12));

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(PARTY_INVITE_MAX_PER_RECIPIENT);
    expect(r.sent).toBe(2);
    expect(r.skippedRecipientCap).toBe(10);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it('holds the rest rather than dropping them', async () => {
    candidatesMock.mockResolvedValue(forOneOfficer(5));

    const r = await handlePartyWizardInvite({ dryRun: true });

    const held = r.report!.filter(row => row.outcome === 'skipped_recipient_cap');
    expect(held).toHaveLength(3);
    // Held rows mint nothing and log nothing, so they are candidates again
    // tomorrow. That is what makes this a rate limit and not a silent drop.
    expect(mintLinkMock).not.toHaveBeenCalled();
    expect(insertLogMock).not.toHaveBeenCalled();
  });

  it('counts per recipient, not per run — a second officer is unaffected', async () => {
    candidatesMock.mockResolvedValue([
      ...forOneOfficer(3),
      candidate({ orderId: 10, escrowOfficerEmail: 'other@example.com' }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(3);
    expect(r.skippedRecipientCap).toBe(1);
    const recipients = sendEmailMock.mock.calls.map(c => (c[0] as { to: string }).to);
    expect(recipients).toContain('other@example.com');
  });

  /**
   * A duplicate is not an ask, so it must not consume a slot — otherwise the cap
   * would suppress a real ask in order to spare a redundant one.
   */
  it('does not spend a slot on a duplicate property', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fileNumber: 'A-OCT', fullAddress: '8613 BONITA RD' }),
      candidate({ orderId: 2, fileNumber: 'A-PRV', fullAddress: '8613 BONITA RD' }),
      candidate({ orderId: 3, fileNumber: 'B', fullAddress: '52 CARROLL DR' }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(2);
    expect(r.skippedDuplicateProperty).toBe(1);
    expect(r.skippedRecipientCap).toBe(0);
  });
});

// ─── Off unless someone said yes ─────────────────────────────────────────────
//
// This was a shut-off flag defaulting to false: a running job with a brake. A
// fresh environment, a wiped settings row or a restored backup resumed emailing
// people outside PCT with nobody deciding to. The absence of a row now means
// silence.

describe('sending is opt-in, not opt-out', () => {
  it('refuses to send when the switch has never been set', async () => {
    getSettingMock.mockResolvedValue(null);
    candidatesMock.mockResolvedValue([candidate()]);

    const r = await handlePartyWizardInvite();

    expect(r.refused).toBe(true);
    expect(r.enabled).toBe(false);
    expect(r.sent).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(mintLinkMock).not.toHaveBeenCalled();
    // Refusing must not even look at the candidate list.
    expect(candidatesMock).not.toHaveBeenCalled();
    expect(getSettingMock).toHaveBeenCalledWith(PARTY_INVITE_ENABLED_SETTING);
  });

  it('refuses on an explicit false, not just on a missing row', async () => {
    getSettingMock.mockResolvedValue('false');
    const r = await handlePartyWizardInvite();
    expect(r.refused).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('treats anything other than the exact string "true" as off', async () => {
    for (const value of ['TRUE', '1', 'yes', 'on', '']) {
      vi.clearAllMocks();
      getSettingMock.mockResolvedValue(value);
      const r = await handlePartyWizardInvite();
      expect(r.refused, `value ${JSON.stringify(value)} must not enable sending`).toBe(true);
    }
  });

  /**
   * A refusal has to leave a trace. Without it the run ends `completed` with no
   * reason, which reads exactly like a run that found nothing to do — the
   * failure mode that let this sit unnoticed in the first place.
   */
  it('records the refusal on its own job row', async () => {
    getSettingMock.mockResolvedValue('false');
    await handlePartyWizardInvite({ __jobId: 77 });

    expect(jobUpdates).toHaveLength(1);
    const payload = jobUpdates[0]!.payload as { partyWizardInvite: { refused: boolean; enabled: boolean } };
    expect(payload.partyWizardInvite.refused).toBe(true);
    expect(payload.partyWizardInvite.enabled).toBe(false);
  });

  it('sends normally once someone has enabled it', async () => {
    getSettingMock.mockResolvedValue('true');
    candidatesMock.mockResolvedValue([candidate()]);

    const r = await handlePartyWizardInvite();

    expect(r.refused).toBeUndefined();
    expect(r.enabled).toBe(true);
    expect(r.sent).toBe(1);
  });
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

describe('dry run reports instead of sending', () => {
  it('writes nothing and sends nothing', async () => {
    candidatesMock.mockResolvedValue([candidate()]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(mintLinkMock).not.toHaveBeenCalled();
    expect(insertLogMock).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
  });

  /**
   * The whole point is to read the recipient list BEFORE turning sending on, so
   * the switch must not gate the preview.
   */
  it('runs while sending is switched off', async () => {
    getSettingMock.mockResolvedValue('false');
    candidatesMock.mockResolvedValue([candidate()]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.refused).toBeUndefined();
    expect(r.enabled).toBe(false);
    expect(r.report).toHaveLength(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('reports the resolved recipient address, not a count', async () => {
    candidatesMock.mockResolvedValue([candidate()]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report![0]).toMatchObject({
      fileNumber: '20020625-OCT',
      recipientEmail: 'officer@example.com',
      recipientName: 'Liliana Arias',
      recipientRole: 'escrow_officer',
      outcome: 'would_send',
      linkRoles: ['listing_agent'],
      linkAction: 'would_mint',
    });
    expect(r.report![0]!.subject).toBeTruthy();
  });

  it('reports every candidate, including the ones it could not reach', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1 }),
      candidate({ orderId: 2, escrowOfficerId: null, escrowOfficerEmail: null }),
      candidate({ orderId: 3, escrowOfficerEmail: null }),
      candidate({ orderId: 4 }),
    ]);
    findLiveLinkMock.mockImplementation(async (orderId: number) => (orderId === 4 ? { id: 9 } : null));

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report).toHaveLength(4);
    expect(r.report!.map(row => row.outcome)).toEqual([
      'would_send', 'no_escrow_officer', 'officer_no_email', 'skipped_existing_link',
    ]);
    expect(r.scanned).toBe(4);
  });

  /**
   * Copy gets approved from this. Rendering the templates and throwing the bodies
   * away meant approving a draft rather than the output a real order produces.
   */
  it('keeps ONE fully rendered body, not just subjects', async () => {
    candidatesMock.mockResolvedValue([candidate({ orderId: 1 }), candidate({ orderId: 2 })]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.sampleEmail).toBeDefined();
    const sample = r.sampleEmail!;
    // A real order, a real recipient, the real subject line.
    expect(sample.orderId).toBe(1);
    expect(sample.fileNumber).toBe('20020625-OCT');
    expect(sample.to).toBe('officer@example.com');
    expect(sample.subject).toBe(r.report![0]!.subject);
    // Whole bodies, not fragments.
    expect(sample.html).toContain('<html');
    expect(sample.html).toContain('20020625-OCT');
    expect(sample.text).toContain('20020625-OCT');
    // Only the link is stand-in, and it says so.
    expect(sample.html).toContain(sample.linkPlaceholder);
    expect(sample.linkPlaceholder).toContain('DRY-RUN-NO-LINK-MINTED');
  });

  it('keeps exactly one body however many orders it scans', async () => {
    candidatesMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => candidate({ orderId: i + 1 })),
    );

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report).toHaveLength(5);
    expect(r.sampleEmail!.orderId).toBe(1);
  });

  it('has no body to show when nothing would send', async () => {
    candidatesMock.mockResolvedValue([candidate({ escrowOfficerId: null })]);
    const r = await handlePartyWizardInvite({ dryRun: true });
    expect(r.sampleEmail).toBeUndefined();
  });

  it('keeps the rendered body out of the job payload', async () => {
    candidatesMock.mockResolvedValue([candidate()]);
    await handlePartyWizardInvite({ dryRun: true, __jobId: 12 });
    const payload = jobUpdates[0]!.payload as { partyWizardInvite: Record<string, unknown> };
    expect(payload.partyWizardInvite.sampleEmail).toBeUndefined();
    expect(payload.partyWizardInvite.report).toBeUndefined();
    expect(payload.partyWizardInvite.scanned).toBe(1);
  });

  it('says why it cannot show link URLs rather than leaving them blank', async () => {
    candidatesMock.mockResolvedValue([candidate()]);
    const r = await handlePartyWizardInvite({ dryRun: true });
    expect(r.reportNote).toMatch(/minting a link is a write/i);
  });

  /**
   * Found by this test: an unusable opened_at threw out of the report builder and
   * took the whole dry run with it. One unreadable order must cost the operator
   * that row, not the other ninety-nine.
   */
  it('reports an order with an unusable date instead of aborting the run', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, openedAt: new Date('nonsense') }),
      candidate({ orderId: 2 }),
    ]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report).toHaveLength(2);
    expect(r.report![0]).toMatchObject({ orderId: 1, openedAt: null, ageDays: null });
    expect(r.report![1]).toMatchObject({ orderId: 2, outcome: 'would_send' });
    // Either the template rendered or it said why — never a silent blank.
    const first = r.report![0]!;
    expect(first.subject !== null || first.templateError !== undefined).toBe(true);
  });
});
