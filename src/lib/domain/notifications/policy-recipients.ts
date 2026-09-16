import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orderParties, orders } from '@/lib/db/schema';
import { isValidEmail, normalizeEmail } from './prelim-recipient-resolution';
import { POLICY_REQUIRED_ROLES, type PolicyKind } from './policy-classify';

export interface PolicyParty {
  email: string;
  name: string | null;
  role: string;
}

export interface PolicyRecipientResolution {
  kind: PolicyKind;
  ok: boolean;
  missing: string[];
  escrow: PolicyParty | null;
  lender: PolicyParty | null;
  owner: PolicyParty | null;
}

function partyFromContact(
  email: string | null | undefined,
  name: string | null | undefined,
  role: string,
): PolicyParty | null {
  if (!isValidEmail(email)) return null;
  return { email: normalizeEmail(email), name: name ?? null, role };
}

async function resolveEscrow(orderId: number, escrowOfficerId: number | null): Promise<PolicyParty | null> {
  if (escrowOfficerId) {
    const [officer] = await db
      .select({ email: contacts.email, fullName: contacts.fullName })
      .from(contacts)
      .where(eq(contacts.id, escrowOfficerId))
      .limit(1);
    const hit = partyFromContact(officer?.email, officer?.fullName, 'escrow_officer');
    if (hit) return hit;
  }

  const [party] = await db
    .select({
      externalName: orderParties.externalName,
      externalCompany: orderParties.externalCompany,
      externalEmail: orderParties.externalEmail,
      contactEmail: contacts.email,
      contactName: contacts.fullName,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(and(eq(orderParties.orderId, orderId), eq(orderParties.role, 'escrow_company')))
    .limit(1);

  const email = isValidEmail(party?.externalEmail) ? party.externalEmail : party?.contactEmail;
  return partyFromContact(
    email,
    party?.contactName ?? party?.externalName ?? party?.externalCompany,
    'escrow_company',
  );
}

async function resolveLender(orderId: number, lenderId: number | null): Promise<PolicyParty | null> {
  if (lenderId) {
    const [lender] = await db
      .select({ email: contacts.email, fullName: contacts.fullName, companyName: contacts.companyName })
      .from(contacts)
      .where(eq(contacts.id, lenderId))
      .limit(1);
    const hit = partyFromContact(lender?.email, lender?.fullName ?? lender?.companyName, 'lender');
    if (hit) return hit;
  }

  const [party] = await db
    .select({
      externalName: orderParties.externalName,
      externalCompany: orderParties.externalCompany,
      externalEmail: orderParties.externalEmail,
      contactEmail: contacts.email,
      contactName: contacts.fullName,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(and(
      eq(orderParties.orderId, orderId),
      inArray(orderParties.role, ['lender', 'lender_contact']),
    ))
    .limit(1);

  const email = isValidEmail(party?.externalEmail) ? party.externalEmail : party?.contactEmail;
  return partyFromContact(
    email,
    party?.contactName ?? party?.externalName ?? party?.externalCompany,
    'lender',
  );
}

async function resolveOwner(orderId: number): Promise<PolicyParty | null> {
  const rows = await db
    .select({
      role: orderParties.role,
      externalName: orderParties.externalName,
      externalEmail: orderParties.externalEmail,
      contactEmail: contacts.email,
      contactName: contacts.fullName,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(and(
      eq(orderParties.orderId, orderId),
      inArray(orderParties.role, ['buyer', 'borrower']),
    ));

  for (const role of ['buyer', 'borrower'] as const) {
    const row = rows.find((r) => r.role === role);
    if (!row) continue;
    const email = isValidEmail(row.externalEmail) ? row.externalEmail : row.contactEmail;
    const hit = partyFromContact(email, row.contactName ?? row.externalName, role);
    if (hit) return hit;
  }
  return null;
}

export function missingPolicyRoles(
  kind: PolicyKind,
  resolved: { escrow: PolicyParty | null; lender: PolicyParty | null; owner: PolicyParty | null },
): string[] {
  return POLICY_REQUIRED_ROLES[kind].filter((role) => {
    if (role === 'escrow') return !resolved.escrow;
    if (role === 'lender') return !resolved.lender;
    return !resolved.owner;
  });
}

export async function resolvePolicyRecipients(
  orderId: number,
  kind: PolicyKind,
): Promise<PolicyRecipientResolution> {
  const [order] = await db
    .select({
      escrowOfficerId: orders.escrowOfficerId,
      lenderId: orders.lenderId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const escrow = order ? await resolveEscrow(orderId, order.escrowOfficerId) : null;
  const lender = order ? await resolveLender(orderId, order.lenderId) : null;
  const owner = await resolveOwner(orderId);
  const missing = missingPolicyRoles(kind, { escrow, lender, owner });

  return {
    kind,
    ok: missing.length === 0,
    missing,
    escrow,
    lender,
    owner,
  };
}

export function policySendLine(resolved: PolicyRecipientResolution): {
  to: PolicyParty;
  cc: PolicyParty[];
} | null {
  if (!resolved.ok) return null;
  if (resolved.kind === 'lender_policy' && resolved.escrow && resolved.lender) {
    return { to: resolved.escrow, cc: resolved.lender.email === resolved.escrow.email ? [] : [resolved.lender] };
  }
  if (resolved.kind === 'owner_policy' && resolved.owner) {
    return { to: resolved.owner, cc: [] };
  }
  if (resolved.kind === 'supplement' && resolved.escrow) {
    return { to: resolved.escrow, cc: [] };
  }
  return null;
}
