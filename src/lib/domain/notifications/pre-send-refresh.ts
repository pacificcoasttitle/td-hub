/**
 * Re-read an order's contacts from SoftPro immediately before we send a document.
 *
 * ─── THE RULE (Gerard, 2026-09-16) ──────────────────────────────────────────
 *
 * SoftPro is the system of record. When SoftPro and we disagree about who a
 * document goes to, SoftPro's address is the right answer, not the risky one:
 *
 *   - AGREES            send to that address.
 *   - DIFFERS           send to SoftPro's address AND write that address onto
 *                       this order's party row. Record the disagreement once
 *                       (history, not an open queue). Alert once. Leaving our
 *                       row stale is how the same alert fired on every later
 *                       send — Diana stayed on the order, Jessica got the
 *                       document, Gerard heard about it again.
 *   - SOFTPRO HAS NONE  do not substitute ours. That recipient is unresolved:
 *                       the caller's existing fail-closed path runs — no send,
 *                       internal alert. The field we ask depends on order type:
 *                       Title-only reads EscrowCompanies (GetOrderContacts).
 *                       Title & Escrow / Escrow-only read EscrowOfficerContact
 *                       (GetOrderDetails). Asking EscrowCompanies on an in-house
 *                       file treats a structural empty as "no recipient" and
 *                       holds 711 of 883. Absence of the officer field still holds.
 *   - UNREACHABLE       retry once, then send as we would have, and record that
 *                       the refresh did not happen. Vendor availability must not
 *                       block the business, and must be visible when it does not.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It changes who THIS send goes to, and it updates this order's party snapshot
 * so the hub matches SoftPro. It does not write the shared contacts book —
 * Diana's row is on more than one order. The party list prefers the book
 * email, so a differing book link is detached and the SoftPro snapshot shows.
 *
 * ─── MEASURED BEFORE BUILDING ───────────────────────────────────────────────
 *
 * 39 orders that received a prelim in the 30 days to 2026-09-16: 35 agreed with
 * SoftPro's escrow person, 4 differed (three of them a different firm), 0 had no
 * SoftPro address. The "has none" edge case is rare on documents, not a queue.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs, contacts, eventOutbox, orderContactDrift, orderParties } from '@/lib/db/schema';
import { expectsPctEscrowOfficer } from '@/lib/domain/orders/escrow-officer-expectation';
import { protectConfirmedPartyFields } from '@/lib/domain/parties/party-confirmation';
import {
  getOrderContacts,
  getOrderDetails,
  mapOrderContacts,
  type MappedOrderContacts,
  type MappedResolvedParty,
  type SoftProOrderDetailItem,
  type SoftProResolvedPerson,
} from '@/lib/integrations/softpro';
import {
  calloutBar, emailShell, esc, fieldTable, sectionLabel,
} from './email-layout';

/** Per attempt. GetOrderContacts p50 2.0s, p95 3.7s, p99 32.5s over 7 days. */
export const PRE_SEND_TIMEOUT_MS = 15_000;

/** Slug AND dispatch event type (migration 0052). */
export const CONTACT_DRIFT_ALERT_EVENT_TYPE = 'order.contacts.drift';

export type PreSendRole = 'escrow' | 'lender' | 'owner';

export const PRE_SEND_PARTY_ROLE = {
  escrow: 'escrow_company',
  lender: 'lender',
  owner: 'buyer',
} as const;

export type PreSendKind = 'prelim' | 'lender_policy' | 'owner_policy' | 'supplement';

/** Which SoftPro field answers "who is escrow" for this order type. */
export function escrowPreSendSource(orderType: string | null | undefined): 'escrow_company' | 'escrow_officer' {
  return expectsPctEscrowOfficer(orderType) ? 'escrow_officer' : 'escrow_company';
}

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

/**
 * Title & Escrow / Escrow-only: SoftPro's answer is EscrowOfficerContact, a
 * person. There is no company inbox to fall back to.
 */
export function decideOfficerRecipient(
  candidate: PreSendCandidate,
  officer: SoftProResolvedPerson | null | undefined,
): PreSendDecision {
  const person = norm(officer?.Email);
  const ours = norm(candidate.email);

  if (ours && ours === person) {
    return { role: candidate.role, status: 'agrees', email: ours, name: candidate.name };
  }

  if (!EMAIL.test(person)) {
    return { role: candidate.role, status: 'softpro_has_none', ours: ours || null };
  }

  return {
    role: candidate.role,
    status: 'differs',
    email: person,
    name: officer?.Name?.trim() || candidate.name,
    ours: ours || null,
  };
}

export function detailForFile(
  items: SoftProOrderDetailItem[] | null | undefined,
  fileNumber: string,
): SoftProOrderDetailItem | null {
  if (!items?.length) return null;
  return items.find((item) => item.OrderNumber === fileNumber) ?? items[0] ?? null;
}

export type SoftProPartyExisting = {
  partyConfirmedAt: Date | string | null;
  externalEmail: string | null;
  externalName: string | null;
  contactId: number | null;
  bookEmail: string | null;
};

/**
 * What we write onto THIS order's party when SoftPro disagrees.
 *
 * The shared contacts book is not touched: Diana's contact sits on two orders.
 * The party list prefers the book email, so a book link whose email is not
 * SoftPro's is detached and the snapshot becomes what the screen shows.
 *
 * A human-confirmed party still goes through protectConfirmedPartyFields.
 */
export function planSoftProPartyPatch(
  existing: SoftProPartyExisting | null,
  softproEmail: string,
  softproName: string | null,
): { apply: boolean; patch: { externalEmail?: string; externalName?: string }; detachContact: boolean } {
  const proposed = {
    externalEmail: softproEmail,
    ...(softproName?.trim() ? { externalName: softproName.trim() } : {}),
  };
  const patch = protectConfirmedPartyFields(existing, proposed);
  if (!patch.externalEmail) {
    return { apply: false, patch: {}, detachContact: false };
  }
  const detachContact = !!existing?.contactId && norm(existing.bookEmail) !== norm(softproEmail);
  return { apply: true, patch, detachContact };
}

export async function applySoftProRecipientToOrderParty(input: {
  orderId: number;
  role: PreSendRole;
  email: string;
  name: string | null;
}): Promise<boolean> {
  const role = PRE_SEND_PARTY_ROLE[input.role];
  const [row] = await db
    .select({
      id: orderParties.id,
      partyConfirmedAt: orderParties.partyConfirmedAt,
      externalEmail: orderParties.externalEmail,
      externalName: orderParties.externalName,
      contactId: orderParties.contactId,
      bookEmail: contacts.email,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(contacts.id, orderParties.contactId))
    .where(and(
      eq(orderParties.orderId, input.orderId),
      eq(orderParties.role, role),
      eq(orderParties.isPrimary, true),
    ))
    .limit(1);

  const plan = planSoftProPartyPatch(row ?? null, input.email, input.name);
  if (!plan.apply) return false;

  if (row) {
    await db.update(orderParties)
      .set({
        ...(plan.patch.externalEmail ? { externalEmail: plan.patch.externalEmail } : {}),
        ...(plan.patch.externalName ? { externalName: plan.patch.externalName } : {}),
        ...(plan.detachContact ? { contactId: null } : {}),
      })
      .where(eq(orderParties.id, row.id));
    return true;
  }

  await db.insert(orderParties).values({
    orderId: input.orderId,
    role,
    isPrimary: true,
    externalEmail: plan.patch.externalEmail ?? input.email,
    externalName: plan.patch.externalName ?? input.name,
  });
  return true;
}

export interface PreSendDeps {
  fetchContacts?: typeof getOrderContacts;
  fetchDetails?: typeof getOrderDetails;
  record?: typeof recordPreSendOutcome;
}

export interface PreSendInput {
  orderId: number;
  fileNumber: string;
  sendKind: PreSendKind;
  orderType?: string | null;
  candidates: PreSendCandidate[];
}

async function fetchWithRetry<T>(
  run: () => Promise<{ success: boolean; data?: T | null; error?: { message?: string } }>,
  emptyMessage: string,
): Promise<{ value: T | null; error: string }> {
  let lastError = emptyMessage;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await run();
      if (result.success && result.data) return { value: result.data, error: lastError };
      lastError = result.error?.message ?? lastError;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { value: null, error: lastError };
}

/**
 * Refresh every candidate for one send. Title-only escrow (and lender/owner)
 * is one GetOrderContacts call. In-house escrow is one GetOrderDetails call
 * for EscrowOfficerContact. A mixed policy line may make both. Each is
 * retried once. Never throws: an unreachable vendor is a decision, not an
 * exception, and recording is best-effort.
 */
export async function refreshBeforeSend(input: PreSendInput, deps: PreSendDeps = {}): Promise<PreSendDecision[]> {
  const fetchContacts = deps.fetchContacts ?? getOrderContacts;
  const fetchDetails = deps.fetchDetails ?? getOrderDetails;
  const record = deps.record ?? recordPreSendOutcome;
  const source = escrowPreSendSource(input.orderType);
  const needsOfficer = source === 'escrow_officer' && input.candidates.some((c) => c.role === 'escrow');
  const needsContacts = input.candidates.some((c) => c.role !== 'escrow' || source === 'escrow_company');

  let mapped: MappedOrderContacts | null = null;
  let contactsError = 'GetOrderContacts returned no data';
  if (needsContacts) {
    const fetched = await fetchWithRetry(
      () => fetchContacts(input.fileNumber, { timeoutMs: PRE_SEND_TIMEOUT_MS }),
      contactsError,
    );
    mapped = fetched.value ? mapOrderContacts(fetched.value) : null;
    contactsError = fetched.error;
  }

  let officer: SoftProResolvedPerson | null | undefined;
  let detailsError = 'GetOrderDetails returned no data';
  let detailsReached = !needsOfficer;
  if (needsOfficer) {
    const fetched = await fetchWithRetry(
      () => fetchDetails({
        dateFrom: '',
        orderNumber: input.fileNumber,
        orderId: input.orderId,
        timeoutMs: PRE_SEND_TIMEOUT_MS,
      }),
      detailsError,
    );
    const detail = detailForFile(fetched.value ?? undefined, input.fileNumber);
    detailsReached = !!detail;
    officer = detail?.EscrowOfficerContact ?? null;
    detailsError = fetched.error;
  }

  const decisions: PreSendDecision[] = input.candidates.map((c) => {
    if (c.role === 'escrow' && source === 'escrow_officer') {
      if (!detailsReached) {
        return { role: c.role, status: 'unreachable' as const, email: c.email, name: c.name, error: detailsError };
      }
      return decideOfficerRecipient(c, officer);
    }
    if (!mapped) {
      return { role: c.role, status: 'unreachable' as const, email: c.email, name: c.name, error: contactsError };
    }
    return decideRecipient(c, mapped);
  });

  try {
    await record(input, decisions);
  } catch {
    // The send is what matters. A failure to record must not stop it.
  }
  return decisions;
}

/**
 * Persist what the refresh found, write SoftPro's address onto this order
 * when it differs, and alert the first time only.
 *
 * - agrees            closes any open drift row for that role as converged
 * - differs           writes the order party, records history, resolves as
 *                     applied_softpro, alerts if this disagreement is new
 * - softpro_has_none  records history, alerts if new — no write (nothing to write)
 * - unreachable       an activity row — the refresh did not happen for this send
 */
export async function recordPreSendOutcome(input: PreSendInput, decisions: PreSendDecision[]): Promise<void> {
  const now = new Date();
  const notable: PreSendDecision[] = [];

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

    let applied = false;
    const writeParty = d.status === 'differs'
      && !(d.role === 'escrow' && escrowPreSendSource(input.orderType) === 'escrow_officer');
    if (writeParty && d.status === 'differs') {
      try {
        applied = await applySoftProRecipientToOrderParty({
          orderId: input.orderId,
          role: d.role,
          email: d.email,
          name: d.name,
        });
      } catch {
        applied = false;
      }
    }

    const [open] = await db
      .select({ id: orderContactDrift.id })
      .from(orderContactDrift)
      .where(and(
        eq(orderContactDrift.orderId, input.orderId),
        eq(orderContactDrift.role, d.role),
        eq(orderContactDrift.field, 'email'),
        isNull(orderContactDrift.resolvedAt),
      ))
      .limit(1);

    const firstSeen = !open;
    const resolution = d.status === 'differs' && applied ? 'applied_softpro' : null;

    if (open) {
      await db.update(orderContactDrift)
        .set({
          kind: d.status,
          sendKind: input.sendKind,
          ours: d.ours,
          softpro: d.status === 'differs' ? d.email : null,
          lastSeenAt: now,
          timesSeen: sql`${orderContactDrift.timesSeen} + 1`,
          ...(resolution ? { resolvedAt: now, resolution } : {}),
        })
        .where(eq(orderContactDrift.id, open.id));
    } else {
      await db.insert(orderContactDrift).values({
        orderId: input.orderId,
        role: d.role,
        field: 'email',
        kind: d.status,
        source: 'pre_send',
        sendKind: input.sendKind,
        ours: d.ours,
        softpro: d.status === 'differs' ? d.email : null,
        ...(resolution ? { resolvedAt: now, resolution } : {}),
      });
    }

    if (firstSeen) notable.push(d);
  }

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
      : '<strong>The document went to the address SoftPro holds, and the hub contact on this order was updated to match.</strong> '
      + 'SoftPro is the system of record. The previous hub address is kept on the drift row.';

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
