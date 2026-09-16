/**
 * Re-read an order's contacts from SoftPro immediately before we send a document.
 *
 * ─── THE RULE (Gerard, 2026-09-16) ──────────────────────────────────────────
 *
 * SoftPro is the system of record. When SoftPro and we disagree about who a
 * document goes to, SoftPro's address is the right answer, not the risky one:
 *
 *   - AGREES            send to that address.
 *   - DIFFERS           send to SoftPro's address. Record the disagreement and
 *                       alert, so the send is correct AND the drift is visible.
 *                       No hold queue: a queue that depends on somebody noticing
 *                       gets noticed for about a week.
 *   - SOFTPRO HAS NONE  do not substitute ours. That recipient is unresolved:
 *                       the caller's existing fail-closed path runs — no send,
 *                       internal alert.
 *   - UNREACHABLE       retry once, then send as we would have, and record that
 *                       the refresh did not happen. Vendor availability must not
 *                       block the business, and must be visible when it does not.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It changes who THIS send goes to. It does not write SoftPro's address over our
 * party rows: a disagreement is recorded, not silently resolved, so the drift
 * rate stays measurable (docs/tickets/ORDER_CONTACT_REFRESH.md).
 *
 * ─── MEASURED BEFORE BUILDING ───────────────────────────────────────────────
 *
 * 39 orders that received a prelim in the 30 days to 2026-09-16: 35 agreed with
 * SoftPro's escrow person, 4 differed (three of them a different firm), 0 had no
 * SoftPro address. The "has none" edge case is rare on documents, not a queue.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs, eventOutbox, orderContactDrift } from '@/lib/db/schema';
import {
  getOrderContacts,
  mapOrderContacts,
  type MappedOrderContacts,
  type MappedResolvedParty,
} from '@/lib/integrations/softpro';
import {
  calloutBar, emailShell, esc, fieldTable, sectionLabel,
} from './email-layout';

/** Per attempt. GetOrderContacts p50 2.0s, p95 3.7s, p99 32.5s over 7 days. */
export const PRE_SEND_TIMEOUT_MS = 15_000;

/** Slug AND dispatch event type (migration 0052). */
export const CONTACT_DRIFT_ALERT_EVENT_TYPE = 'order.contacts.drift';

export type PreSendRole = 'escrow' | 'lender' | 'owner';

export type PreSendKind = 'prelim' | 'lender_policy' | 'owner_policy' | 'supplement';

export interface PreSendCandidate {
  role: PreSendRole;
  email: string | null;
  name: string | null;
}

export type PreSendDecision =
  | { role: PreSendRole; status: 'agrees'; email: string; name: string | null }
  | { role: PreSendRole; status: 'differs'; email: string; name: string | null; ours: string | null }
  | { role: PreSendRole; status: 'softpro_has_none'; ours: string | null }
  | { role: PreSendRole; status: 'unreachable'; email: string | null; name: string | null; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** The SoftPro party that corresponds to one of our recipient roles. */
export function softproPartyFor(mapped: MappedOrderContacts, role: PreSendRole): MappedResolvedParty | null {
  switch (role) {
    case 'escrow': return mapped.parties.escrowCompany;
    case 'lender': return mapped.parties.lender;
    case 'owner': return mapped.parties.buyer;
  }
}

/**
 * One recipient, one decision. Pure.
 *
 * "Agrees" accepts either the person's or the company's email: we often hold the
 * escrow company's inbox where SoftPro holds the officer, and that is the same
 * firm, not a disagreement. When they differ, the person's email is preferred —
 * that is who the document is for — and the company's is the fallback.
 */
export function decideRecipient(candidate: PreSendCandidate, mapped: MappedOrderContacts): PreSendDecision {
  const party = softproPartyFor(mapped, candidate.role);
  const person = norm(party?.email);
  const company = norm(party?.companyEmail);
  const ours = norm(candidate.email);

  if (ours && (ours === person || ours === company)) {
    return { role: candidate.role, status: 'agrees', email: ours, name: candidate.name };
  }

  const softpro = EMAIL.test(person) ? person : EMAIL.test(company) ? company : '';
  if (!softpro) {
    return { role: candidate.role, status: 'softpro_has_none', ours: ours || null };
  }

  return {
    role: candidate.role,
    status: 'differs',
    email: softpro,
    name: (softpro === person ? party?.name : party?.companyName) ?? party?.name ?? party?.companyName ?? candidate.name,
    ours: ours || null,
  };
}

export interface PreSendDeps {
  fetchContacts?: typeof getOrderContacts;
  record?: typeof recordPreSendOutcome;
}

export interface PreSendInput {
  orderId: number;
  fileNumber: string;
  sendKind: PreSendKind;
  candidates: PreSendCandidate[];
}

/**
 * Refresh every candidate for one send, with ONE SoftPro call (retried once).
 * Never throws: an unreachable vendor is a decision, not an exception, and
 * recording is best-effort.
 */
export async function refreshBeforeSend(input: PreSendInput, deps: PreSendDeps = {}): Promise<PreSendDecision[]> {
  const fetchContacts = deps.fetchContacts ?? getOrderContacts;
  const record = deps.record ?? recordPreSendOutcome;

  let mapped: MappedOrderContacts | null = null;
  let lastError = 'GetOrderContacts returned no data';
  for (let attempt = 0; attempt < 2 && !mapped; attempt++) {
    try {
      const result = await fetchContacts(input.fileNumber, { timeoutMs: PRE_SEND_TIMEOUT_MS });
      if (result.success && result.data) {
        mapped = mapOrderContacts(result.data);
      } else {
        lastError = result.error?.message ?? lastError;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const decisions: PreSendDecision[] = mapped
    ? input.candidates.map((c) => decideRecipient(c, mapped!))
    : input.candidates.map((c) => ({
      role: c.role, status: 'unreachable' as const, email: c.email, name: c.name, error: lastError,
    }));

  try {
    await record(input, decisions);
  } catch {
    // The send is what matters. A failure to record must not stop it.
  }
  return decisions;
}

/**
 * Persist what the refresh found, and alert when a send is going somewhere our
 * records did not say, or cannot go anywhere.
 *
 * - agrees            closes any open drift row for that role as converged
 * - differs / none    opens or updates the one open row per (order, role, field)
 * - unreachable       an activity row — the refresh did not happen for this send
 */
export async function recordPreSendOutcome(input: PreSendInput, decisions: PreSendDecision[]): Promise<void> {
  const now = new Date();

  for (const d of decisions) {
    if (d.status === 'agrees') {
      await db.update(orderContactDrift)
        .set({ resolvedAt: now, resolution: 'converged', lastSeenAt: now })
        .where(and(
          eq(orderContactDrift.orderId, input.orderId),
          eq(orderContactDrift.role, d.role),
          eq(orderContactDrift.field, 'email'),
          isNull(orderContactDrift.resolvedAt),
        ));
      continue;
    }

    if (d.status === 'unreachable') {
      await db.insert(adminActivityLogs).values({
        userId: 'system:pre_send_refresh',
        action: 'pre_send_refresh_unavailable',
        entityType: 'order',
        entityId: input.fileNumber,
        meta: { orderId: input.orderId, sendKind: input.sendKind, role: d.role, sentTo: d.email, error: d.error },
      });
      continue;
    }

    await db.insert(orderContactDrift)
      .values({
        orderId: input.orderId,
        role: d.role,
        field: 'email',
        kind: d.status,
        source: 'pre_send',
        sendKind: input.sendKind,
        ours: d.ours,
        softpro: d.status === 'differs' ? d.email : null,
      })
      .onConflictDoUpdate({
        target: [orderContactDrift.orderId, orderContactDrift.role, orderContactDrift.field],
        targetWhere: isNull(orderContactDrift.resolvedAt),
        set: {
          kind: d.status,
          sendKind: input.sendKind,
          ours: d.ours,
          softpro: d.status === 'differs' ? d.email : null,
          lastSeenAt: now,
          timesSeen: sql`${orderContactDrift.timesSeen} + 1`,
        },
      });
  }

  const notable = decisions.filter((d) => d.status === 'differs' || d.status === 'softpro_has_none');
  if (notable.length === 0) return;

  const { subject, html } = buildContactDriftAlertEmail({
    orderId: input.orderId,
    fileNumber: input.fileNumber,
    sendKind: input.sendKind,
    decisions: notable,
  });
  await db.insert(eventOutbox).values({
    eventType: CONTACT_DRIFT_ALERT_EVENT_TYPE,
    orderId: input.orderId,
    payload: { subject, html, fileNumber: input.fileNumber, sendKind: input.sendKind },
  });
}

const SEND_LABEL: Record<PreSendKind, string> = {
  prelim: 'Preliminary report',
  lender_policy: "Lender's policy",
  owner_policy: "Owner's policy",
  supplement: 'Supplemental report',
};

const ROLE_LABEL: Record<PreSendRole, string> = { escrow: 'Escrow', lender: 'Lender', owner: 'Owner' };

export function buildContactDriftAlertEmail(input: {
  orderId: number;
  fileNumber: string;
  sendKind: PreSendKind;
  decisions: PreSendDecision[];
}): { subject: string; html: string } {
  const none = input.decisions.some((d) => d.status === 'softpro_has_none');
  const label = SEND_LABEL[input.sendKind];
  const subject = none
    ? `${label} not sent — SoftPro has no recipient — ${input.fileNumber}`
    : `${label} sent to SoftPro's contact, not ours — ${input.fileNumber}`;

  const rows = input.decisions.flatMap((d) => {
    if (d.status === 'differs') {
      return [
        { label: `${ROLE_LABEL[d.role]} — ours`, valueHtml: esc(d.ours ?? 'none') },
        { label: `${ROLE_LABEL[d.role]} — SoftPro`, valueHtml: esc(d.email) },
        { label: 'Sent to', valueHtml: esc(d.email) },
      ];
    }
    if (d.status === 'softpro_has_none') {
      return [
        { label: `${ROLE_LABEL[d.role]} — ours`, valueHtml: esc(d.ours ?? 'none') },
        { label: `${ROLE_LABEL[d.role]} — SoftPro`, valueHtml: 'no email on file' },
        { label: 'Sent to', valueHtml: 'not sent' },
      ];
    }
    return [];
  });

  const callout = none
    ? '<strong>SoftPro holds no email for this recipient, so the document was not sent.</strong> '
      + 'Our address was not used in its place: SoftPro is the system of record. '
      + 'Add the contact in SoftPro and the next delivery attempt will use it.'
    : '<strong>The document went to the address SoftPro holds.</strong> '
      + 'Our records had a different contact for this order. Nothing in the hub was changed — '
      + 'check whether the order\'s contact in the hub is out of date.';

  return {
    subject,
    html: emailShell({
      title: subject,
      badge: none ? 'Not sent' : 'Contact differs',
      preheader: `${label} for ${input.fileNumber}: SoftPro and the hub disagree on the recipient.`,
      hero: {
        icon: '!',
        eyebrow: 'Contact check before sending',
        headline: none ? 'No recipient in SoftPro' : 'Sent to SoftPro\'s contact',
        subcopy: 'The hub re-reads SoftPro immediately before sending a document.',
      },
      bodyHtml: [sectionLabel(`${label} — ${input.fileNumber}`), fieldTable(rows), calloutBar(callout)].join(''),
    }),
  };
}
