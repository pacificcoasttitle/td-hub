import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orderProperties, orders } from '@/lib/db/schema';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { getSetting } from '@/lib/domain/settings/service';
import { insertNotificationLog } from '@/lib/domain/notifications/dispatch';
import {
  buildPartyWizardEmail, buildPartyWizardSubject, buildPartyWizardText,
} from '@/lib/domain/parties/party-wizard-email';
import { findLiveLink, mintLinkForOrder } from '@/lib/domain/parties/party-wizard-service';
import type { PartyRole } from '@/lib/domain/parties/party-wizard-fields';

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
export const PARTY_INVITE_MAX_AGE_DAYS = 30;
export const PARTY_INVITE_BATCH = 100;
export const PARTY_INVITE_ROLE: PartyRole = 'listing_agent';

/** Runtime kill switch. DB-backed so stopping it needs no redeploy. */
export const PARTY_INVITE_SHUT_OFF_SETTING = 'party_wizard_invite_shut_off';

export interface PartyInviteUnreachable {
  /** Why we could not send. Each is a distinct operational problem. */
  noEscrowOfficer: number;
  escrowOfficerNoEmail: number;
}

export interface PartyInviteResult {
  scanned: number;
  sent: number;
  failed: number;
  skippedExistingLink: number;
  unreachable: PartyInviteUnreachable;
  /** Share of candidates we could actually reach. The number to watch. */
  reachablePct: number;
  shutOff?: true;
}

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
      eq(orders.operationalStatus, 'open'),
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

export async function handlePartyWizardInvite(): Promise<PartyInviteResult> {
  const shutOff = await getSetting(PARTY_INVITE_SHUT_OFF_SETTING);
  if (shutOff === 'true') {
    return {
      scanned: 0, sent: 0, failed: 0, skippedExistingLink: 0,
      unreachable: { noEscrowOfficer: 0, escrowOfficerNoEmail: 0 },
      reachablePct: 0, shutOff: true,
    };
  }

  const candidates = await loadCandidates(PARTY_INVITE_BATCH);

  const result: PartyInviteResult = {
    scanned: candidates.length,
    sent: 0,
    failed: 0,
    skippedExistingLink: 0,
    unreachable: { noEscrowOfficer: 0, escrowOfficerNoEmail: 0 },
    reachablePct: 0,
  };

  for (const row of candidates) {
    // Count what we cannot reach, by reason, BEFORE doing any work — an
    // unreachable order must never look like a silent success.
    if (!row.escrowOfficerId) {
      result.unreachable.noEscrowOfficer++;
      continue;
    }
    const to = row.escrowOfficerEmail?.trim();
    if (!to) {
      result.unreachable.escrowOfficerNoEmail++;
      continue;
    }

    // A live link means an invite is already in flight for this role.
    if (await findLiveLink(row.orderId, PARTY_INVITE_ROLE)) {
      result.skippedExistingLink++;
      continue;
    }

    const minted = await mintLinkForOrder(row.orderId, PARTY_INVITE_ROLE);
    if (!minted) {
      result.failed++;
      continue;
    }

    const input = {
      fileNumber: row.fileNumber,
      propertyAddress: composeAddress(row),
      transactionType: row.transactionType,
      escrowOfficerName: row.escrowOfficerName,
      openedAt: row.openedAt,
      roleLinks: [{ role: PARTY_INVITE_ROLE, url: minted.url }],
    };

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
    `[party-wizard-invite] scanned=${result.scanned} sent=${result.sent} failed=${result.failed} `
    + `skipped_existing=${result.skippedExistingLink} `
    + `unreachable_no_officer=${result.unreachable.noEscrowOfficer} `
    + `unreachable_no_email=${result.unreachable.escrowOfficerNoEmail} `
    + `reachable=${result.reachablePct}%`,
  );

  return result;
}
