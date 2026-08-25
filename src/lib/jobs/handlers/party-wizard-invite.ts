import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, jobs, orderProperties, orders } from '@/lib/db/schema';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { getSetting } from '@/lib/domain/settings/service';
import { insertNotificationLog } from '@/lib/domain/notifications/dispatch';
import {
  buildPartyWizardEmail, buildPartyWizardSubject, buildPartyWizardText,
} from '@/lib/domain/parties/party-wizard-email';
import { findLiveLink, mintLinkForOrder } from '@/lib/domain/parties/party-wizard-service';
import type { PartyRole } from '@/lib/domain/parties/party-wizard-fields';
import { ACTIVE_ORDER_STATUSES, statusSqlList } from '@/lib/domain/orders/status-map';

// ─── Party wizard invite ─────────────────────────────────────────────────────
//
// Three days after an order opens, if we still have no listing agent, email the
// ESCROW OFFICER a forwardable link.
//
// WHY DAY 3, AND WHY THIS IS MEASURED. Only ~54% of orders have an escrow
// officer email by day 3. That is not a reason to wait longer — it is the
// finding. The job therefore does NOT quietly skip what it cannot reach: every
// unreachable order is counted by reason and returned, so the gap trends
// weekly instead of disappearing into a log line.
//
// The counters are the deliverable as much as the emails are.

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

export interface PartyInviteUnreachable {
  /** Why we could not send. Each is a distinct operational problem. */
  noEscrowOfficer: number;
  escrowOfficerNoEmail: number;
}

/** Why an order appears in a dry-run report the way it does. */
export type PartyInviteOutcome =
  | 'would_send'
  | 'skipped_existing_link'
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
  /** Roles the invite would carry a link for. */
  linkRoles: PartyRole[];
  linkAction: 'would_mint' | 'live_link_exists' | 'none';
  /** Rendered from the real template, so a broken template fails the dry run. */
  subject: string | null;
  templateError?: string;
}

export interface PartyInviteResult {
  scanned: number;
  sent: number;
  failed: number;
  skippedExistingLink: number;
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
 * Orders opened between 3 and 30 days ago with no listing agent on file and no
 * invite already sent.
 *
 * The upper bound matters: without it, every historical order with a missing
 * agent would be emailed the first time this runs.
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
    unreachable: { noEscrowOfficer: 0, escrowOfficerNoEmail: 0 },
    reachablePct: 0,
    enabled,
    dryRun,
  };

  if (dryRun) {
    result.report = [];
    result.reportNote = REPORT_NOTE;
  }

  for (const row of candidates) {
    // Count what we cannot reach, by reason, BEFORE doing any work — an
    // unreachable order must never look like a silent success.
    if (!row.escrowOfficerId) {
      result.unreachable.noEscrowOfficer++;
      result.report?.push(reportRow(row, 'no_escrow_officer', 'none'));
      continue;
    }
    const to = row.escrowOfficerEmail?.trim();
    if (!to) {
      result.unreachable.escrowOfficerNoEmail++;
      result.report?.push(reportRow(row, 'officer_no_email', 'none'));
      continue;
    }

    // A live link means an invite is already in flight for this role.
    if (await findLiveLink(row.orderId, PARTY_INVITE_ROLE)) {
      result.skippedExistingLink++;
      result.report?.push(reportRow(row, 'skipped_existing_link', 'live_link_exists'));
      continue;
    }

    // A dry run stops here: everything below this line either writes a link row
    // or sends mail. The templates are still rendered against the same input, so
    // a template that throws fails the dry run instead of the first real send.
    if (dryRun) {
      result.report!.push(renderPreview(row));
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
    + `unreachable_no_officer=${result.unreachable.noEscrowOfficer} `
    + `unreachable_no_email=${result.unreachable.escrowOfficerNoEmail} `
    + `reachable=${result.reachablePct}%`,
  );

  await recordRun(payload, result);

  return result;
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

function renderPreview(row: CandidateRow): PartyInviteReportRow {
  const base = reportRow(row, 'would_send', 'would_mint');
  const input = {
    ...templateInput(row),
    roleLinks: [{ role: PARTY_INVITE_ROLE, url: DRY_RUN_LINK_PLACEHOLDER }],
  };
  try {
    base.subject = buildPartyWizardSubject(input);
    buildPartyWizardEmail(input);
    buildPartyWizardText(input);
  } catch (err) {
    base.templateError = err instanceof Error ? err.message : 'template failed to render';
  }
  return base;
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
  const { report: _report, ...summary } = result;
  try {
    await db
      .update(jobs)
      .set({ payload: { ...payload, __jobId: undefined, partyWizardInvite: summary } })
      .where(eq(jobs.id, jobId));
  } catch {
    /* trending is best-effort; never fail the run over it */
  }
}
