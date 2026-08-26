import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, jobs, orderProperties, orders } from '@/lib/db/schema';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { getSetting } from '@/lib/domain/settings/service';
import { insertNotificationLog } from '@/lib/domain/notifications/dispatch';
import {
  buildPartyWizardEmail, buildPartyWizardSubject, buildPartyWizardText,
} from '@/lib/domain/parties/party-wizard-email';
import { findLiveLink, mintLinkForOrder } from '@/lib/domain/parties/party-wizard-service';
import { eligibleTransactionTypesFor } from '@/lib/domain/parties/party-wizard-fields';
import type { PartyRole } from '@/lib/domain/parties/party-wizard-fields';
import {
  ACTIVE_ORDER_STATUSES, statusSqlList, transactionTypeSqlList,
} from '@/lib/domain/orders/status-map';

// ─── Party wizard invite ─────────────────────────────────────────────────────
//
// Three days after a PURCHASE order opens, if we still have no listing agent,
// email the ESCROW OFFICER a forwardable link.
//
// WHY THIS IS MEASURED. Only 11.5% of candidates can be reached at all. That is
// not a reason to wait longer — it is the finding. The job therefore does NOT
// quietly skip what it cannot reach: every unreachable order is counted by
// reason and returned, so the gap trends weekly instead of disappearing into a
// log line.
//
// The counters are the deliverable as much as the emails are.
//
// HOW 11.5% WAS MEASURED, so the next person can re-derive it rather than
// trusting it. An earlier version of this comment claimed ~54%, which was wrong
// by a factor of five and had no stated method, so nobody could check it.
//
//   Replay this file's candidate predicate once per day over the last 41 days
//   and count how many rows carry a usable escrow-officer email:
//
//     with asof as (
//       select generate_series(date_trunc('day', now()) - interval '40 days',
//                              date_trunc('day', now()), interval '1 day') as t)
//     select count(*) as candidates,
//            count(*) filter (where c.id is not null
//                               and nullif(trim(c.email), '') is not null) as reachable
//     from asof a
//     join orders o
//       on o.operational_status in ('open', 'in_process')
//      and o.transaction_type = 'Purchase'
//      and o.opened_at <= a.t - interval '3 days'
//      and o.opened_at >= a.t - interval '7 days'
//     left join contacts c on c.id = o.escrow_officer_id
//     where not exists (
//       select 1 from order_parties op
//       where op.order_id = o.id and op.role = 'listing_agent'
//         and coalesce(nullif(trim(op.external_email), ''),
//                      nullif(trim(op.external_name), '')) is not null);
//
//   Measured 2026-08-26 WITHOUT the transaction-type predicate (i.e. against
//   what this job used to scan): 482 reachable of 4,197 candidates = 11.5%.
//
//   The replay is exact for any past date because production has never sent an
//   invite, so the per-order suppression and the property lookback are no-ops.
//
// The shortfall is almost entirely a MISSING FK, not a missing address: of the
// 3,715 unreachable rows in that measurement, 3,715 had no escrow_officer_id at
// all. See PartyInviteUnreachable for what that means for the counters.

export const PARTY_INVITE_DELAY_DAYS = 3;

/**
 * Upper bound on order age. Deliberately narrow for the pilot.
 *
 * At 30 days the first run would clear a 27-day backlog in one morning — ~93
 * emails, from an untested template, to the exact escrow officers whose
 * VOLUNTARY forwarding the whole feature depends on. If the copy reads wrong
 * we would rather learn it at five emails than ninety-three.
 *
 * Widen to 30 once the first sends are confirmed to land and get forwarded.
 */
export const PARTY_INVITE_MAX_AGE_DAYS = 7;
export const PARTY_INVITE_BATCH = 100;
export const PARTY_INVITE_ROLE: PartyRole = 'listing_agent';

/**
 * Transaction types this run may ask about, taken FROM THE ROLE.
 *
 * The candidate query had no transaction-type predicate at all, so it asked for
 * a listing agent on every order it could reach. Measured over 41 simulated
 * run-days that made the send list 83% refinances — files on which there is no
 * listing agent to name and never will be.
 *
 * Two things about the shape of the fix are deliberate.
 *
 * FIRST, it is derived rather than hardcoded. `'Purchase'` is not a fact about
 * this job, it is a fact about asking for a listing agent, and it lives in
 * party-wizard-fields.ts next to the form that collects one. The refi-shaped ask
 * (`lender_contact`, missing on 62.2% of 2,066 active refinances) is the same
 * job pointed at a different role, and it must not require editing this file's
 * predicate to add.
 *
 * SECOND, it is a positive IN list, never `<> 'Refinance'`. 130 production
 * orders carry a NULL transaction_type, and `transaction_type <> 'Refinance'`
 * is NULL — not true — for every one of them, so a negative test would drop
 * them silently while reading as though it kept them. A positive list excludes
 * them too, but it does so where a reader can see it.
 *
 * THIS IS A DELIBERATE NARROWING AND IT IS LARGE. Purchase-only takes the
 * first-run send list from 8 to 3 on measured production data, and the whole
 * 41-day total from 222 to 70. That is the point: the 152 sends it removes were
 * asking refinance files for a party that cannot exist on them.
 */
export const PARTY_INVITE_TRANSACTION_TYPES = eligibleTransactionTypesFor(PARTY_INVITE_ROLE);

/**
 * Hard ceiling on emails to one person per run. Permanent, not a pilot setting.
 *
 * Measured against production: a single run put 12 of 21 invites in one escrow
 * officer's inbox, four of them consecutive file numbers on adjacent properties.
 * That reads as a malfunction, and someone who thinks the system is broken does
 * not forward the link — which costs exactly the outcome the job exists for.
 *
 * Orders over the cap are not dropped. They stay eligible and go out on the next
 * run, so the queue drains at this rate instead of arriving at once. A
 * per-recipient digest is the eventual answer; the cap holds until then.
 */
export const PARTY_INVITE_MAX_PER_RECIPIENT = 2;

/**
 * How far back a prior invite still suppresses a second ask for the same
 * property. Matches the link lifetime — while the first link is usable, asking
 * again for the same property is asking twice.
 */
export const PARTY_INVITE_PROPERTY_LOOKBACK_DAYS = 60;

/**
 * Statuses worth chasing an agent for: live work only.
 *
 * ACTIVE rather than ENRICHABLE — the enrichment jobs include 'completed'
 * because backfilling data on a finished file is harmless, but this job emails
 * a person asking them to chase someone, and on a completed order that is a
 * false alarm.
 *
 * See status-map.ts for why 'open' alone is a trap.
 */
export const PARTY_INVITE_STATUSES = ACTIVE_ORDER_STATUSES;

/**
 * Runtime master switch. DB-backed so it needs no redeploy, and OPT-IN rather
 * than opt-out.
 *
 * This was a shut-off flag defaulting to false, which meant a running job with a
 * brake: a fresh environment, a wiped settings row, or a restored backup all
 * resumed emailing people outside PCT with nobody deciding to. The absence of a
 * row now means silence. Someone has to say yes.
 *
 * A dry run deliberately ignores this switch — see handlePartyWizardInvite.
 */
export const PARTY_INVITE_ENABLED_SETTING = 'party_wizard_invite_enabled';

/**
 * Why we could not send. Each is a distinct operational problem.
 *
 * A WORD ON `escrowOfficerNoEmail`, WHICH READS AS A ZERO AND IS NOT ONE.
 *
 * It has never incremented. Across all 3,842 orders carrying an
 * `escrow_officer_id`, zero point at a missing contact row and zero point at a
 * contact with a blank email (measured 2026-08-26). So in practice the FK is
 * either absent or it resolves to someone reachable, and this counter reports 0
 * every run.
 *
 * It is KEPT rather than deleted because it is reachable code, not dead code:
 * `contacts.email` is nullable and nothing enforces that an escrow-officer
 * contact has one. A 0 here means "measured zero", not "not implemented" — and
 * the day a contact sync lands a nameless officer, this is the counter that
 * says so. Deleting it would trade a true zero for no signal at all.
 *
 * `noEscrowOfficer` is where the real number lives: 3,715 of 3,715 unreachable
 * rows in the same measurement.
 */
export interface PartyInviteUnreachable {
  /** No `escrow_officer_id` on the order. This is ~100% of unreachability. */
  noEscrowOfficer: number;
  /** FK present but it resolves to nobody with an address. Currently always 0. */
  escrowOfficerNoEmail: number;
}

/** Why an order appears in a dry-run report the way it does. */
export type PartyInviteOutcome =
  | 'would_send'
  | 'skipped_existing_link'
  | 'skipped_duplicate_property'
  | 'skipped_recipient_cap'
  | 'no_escrow_officer'
  | 'officer_no_email';

export interface PartyInviteReportRow {
  orderId: number;
  fileNumber: string;
  /** Null when the stored date is unusable — a report never throws over one row. */
  openedAt: string | null;
  ageDays: number | null;
  transactionType: string | null;
  propertyAddress: string | null;
  /** The address that would actually be emailed, resolved by the live resolver. */
  recipientEmail: string | null;
  recipientName: string | null;
  recipientRole: 'escrow_officer';
  outcome: PartyInviteOutcome;
  /**
   * The file that owns the single ask for this property, when this row was
   * skipped as a duplicate. Null when the earlier ask was on a previous run.
   */
  duplicateOf?: string | null;
  /** Roles the invite would carry a link for. */
  linkRoles: PartyRole[];
  linkAction: 'would_mint' | 'live_link_exists' | 'none';
  /** Rendered from the real template, so a broken template fails the dry run. */
  subject: string | null;
  templateError?: string;
}

export interface PartyInviteSampleEmail {
  orderId: number;
  fileNumber: string;
  /** The address this exact email would have gone to. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stands where the real link would sit. */
  linkPlaceholder: string;
}

export interface PartyInviteResult {
  scanned: number;
  sent: number;
  failed: number;
  skippedExistingLink: number;
  /** Another file on the same property already carries the ask. */
  skippedDuplicateProperty: number;
  /** Held back by the per-recipient cap. Eligible again next run. */
  skippedRecipientCap: number;
  unreachable: PartyInviteUnreachable;
  /** Share of candidates we could actually reach. The number to watch. */
  reachablePct: number;
  /** Whether sending was permitted on this run. */
  enabled: boolean;
  dryRun: boolean;
  /** Set when the run refused to send because nobody had enabled it. */
  refused?: true;
  /** Present on a dry run only. One row per candidate, nothing omitted. */
  report?: PartyInviteReportRow[];
  /**
   * Present on a dry run only. The first email this run would send, kept whole.
   *
   * Approving copy from a summary means approving a draft. This is the real
   * output for a real order — same template, same data, same link placement —
   * with the URL replaced, since a working link cannot exist without a write.
   */
  sampleEmail?: PartyInviteSampleEmail;
  /**
   * Why the report cannot show link URLs. Carried in the payload rather than
   * left to the reader to notice.
   */
  reportNote?: string;
}

export interface PartyInvitePayload {
  /** Resolve and render everything, write and send nothing. */
  dryRun?: boolean;
  /** Injected by the job runner so a run can record itself. */
  __jobId?: number;
}

/**
 * Minting a link is a write and stored tokens are hashed, so a dry run can
 * report WHICH link each order would carry but never the URL itself.
 */
const REPORT_NOTE = 'No link URLs: minting a link is a write, and existing link '
  + 'tokens are stored hashed. linkAction says whether a new link would be minted '
  + 'or a live one already exists.';

interface CandidateRow {
  orderId: number;
  fileNumber: string;
  openedAt: Date;
  transactionType: string | null;
  fullAddress: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  escrowOfficerId: number | null;
  escrowOfficerName: string | null;
  escrowOfficerEmail: string | null;
}

/**
 * Eligible-transaction-type orders opened between PARTY_INVITE_DELAY_DAYS and
 * PARTY_INVITE_MAX_AGE_DAYS ago, with no listing agent on file and no invite
 * already sent.
 *
 * The upper bound matters: without it, every historical order with a missing
 * agent would be emailed the first time this runs.
 *
 * WHY THE ORDER BY IS LOAD-BEARING AND NOT COSMETIC. `limit` is 100 and the
 * window regularly holds more than that — on 20 of the last 41 simulated
 * run-days the candidate count exceeded 100, peaking at 163. Without an ORDER BY
 * the planner picks which 100 come back, which means the dry run an operator
 * reviews and the live run that follows it can scan DIFFERENT SETS. The dry run
 * is the only safety check this feature has; one that does not scan what the
 * live run scans is not a check.
 *
 * Oldest first. The rows nearest the far edge of the window are the ones about
 * to age past PARTY_INVITE_MAX_AGE_DAYS and never be asked again, so if the
 * limit has to drop somebody it should drop the youngest — they are still
 * in-window tomorrow. Sorting newest-first would quietly starve exactly the
 * orders the window is about to close on.
 *
 * `orders.id` breaks ties. `opened_at` is a date in practice, so a busy day can
 * put dozens of orders on the same timestamp and leave the sort as
 * non-deterministic as no sort at all. It also matches the tie-break planSends
 * already uses to decide which sibling file carries a shared property.
 */
async function loadCandidates(limit: number): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      fileNumber: orders.fileNumber,
      openedAt: orders.openedAt,
      transactionType: orders.transactionType,
      fullAddress: orderProperties.fullAddress,
      address: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
      zip: orderProperties.zip,
      escrowOfficerId: orders.escrowOfficerId,
      escrowOfficerName: contacts.fullName,
      escrowOfficerEmail: contacts.email,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .leftJoin(contacts, eq(contacts.id, orders.escrowOfficerId))
    .where(and(
      sql`${orders.operationalStatus} in (${sql.raw(statusSqlList(PARTY_INVITE_STATUSES))})`,
      // Positive list, never a negative test — see PARTY_INVITE_TRANSACTION_TYPES.
      sql`${orders.transactionType} in (${sql.raw(transactionTypeSqlList(PARTY_INVITE_TRANSACTION_TYPES))})`,
      sql`${orders.openedAt} <= NOW() - INTERVAL '${sql.raw(String(PARTY_INVITE_DELAY_DAYS))} days'`,
      sql`${orders.openedAt} >= NOW() - INTERVAL '${sql.raw(String(PARTY_INVITE_MAX_AGE_DAYS))} days'`,
      // No listing agent with anything usable on it.
      sql`NOT EXISTS (
        SELECT 1 FROM order_parties op
        WHERE op.order_id = ${orders.id}
          AND op.role = 'listing_agent'
          AND (COALESCE(NULLIF(TRIM(op.external_email), ''), NULLIF(TRIM(op.external_name), '')) IS NOT NULL)
      )`,
      // Nothing sent for this order before.
      sql`NOT EXISTS (
        SELECT 1 FROM notification_logs nl
        WHERE nl.order_id = ${orders.id} AND nl.event_type = 'party_wizard.invite'
      )`,
    ))
    .orderBy(asc(orders.openedAt), asc(orders.id))
    .limit(limit);

  return rows as CandidateRow[];
}

function composeAddress(row: CandidateRow): string | null {
  if (row.fullAddress?.trim()) return row.fullAddress.trim();
  const parts = [row.address, [row.city, row.state].filter(Boolean).join(', '), row.zip]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(', ') : null;
}

export async function handlePartyWizardInvite(
  payload: PartyInvitePayload = {},
): Promise<PartyInviteResult> {
  const dryRun = payload.dryRun === true;
  const enabled = (await getSetting(PARTY_INVITE_ENABLED_SETTING)) === 'true';

  // A dry run writes nothing and sends nothing, so it must work while sending is
  // off — previewing the recipient list is exactly what you do BEFORE enabling.
  if (!enabled && !dryRun) {
    console.warn(
      `[party-wizard-invite] REFUSED — sending is not enabled. `
      + `Set ${PARTY_INVITE_ENABLED_SETTING}=true in Settings to permit sends. `
      + 'Scanned nothing, sent nothing.',
    );
    const refusal: PartyInviteResult = {
      scanned: 0, sent: 0, failed: 0, skippedExistingLink: 0,
      skippedDuplicateProperty: 0, skippedRecipientCap: 0,
      unreachable: { noEscrowOfficer: 0, escrowOfficerNoEmail: 0 },
      reachablePct: 0, enabled: false, dryRun: false, refused: true,
    };
    await recordRun(payload, refusal);
    return refusal;
  }

  const candidates = await loadCandidates(PARTY_INVITE_BATCH);

  const result: PartyInviteResult = {
    scanned: candidates.length,
    sent: 0,
    failed: 0,
    skippedExistingLink: 0,
    skippedDuplicateProperty: 0,
    skippedRecipientCap: 0,
    unreachable: { noEscrowOfficer: 0, escrowOfficerNoEmail: 0 },
    reachablePct: 0,
    enabled,
    dryRun,
  };

  if (dryRun) {
    result.reportNote = REPORT_NOTE;
  }

  // ── Pass 1: who can we reach, and who is already covered ──
  const outcomes = new Map<number, { outcome: PartyInviteOutcome; linkAction: LinkAction; duplicateOf?: string | null }>();
  const reachableRows: Sendable[] = [];

  for (const row of candidates) {
    // Count what we cannot reach, by reason, BEFORE doing any work — an
    // unreachable order must never look like a silent success.
    if (!row.escrowOfficerId) {
      result.unreachable.noEscrowOfficer++;
      outcomes.set(row.orderId, { outcome: 'no_escrow_officer', linkAction: 'none' });
      continue;
    }
    const to = row.escrowOfficerEmail?.trim();
    if (!to) {
      result.unreachable.escrowOfficerNoEmail++;
      outcomes.set(row.orderId, { outcome: 'officer_no_email', linkAction: 'none' });
      continue;
    }

    // A live link means an invite is already in flight for this role.
    if (await findLiveLink(row.orderId, PARTY_INVITE_ROLE)) {
      result.skippedExistingLink++;
      outcomes.set(row.orderId, { outcome: 'skipped_existing_link', linkAction: 'live_link_exists' });
      continue;
    }

    reachableRows.push({ row, to });
  }

  // ── Pass 2: one ask per property, then the per-recipient cap ──
  const plan = planSends(reachableRows, await loadInvitedProperties());

  for (const dup of plan.duplicates) {
    result.skippedDuplicateProperty++;
    outcomes.set(dup.row.orderId, {
      outcome: 'skipped_duplicate_property', linkAction: 'none', duplicateOf: dup.duplicateOf,
    });
  }
  for (const held of plan.capped) {
    result.skippedRecipientCap++;
    outcomes.set(held.row.orderId, { outcome: 'skipped_recipient_cap', linkAction: 'none' });
  }

  // ── Pass 3: act ──
  const previews = new Map<number, PartyInviteReportRow>();

  for (const { row, to } of plan.sending) {
    outcomes.set(row.orderId, { outcome: 'would_send', linkAction: 'would_mint' });

    // A dry run stops here: everything below this line either writes a link row
    // or sends mail. The templates are still rendered against the same input, so
    // a template that throws fails the dry run instead of the first real send.
    if (dryRun) {
      const preview = renderPreview(row);
      previews.set(row.orderId, preview.row);
      // Keep the first one whole. One is enough to review the wording, and a
      // hundred full bodies in one response is a payload nobody reads.
      if (!result.sampleEmail && preview.rendered) {
        result.sampleEmail = { orderId: row.orderId, fileNumber: row.fileNumber, to, ...preview.rendered };
      }
      continue;
    }

    const minted = await mintLinkForOrder(row.orderId, PARTY_INVITE_ROLE);
    if (!minted) {
      result.failed++;
      continue;
    }

    const input = { ...templateInput(row), roleLinks: [{ role: PARTY_INVITE_ROLE, url: minted.url }] };

    const subject = buildPartyWizardSubject(input);

    try {
      const send = await sendEmail({
        to,
        subject,
        html: buildPartyWizardEmail(input),
        text: buildPartyWizardText(input),
      });

      const ok = send.success;
      if (ok) result.sent++; else result.failed++;

      await insertNotificationLog({
        eventType: 'party_wizard.invite',
        orderId: row.orderId,
        channel: 'email',
        recipientEmail: to,
        recipientName: row.escrowOfficerName ?? undefined,
        recipientRole: 'escrow_officer',
        subject,
        status: ok ? 'sent' : 'failed',
        errorMessage: ok ? undefined : send.error?.message?.slice(0, 500),
      });
    } catch {
      result.failed++;
    }
  }

  // Built last, in candidate order, so the report reads in the same order as the
  // scan regardless of which pass decided each row.
  if (dryRun) {
    result.report = candidates.map((row) => {
      const decided = outcomes.get(row.orderId);
      const built = previews.get(row.orderId)
        ?? reportRow(row, decided?.outcome ?? 'would_send', decided?.linkAction ?? 'none');
      if (decided?.duplicateOf !== undefined) built.duplicateOf = decided.duplicateOf;
      return built;
    });
  }

  const reachable = result.scanned
    - result.unreachable.noEscrowOfficer
    - result.unreachable.escrowOfficerNoEmail;
  result.reachablePct = result.scanned > 0
    ? Math.round((reachable / result.scanned) * 1000) / 10
    : 0;

  console.log(
    `[party-wizard-invite]${dryRun ? ' DRY RUN' : ''} scanned=${result.scanned} `
    + `sent=${result.sent} failed=${result.failed} `
    + `skipped_existing=${result.skippedExistingLink} `
    + `skipped_duplicate_property=${result.skippedDuplicateProperty} `
    + `skipped_recipient_cap=${result.skippedRecipientCap} `
    + `unreachable_no_officer=${result.unreachable.noEscrowOfficer} `
    + `unreachable_no_email=${result.unreachable.escrowOfficerNoEmail} `
    + `reachable=${result.reachablePct}%`,
  );

  await recordRun(payload, result);

  return result;
}

// ─── One ask per property, capped per recipient ──────────────────────────────

type LinkAction = PartyInviteReportRow['linkAction'];

export interface Sendable {
  row: CandidateRow;
  to: string;
}

export interface PartyInvitePlan {
  sending: Sendable[];
  /** Same property as a file that already carries the ask. */
  duplicates: Array<Sendable & { duplicateOf: string | null }>;
  /** Over the per-recipient cap. Still eligible on the next run. */
  capped: Sendable[];
}

/**
 * Key a property so two files on the same address collapse to one ask.
 *
 * Production shipped 20021227-OCT and -PRV (both 8613 Bonita Rd) and
 * 20021320-OCT and -PRV (both 223 Lincoln Ave) in the same run: the same escrow
 * officer, the same property, the same listing agent, asked twice. From an inbox
 * that is a duplicate send, whatever the file numbers say.
 *
 * Punctuation and case are stripped because the same address arrives written
 * several ways ("127 Avenida De La Paz,," has a double comma in production).
 * Anything shorter than a plausible address returns null and never groups —
 * collapsing two unrelated files would suppress a real ask, which is worse than
 * sending twice.
 */
export function propertyKey(row: CandidateRow): string | null {
  const address = composeAddress(row);
  if (!address) return null;
  const normalized = address.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  return normalized.length >= 6 ? normalized : null;
}

export function planSends(reachable: Sendable[], invitedProperties: Set<string>): PartyInvitePlan {
  const plan: PartyInvitePlan = { sending: [], duplicates: [], capped: [] };

  // Lowest order id first, so which sibling file carries the ask is stable across
  // runs rather than whatever order the database happened to return.
  const ordered = [...reachable].sort((a, b) => a.row.orderId - b.row.orderId);

  const askedThisRun = new Map<string, string>();
  const perRecipient = new Map<string, number>();

  for (const item of ordered) {
    const key = propertyKey(item.row);

    if (key) {
      if (invitedProperties.has(key)) {
        plan.duplicates.push({ ...item, duplicateOf: null });
        continue;
      }
      const owner = askedThisRun.get(key);
      if (owner) {
        plan.duplicates.push({ ...item, duplicateOf: owner });
        continue;
      }
    }

    // Cap after dedupe: a duplicate must not consume one of a recipient's two
    // slots, or the cap would suppress a real ask to spare a redundant one.
    const alreadySending = perRecipient.get(item.to) ?? 0;
    if (alreadySending >= PARTY_INVITE_MAX_PER_RECIPIENT) {
      plan.capped.push(item);
      continue;
    }

    // Claimed only on an actual send. A capped order has not asked anything, so
    // claiming its property here would make its sibling a duplicate of an ask
    // nobody made — and both would then sit unasked forever.
    if (key) askedThisRun.set(key, item.row.fileNumber);
    perRecipient.set(item.to, alreadySending + 1);
    plan.sending.push(item);
  }

  return plan;
}

/**
 * Properties that already received an invite, so a second file on the same
 * address does not ask again on a later run.
 *
 * The per-order suppression (no prior notification_logs row) cannot catch this:
 * -OCT and -PRV are different orders, and a sibling file opened a day later is a
 * fresh candidate with a clean log.
 */
async function loadInvitedProperties(): Promise<Set<string>> {
  try {
    const rows = await db.execute(sql`
      select distinct op.full_address, op.address, op.city, op.state, op.zip
      from notification_logs nl
      join order_properties op on op.order_id = nl.order_id
      where nl.event_type = 'party_wizard.invite'
        and nl.created_at >= now() - (${PARTY_INVITE_PROPERTY_LOOKBACK_DAYS} * interval '1 day')
    `) as unknown as Array<{
      full_address: string | null; address: string | null;
      city: string | null; state: string | null; zip: string | null;
    }>;

    const keys = new Set<string>();
    for (const r of rows) {
      const key = propertyKey({
        fullAddress: r.full_address, address: r.address,
        city: r.city, state: r.state, zip: r.zip,
      } as CandidateRow);
      if (key) keys.add(key);
    }
    return keys;
  } catch {
    // An unreadable history must not turn into a second ask on every property.
    // Failing closed here would silence the job entirely, so it fails open and
    // relies on the per-order suppression that has always been there.
    return new Set();
  }
}

// ─── Dry-run reporting ───────────────────────────────────────────────────────

/** Stands in for the URL a real send would carry. Never a working link. */
const DRY_RUN_LINK_PLACEHOLDER = 'https://example.invalid/party-wizard/DRY-RUN-NO-LINK-MINTED';

function templateInput(row: CandidateRow) {
  return {
    fileNumber: row.fileNumber,
    propertyAddress: composeAddress(row),
    transactionType: row.transactionType,
    escrowOfficerName: row.escrowOfficerName,
    openedAt: row.openedAt,
  };
}

/**
 * A dry run reports on rows it cannot fully read rather than aborting. One order
 * with an unusable opened_at must not cost the operator the other 99.
 */
function usableDate(openedAt: Date | null | undefined): Date | null {
  return openedAt instanceof Date && Number.isFinite(openedAt.getTime()) ? openedAt : null;
}

function reportRow(
  row: CandidateRow,
  outcome: PartyInviteOutcome,
  linkAction: PartyInviteReportRow['linkAction'],
): PartyInviteReportRow {
  const opened = usableDate(row.openedAt);
  return {
    orderId: row.orderId,
    fileNumber: row.fileNumber,
    openedAt: opened ? opened.toISOString() : null,
    ageDays: opened ? Math.floor((Date.now() - opened.getTime()) / 86_400_000) : null,
    transactionType: row.transactionType,
    propertyAddress: composeAddress(row),
    recipientEmail: row.escrowOfficerEmail?.trim() || null,
    recipientName: row.escrowOfficerName,
    recipientRole: 'escrow_officer',
    outcome,
    linkRoles: [PARTY_INVITE_ROLE],
    linkAction,
    subject: null,
  };
}

interface RenderedPreview {
  row: PartyInviteReportRow;
  /** Absent when the template threw — the row carries the reason instead. */
  rendered: { subject: string; html: string; text: string; linkPlaceholder: string } | null;
}

function renderPreview(row: CandidateRow): RenderedPreview {
  const base = reportRow(row, 'would_send', 'would_mint');
  const input = {
    ...templateInput(row),
    roleLinks: [{ role: PARTY_INVITE_ROLE, url: DRY_RUN_LINK_PLACEHOLDER }],
  };
  try {
    const subject = buildPartyWizardSubject(input);
    base.subject = subject;
    return {
      row: base,
      rendered: {
        subject,
        html: buildPartyWizardEmail(input),
        text: buildPartyWizardText(input),
        linkPlaceholder: DRY_RUN_LINK_PLACEHOLDER,
      },
    };
  } catch (err) {
    base.templateError = err instanceof Error ? err.message : 'template failed to render';
    return { row: base, rendered: null };
  }
}

/**
 * Record the run on its own jobs row, the way the drift detector and the
 * look-back sweep do. This is what makes a REFUSAL durable: without it, a job
 * that declined to send leaves a `completed` row and no reason, which is
 * indistinguishable from a run that found nothing to do.
 *
 * The report is deliberately excluded — a dry run is read from its HTTP response
 * in admin, and 100 rows of recipient detail do not belong in a job payload.
 */
async function recordRun(
  payload: PartyInvitePayload,
  result: PartyInviteResult,
): Promise<void> {
  const jobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  if (jobId === null) return;
  const { report: _report, sampleEmail: _sampleEmail, ...summary } = result;
  try {
    await db
      .update(jobs)
      .set({ payload: { ...payload, __jobId: undefined, partyWizardInvite: summary } })
      .where(eq(jobs.id, jobId));
  } catch {
    /* trending is best-effort; never fail the run over it */
  }
}
