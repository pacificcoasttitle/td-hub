import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The unreachable counter is the point of these tests ─────────────────────
//
// Only 11.5% of candidates can be reached at all — see the measurement in
// party-wizard-invite.ts. The job must COUNT what it cannot reach, by reason,
// and never let an unreachable order look like a quiet success. These tests hold
// that line.

const candidatesMock = vi.fn();
const sendEmailMock = vi.fn();
const getSettingMock = vi.fn();
const findLiveLinkMock = vi.fn();
const mintLinkMock = vi.fn();
const insertLogMock = vi.fn();

vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'o.id', openedAt: 'o.opened_at', operationalStatus: 'o.status', fileNumber: 'o.file_number', transactionType: 'o.tx', escrowOfficerId: 'o.eo' },
  orderProperties: { orderId: 'op.order_id', fullAddress: 'op.full', address: 'op.addr', city: 'op.city', state: 'op.state', zip: 'op.zip' },
  orderParties: {
    orderId: 'p.order_id', role: 'p.role', contactId: 'p.contact_id',
    externalEmail: 'p.external_email', externalName: 'p.external_name',
    externalCompany: 'p.external_company',
  },
  contacts: { id: 'c.id', fullName: 'c.full_name', email: 'c.email' },
  jobs: { id: 'j.id' },
  // Unused by the job, but the real settings module is loaded for its registry
  // and imports this. A missing export on a factory mock throws on access.
  settings: { id: 's.id', key: 's.key', value: 's.value' },
}));

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (table: Record<string, string>, name: string) => Object.fromEntries(
    Object.entries(table).map(([key, col]) => [key, `${name}.${String(col).split('.').pop()}`]),
  ),
}));

// The schema fields above are mocked as their column names, so rendering a
// drizzle `sql` template into a plain string yields readable SQL text. That is
// what lets the query tests below assert on the predicate the job actually
// builds instead of on a shape nobody can read.
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a.join(' AND '),
  eq: (a: unknown, b: unknown) => `${a} = ${b}`,
  asc: (a: unknown) => `${a} ASC`,
  isNull: (a: unknown) => `${a} IS NULL`,
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => strings
      .reduce<string>((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), '')
      .replace(/\s+/g, ' ')
      .trim(),
    { raw: (s: string) => s },
  ),
}));

const jobUpdates: Array<Record<string, unknown>> = [];

const executeMock = vi.fn();

/** The WHERE text and ORDER BY terms of the last candidate query built. */
let lastQuery: { where: string; orderBy: string[] } = { where: '', orderBy: [] };

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: (...a: unknown[]) => executeMock(...a),
    select: () => {
      // Four left joins now: property, officer contact, the escrow_company
      // party row, and that party's contact. Chained rather than nested so
      // adding a fifth does not mean another level of indentation.
      const afterJoins = {
        leftJoin: () => afterJoins,
        where: (clause: string) => {
          lastQuery = { where: clause, orderBy: [] };
          return {
            orderBy: (...terms: string[]) => {
              lastQuery.orderBy = terms;
              return { limit: candidatesMock };
            },
          };
        },
      };
      return { from: () => afterJoins };
    },
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
// Only `getSetting` is stubbed. SETTINGS_REGISTRY stays real, so the test that
// pins the shipped default of 5 reads the registry an operator would actually
// see rather than a copy of it maintained here.
vi.mock('@/lib/domain/settings/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/domain/settings/service')>()),
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
  PARTY_INVITE_ROLE, PARTY_INVITE_TRANSACTION_TYPES,
  PARTY_INVITE_MAX_PER_RUN_SETTING, PARTY_INVITE_DEFAULT_MAX_PER_RUN,
} from './party-wizard-invite';
import { eligibleTransactionTypesFor, SUPPORTED_WIZARD_ROLES } from '@/lib/domain/parties/party-wizard-fields';
import { SETTINGS_REGISTRY } from '@/lib/domain/settings/service';

/**
 * Answer the enabled switch and the run ceiling separately.
 *
 * The two settings are read from the same mock, so a blanket `'true'` would make
 * the ceiling `Number('true')` — NaN — and every test would be silently leaning
 * on the parse fallback instead of on the value it thinks it set.
 */
function settings({ enabled = 'true', maxPerRun = '100' }: {
  enabled?: string | null; maxPerRun?: string | null;
} = {}) {
  getSettingMock.mockImplementation(async (key: string) =>
    (key === PARTY_INVITE_MAX_PER_RUN_SETTING ? maxPerRun : enabled));
}

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
    // No escrow_company party unless a test supplies one, so the existing
    // reachability cases still measure the officer FK path on its own.
    escrowCompanyEmail: null,
    escrowCompanyName: null,
    escrowCompanyCompany: null,
    escrowCompanyContactEmail: null,
    escrowCompanyContactName: null,
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
  // Sending is opt-in, so every test that expects a send has to turn it on. The
  // run ceiling is deliberately slack here so tests about OTHER guardrails
  // measure those guardrails; the cap has its own block below.
  settings();
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
        + r.skippedDuplicateProperty + r.skippedRecipientCap + r.skippedRunCap
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

// ─── The candidate query ─────────────────────────────────────────────────────
//
// The query had no transaction-type predicate, so it asked refinance files for a
// listing agent that cannot exist on them, and its LIMIT had no ORDER BY, so the
// dry run an operator approves was not necessarily the set the live run scans.
// Both are invisible to a mocked database unless the test reads the SQL, so
// these assert the built text.

describe('candidate query', () => {
  beforeEach(() => {
    candidatesMock.mockResolvedValue([candidate()]);
  });

  it('builds byte-identical SQL on two identical calls', async () => {
    await handlePartyWizardInvite({ dryRun: true });
    const first = { ...lastQuery, orderBy: [...lastQuery.orderBy] };

    await handlePartyWizardInvite({ dryRun: true });
    const second = { ...lastQuery, orderBy: [...lastQuery.orderBy] };

    expect(second.where).toBe(first.where);
    expect(second.orderBy).toEqual(first.orderBy);
    // Not vacuously equal: the query has to have been built at all.
    expect(first.where).toContain('o.tx in');
    expect(first.orderBy).toHaveLength(2);
  });

  /**
   * Oldest first, then id. The far edge of the window is what the LIMIT must
   * never drop — those orders age out and are never asked again — and opened_at
   * alone is not a total order, because a busy day puts dozens of orders on one
   * timestamp.
   */
  it('orders oldest-first with an id tie-break, so the LIMIT is deterministic', async () => {
    await handlePartyWizardInvite({ dryRun: true });

    expect(lastQuery.orderBy).toEqual(['o.opened_at ASC', 'o.id ASC']);
  });

  it('asks only about Purchase, excluding refinances', async () => {
    await handlePartyWizardInvite({ dryRun: true });

    expect(PARTY_INVITE_TRANSACTION_TYPES).toEqual(['Purchase']);
    expect(lastQuery.where).toContain("o.tx in ('Purchase')");
    expect(lastQuery.where).not.toContain('Refinance');
  });

  /**
   * 130 production orders carry a NULL transaction_type. `<> 'Refinance'` is
   * NULL for every one of them, so a negative test drops them while reading as
   * though it keeps them. A positive IN list drops them too — visibly.
   */
  it('excludes a null transaction type by testing positively, not negatively', async () => {
    await handlePartyWizardInvite({ dryRun: true });

    // Only the transaction-type term — the listing-agent subquery legitimately
    // uses IS NOT NULL, and a whole-clause scan would trip over it.
    const txTerms = lastQuery.where.split(' AND ').filter((term) => term.includes('o.tx'));

    expect(txTerms).toEqual(["o.tx in ('Purchase')"]);
    for (const negation of ['<>', '!=', 'not in', 'NOT']) {
      expect(txTerms[0], `transaction type must not be filtered with ${negation}`).not.toContain(negation);
    }
  });

  it('includes a Purchase in-window with no listing agent, end to end', async () => {
    candidatesMock.mockResolvedValue([candidate({ orderId: 3, transactionType: 'Purchase' })]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.scanned).toBe(1);
    expect(r.report).toHaveLength(1);
    expect(r.report![0]).toMatchObject({
      orderId: 3,
      transactionType: 'Purchase',
      outcome: 'would_send',
      linkRoles: ['listing_agent'],
    });
    // The window and the missing-agent test are the query's, not the report's,
    // so assert they are present in the SQL that selected this row.
    expect(lastQuery.where).toContain("INTERVAL '3 days'");
    expect(lastQuery.where).toContain("INTERVAL '7 days'");
    expect(lastQuery.where).toContain("op.role = 'listing_agent'");
  });

  /**
   * The eligible types come from the ROLE, so the refi-shaped ask can be added
   * by defining a form rather than by editing this job's predicate.
   */
  it('takes its eligible transaction types from the role definition', () => {
    expect(PARTY_INVITE_TRANSACTION_TYPES).toEqual(eligibleTransactionTypesFor(PARTY_INVITE_ROLE));
    expect(PARTY_INVITE_TRANSACTION_TYPES.length).toBeGreaterThan(0);
  });

  it('asks only for a role the wizard can actually collect', () => {
    expect(SUPPORTED_WIZARD_ROLES).toContain(PARTY_INVITE_ROLE);
  });
});

// ─── The escrow_company fallback ─────────────────────────────────────────────
//
// The job used orders.escrow_officer_id and nothing else, so 88.5% of candidates
// were unreachable — every one of them for the same reason, a missing FK. The
// escrow_company party row carries an address on most of those files, and
// resolvePrelimRecipients has read it for exactly this purpose since the prelim
// work. The precedence here is deliberately that resolver's.

describe('falls back to the escrow_company party row', () => {
  const withCompany = {
    escrowOfficerId: null,
    escrowOfficerName: null,
    escrowOfficerEmail: null,
    escrowCompanyEmail: 'orders@cornerescrow.com',
    escrowCompanyName: 'Dana Ruiz',
    escrowCompanyCompany: 'Corner Escrow, Inc.',
  };

  it('reaches an order with no officer FK, which used to be unreachable', async () => {
    candidatesMock.mockResolvedValue([candidate(withCompany)]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(1);
    expect(r.unreachable.noEscrowOfficer).toBe(0);
    expect(r.viaEscrowCompanyFallback).toBe(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'orders@cornerescrow.com' });
  });

  it('prefers the officer FK when both exist, matching the prelim resolver', async () => {
    candidatesMock.mockResolvedValue([candidate({
      escrowCompanyEmail: 'orders@cornerescrow.com',
      escrowCompanyCompany: 'Corner Escrow, Inc.',
    })]);

    const r = await handlePartyWizardInvite();

    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'officer@example.com' });
    expect(r.viaEscrowCompanyFallback).toBe(0);
  });

  it("uses the party row's linked contact when it has no external_email", async () => {
    candidatesMock.mockResolvedValue([candidate({
      ...withCompany,
      escrowCompanyEmail: null,
      escrowCompanyContactEmail: 'dana@cornerescrow.com',
      escrowCompanyContactName: 'Dana Ruiz',
    })]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'dana@cornerescrow.com' });
  });

  it('rejects a party row whose email is not an address', async () => {
    candidatesMock.mockResolvedValue([candidate({
      ...withCompany,
      escrowCompanyEmail: 'see attached',
    })]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(0);
    expect(r.unreachable.noEscrowOfficer).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('counts an order as unreachable only when BOTH lookups fail', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, ...withCompany }),
      candidate({ orderId: 2, escrowOfficerId: null, escrowOfficerEmail: null }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(1);
    expect(r.unreachable.noEscrowOfficer).toBe(1);
    expect(r.reachablePct).toBe(50);
  });

  it('logs which lookup found the recipient, not a fixed role', async () => {
    candidatesMock.mockResolvedValue([candidate(withCompany)]);

    await handlePartyWizardInvite();

    expect(insertLogMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientRole: 'escrow_company',
      recipientEmail: 'orders@cornerescrow.com',
      recipientName: 'Dana Ruiz',
    }));
  });

  /**
   * A second escrow_company row would make one order into two candidates: two
   * links minted and two emails to the same person about the same file.
   */
  it('collapses a duplicated escrow_company join into one candidate', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, ...withCompany }),
      candidate({ orderId: 1, ...withCompany }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.scanned).toBe(1);
    expect(r.sent).toBe(1);
    expect(mintLinkMock).toHaveBeenCalledOnce();
  });
});

// ─── Which copy variant ──────────────────────────────────────────────────────
//
// THE THING THAT MUST NOT REGRESS. Only 18.2% of the escrow-officer contacts
// orders point at are @pct.com; the other 81.8% are outside firms recorded as
// the officer. Keying the variant off which lookup found the recipient would
// send colleague copy to thousands of strangers.

describe('picks the copy variant by domain, not by lookup source', () => {
  it('sends colleague copy to a @pct.com officer', async () => {
    candidatesMock.mockResolvedValue([candidate({ escrowOfficerEmail: 'cquintanar@pct.com' })]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report![0]!.recipientAudience).toBe('internal');
    expect(r.audience).toEqual({ internal: 1, external: 0 });
    expect(r.sampleEmail!.subject).toBe('Missing listing agent details — file 20020625-OCT');
  });

  /** The 81.8% case: an outside firm sitting in the officer FK. */
  it('sends stranger copy to an officer FK that is NOT a PCT address', async () => {
    candidatesMock.mockResolvedValue([candidate({
      escrowOfficerEmail: 'lupe@powerhouseescrow.com',
      escrowOfficerName: 'Lupe Vidaca',
    })]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report![0]!.recipientRole).toBe('escrow_officer');
    expect(r.report![0]!.recipientAudience).toBe('external');
    expect(r.audience).toEqual({ internal: 0, external: 1 });
    expect(r.sampleEmail!.html).toContain('Pacific Coast Title is handling the title work');
  });

  /** And the mirror: a PCT address reached through the party-row fallback. */
  it('sends colleague copy to a @pct.com address found via the fallback', async () => {
    candidatesMock.mockResolvedValue([candidate({
      escrowOfficerId: null,
      escrowOfficerEmail: null,
      escrowCompanyEmail: 'aballesteros@pct.com',
      escrowCompanyName: 'Anna Ballesteros',
    })]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report![0]!.recipientRole).toBe('escrow_company');
    expect(r.report![0]!.recipientAudience).toBe('internal');
    expect(r.sampleEmail!.html).not.toContain('Pacific Coast Title is handling the title work');
  });

  it('splits a mixed batch across both variants', async () => {
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, escrowOfficerEmail: 'a@pct.com' }),
      candidate({ orderId: 2, escrowOfficerEmail: 'b@cornerescrow.com' }),
      candidate({ orderId: 3, escrowOfficerEmail: 'c@novaescrow.com' }),
    ]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.audience).toEqual({ internal: 1, external: 2 });
    expect(r.report!.map((row) => row.recipientAudience))
      .toEqual(['internal', 'external', 'external']);
  });

  it('labels the sample body with the variant it rendered', async () => {
    candidatesMock.mockResolvedValue([candidate({ escrowOfficerEmail: 'b@cornerescrow.com' })]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.sampleEmail!.audience).toBe('external');
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

// ─── Total-per-run ceiling ───────────────────────────────────────────────────
//
// The per-recipient cap bounds what one person receives and does nothing to
// bound the run: twenty officers with two files each is forty emails and no cap
// is exceeded. For a first pilot of copy nobody has ever received, the number
// that matters is the total, and the owner approved five.

describe('caps the total emails a single run may send', () => {
  /** Distinct recipients and distinct properties, so ONLY the run cap can bite. */
  function distinctOrders(count: number) {
    return Array.from({ length: count }, (_, i) => candidate({
      orderId: i + 1,
      fileNumber: `FILE-${i + 1}`,
      openedAt: new Date(Date.UTC(2026, 7, 10, 0, 0, i)),
      fullAddress: `${i + 1} Distinct Ave, Irvine, CA`,
      escrowOfficerEmail: `officer${i + 1}@example.com`,
    }));
  }

  it('ships with a pilot default of five, in the registry an operator reads', () => {
    expect(PARTY_INVITE_DEFAULT_MAX_PER_RUN).toBe(5);
    const def = SETTINGS_REGISTRY.find(s => s.key === PARTY_INVITE_MAX_PER_RUN_SETTING);
    expect(def).toBeDefined();
    expect(def!.defaultValue).toBe('5');
    expect(def!.type).toBe('number');
  });

  it('sends five of twelve and holds the rest', async () => {
    settings({ maxPerRun: '5' });
    candidatesMock.mockResolvedValue(distinctOrders(12));

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(5);
    expect(r.skippedRunCap).toBe(7);
    expect(r.runCap).toBe(5);
    expect(sendEmailMock).toHaveBeenCalledTimes(5);
  });

  /**
   * The dry run is the only safety check this feature has. One that previews a
   * different set from the one the live run sends is not a check, so the cap has
   * to live in planSends where both paths go through it — not on the send path.
   */
  it('previews exactly the set the live run sends', async () => {
    settings({ maxPerRun: '5' });
    const rows = distinctOrders(12);

    candidatesMock.mockResolvedValue(rows);
    const preview = await handlePartyWizardInvite({ dryRun: true });
    const wouldSend = preview.report!
      .filter(row => row.outcome === 'would_send')
      .map(row => row.fileNumber);

    vi.clearAllMocks();
    settings({ maxPerRun: '5' });
    executeMock.mockResolvedValue([]);
    findLiveLinkMock.mockResolvedValue(null);
    mintLinkMock.mockResolvedValue({ linkId: 1, url: 'https://hub.pctitle.com/party-wizard/tok' });
    sendEmailMock.mockResolvedValue({ success: true });
    candidatesMock.mockResolvedValue(rows);
    const live = await handlePartyWizardInvite();

    const actuallySent = insertLogMock.mock.calls
      .map(c => (c[0] as { orderId: number }).orderId)
      .map(id => `FILE-${id}`);

    expect(wouldSend).toHaveLength(5);
    expect(actuallySent).toEqual(wouldSend);
    expect(live.sent).toBe(5);
    expect(preview.skippedRunCap).toBe(live.skippedRunCap);
  });

  /**
   * Oldest first, matching the candidate query's `opened_at ASC, id ASC`. The
   * rows nearest the far edge of the window are the ones about to age out and
   * never be asked again, so they are the ones a ceiling must not hold.
   */
  it('holds the youngest, not whatever the database returned first', async () => {
    settings({ maxPerRun: '2' });
    // Highest order id is the OLDEST file, so an id sort would pick the wrong two.
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fileNumber: 'NEWEST', openedAt: new Date('2026-08-20T00:00:00Z'), fullAddress: '1 A St', escrowOfficerEmail: 'one@example.com' }),
      candidate({ orderId: 2, fileNumber: 'MIDDLE', openedAt: new Date('2026-08-18T00:00:00Z'), fullAddress: '2 B St', escrowOfficerEmail: 'two@example.com' }),
      candidate({ orderId: 3, fileNumber: 'OLDEST', openedAt: new Date('2026-08-15T00:00:00Z'), fullAddress: '3 C St', escrowOfficerEmail: 'three@example.com' }),
    ]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    const sending = r.report!.filter(row => row.outcome === 'would_send').map(row => row.fileNumber);
    expect(sending).toEqual(['MIDDLE', 'OLDEST']);
    expect(r.report!.find(row => row.fileNumber === 'NEWEST')!.outcome).toBe('skipped_run_cap');
  });

  it('picks the same five however the rows arrive', async () => {
    settings({ maxPerRun: '5' });
    const rows = distinctOrders(12);

    candidatesMock.mockResolvedValue(rows);
    const forwards = await handlePartyWizardInvite({ dryRun: true });

    candidatesMock.mockResolvedValue([...rows].reverse());
    const backwards = await handlePartyWizardInvite({ dryRun: true });

    const chosen = (r: Awaited<ReturnType<typeof handlePartyWizardInvite>>) =>
      r.report!.filter(row => row.outcome === 'would_send').map(row => row.fileNumber).sort();

    expect(chosen(forwards)).toEqual(['FILE-1', 'FILE-2', 'FILE-3', 'FILE-4', 'FILE-5']);
    expect(chosen(backwards)).toEqual(chosen(forwards));
  });

  /**
   * A held order must be indistinguishable, from the database's point of view,
   * from an order the run never looked at. No link, no notification log — the
   * two things that make an order stop being a candidate.
   */
  it('leaves held orders eligible: mints nothing and logs nothing for them', async () => {
    settings({ maxPerRun: '2' });
    candidatesMock.mockResolvedValue(distinctOrders(6));

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(2);
    expect(r.skippedRunCap).toBe(4);
    expect(mintLinkMock).toHaveBeenCalledTimes(2);
    expect(insertLogMock).toHaveBeenCalledTimes(2);
    const touched = insertLogMock.mock.calls.map(c => (c[0] as { orderId: number }).orderId);
    expect(touched).toEqual([1, 2]);
  });

  it('names the held rows as their own outcome instead of dropping them', async () => {
    settings({ maxPerRun: '2' });
    candidatesMock.mockResolvedValue(distinctOrders(4));

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report).toHaveLength(4);
    expect(r.report!.map(row => row.outcome)).toEqual([
      'would_send', 'would_send', 'skipped_run_cap', 'skipped_run_cap',
    ]);
    // A held row still shows who it would have gone to — that is the point of
    // seeing it rather than a shorter report.
    expect(r.report![3]!.recipientEmail).toBe('officer4@example.com');
  });

  /**
   * Reading `skipped_run_cap` should mean "raise the ceiling and this goes out".
   * For someone already at their two, that would not be true, so the
   * per-recipient cap is attributed first.
   */
  it('attributes a recipient already at their limit to the recipient cap', async () => {
    settings({ maxPerRun: '2' });
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fileNumber: 'A1', fullAddress: '1 A St', escrowOfficerEmail: 'one@example.com' }),
      candidate({ orderId: 2, fileNumber: 'A2', fullAddress: '2 A St', escrowOfficerEmail: 'one@example.com' }),
      candidate({ orderId: 3, fileNumber: 'A3', fullAddress: '3 A St', escrowOfficerEmail: 'one@example.com' }),
      candidate({ orderId: 4, fileNumber: 'B1', fullAddress: '4 B St', escrowOfficerEmail: 'two@example.com' }),
    ]);

    const r = await handlePartyWizardInvite({ dryRun: true });

    expect(r.report!.map(row => row.outcome)).toEqual([
      'would_send', 'would_send', 'skipped_recipient_cap', 'skipped_run_cap',
    ]);
    expect(r.skippedRecipientCap).toBe(1);
    expect(r.skippedRunCap).toBe(1);
  });

  it('does not spend a slot on a duplicate property', async () => {
    settings({ maxPerRun: '2' });
    candidatesMock.mockResolvedValue([
      candidate({ orderId: 1, fileNumber: 'A-OCT', fullAddress: '8613 BONITA RD', escrowOfficerEmail: 'a@example.com' }),
      candidate({ orderId: 2, fileNumber: 'A-PRV', fullAddress: '8613 BONITA RD', escrowOfficerEmail: 'b@example.com' }),
      candidate({ orderId: 3, fileNumber: 'B', fullAddress: '52 CARROLL DR', escrowOfficerEmail: 'c@example.com' }),
    ]);

    const r = await handlePartyWizardInvite();

    expect(r.sent).toBe(2);
    expect(r.skippedDuplicateProperty).toBe(1);
    expect(r.skippedRunCap).toBe(0);
  });

  it('honours zero as "send nothing" without touching the master switch', async () => {
    settings({ maxPerRun: '0' });
    candidatesMock.mockResolvedValue(distinctOrders(3));

    const r = await handlePartyWizardInvite();

    expect(r.enabled).toBe(true);
    expect(r.refused).toBeUndefined();
    expect(r.sent).toBe(0);
    expect(r.skippedRunCap).toBe(3);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * The failure mode of a missing ceiling is a mailbox full of a template nobody
   * has approved. An unreadable value therefore falls back to the pilot default,
   * never to unlimited.
   */
  it('falls back to the pilot default on an unreadable value, never to unlimited', async () => {
    for (const junk of [null, '', '   ', 'lots', '-3', 'NaN']) {
      vi.clearAllMocks();
      settings({ maxPerRun: junk });
      executeMock.mockResolvedValue([]);
      findLiveLinkMock.mockResolvedValue(null);
      candidatesMock.mockResolvedValue(distinctOrders(9));

      const r = await handlePartyWizardInvite({ dryRun: true });

      expect(r.runCap, `value ${JSON.stringify(junk)} must fall back`).toBe(5);
      expect(r.report!.filter(row => row.outcome === 'would_send')).toHaveLength(5);
    }
  });

  it('widens without a code change when the setting is raised', async () => {
    settings({ maxPerRun: '20' });
    candidatesMock.mockResolvedValue(distinctOrders(12));

    const r = await handlePartyWizardInvite();

    expect(r.runCap).toBe(20);
    expect(r.sent).toBe(12);
    expect(r.skippedRunCap).toBe(0);
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
    settings({ enabled: 'false' });
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
