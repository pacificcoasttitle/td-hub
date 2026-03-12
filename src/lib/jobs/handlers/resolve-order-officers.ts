import { db } from '@/lib/db/client';
import { orders, orderParties, contacts, branches } from '@/lib/db/schema';
import { eq, or, isNull, and, sql } from 'drizzle-orm';

export interface ResolveOfficersResult {
  total: number;
  titleResolved: number;
  escrowResolved: number;
  skipped: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

/**
 * Resolves NULL titleOfficerId and escrowOfficerId on orders by
 * matching order_parties data against the contacts table.
 *
 * Title officer: order_parties role='other' where externalCompany is a
 * branch code → externalName matched against contacts.officerName / fullName.
 *
 * Escrow officer: order_parties role='escrow_company' → externalName
 * matched against contacts.softproLookupCode.
 */
export async function handleResolveOfficers(): Promise<ResolveOfficersResult> {
  const unresolved = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, titleOfficerId: orders.titleOfficerId, escrowOfficerId: orders.escrowOfficerId })
    .from(orders)
    .where(or(isNull(orders.titleOfficerId), isNull(orders.escrowOfficerId)))
    .limit(200);

  const branchCodes = await loadBranchCodes();
  let titleResolved = 0;
  let escrowResolved = 0;
  let skipped = 0;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (const order of unresolved) {
    try {
      const parties = await db
        .select({ role: orderParties.role, externalName: orderParties.externalName, externalCompany: orderParties.externalCompany })
        .from(orderParties)
        .where(eq(orderParties.orderId, order.id));

      const updates: Partial<{ titleOfficerId: number; escrowOfficerId: number; updatedAt: Date }> = {};

      if (!order.titleOfficerId) {
        const titleId = await resolveTitleOfficer(parties, branchCodes);
        if (titleId) { updates.titleOfficerId = titleId; titleResolved++; }
      }

      if (!order.escrowOfficerId) {
        const escrowId = await resolveEscrowOfficer(parties);
        if (escrowId) { updates.escrowOfficerId = escrowId; escrowResolved++; }
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db.update(orders).set(updates).where(eq(orders.id, order.id));
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({ fileNumber: order.fileNumber, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  return { total: unresolved.length, titleResolved, escrowResolved, skipped, errors };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadBranchCodes(): Promise<Set<string>> {
  const rows = await db.select({ code: branches.code }).from(branches);
  return new Set(rows.map((r) => r.code.toUpperCase()));
}

type PartyRow = { role: string; externalName: string | null; externalCompany: string | null };

async function resolveTitleOfficer(parties: PartyRow[], branchCodes: Set<string>): Promise<number | null> {
  const candidate = parties.find(
    (p) => p.role === 'other' && p.externalName && p.externalCompany && branchCodes.has(p.externalCompany.toUpperCase())
  );
  if (!candidate?.externalName) return null;
  return findContactByName(candidate.externalName);
}

async function resolveEscrowOfficer(parties: PartyRow[]): Promise<number | null> {
  const candidate = parties.find((p) => p.role === 'escrow_company' && p.externalName);
  if (!candidate?.externalName) return null;

  const byLookup = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.softproLookupCode, candidate.externalName))
    .limit(1);
  if (byLookup[0]) return byLookup[0].id;

  return findContactByName(candidate.externalName);
}

async function findContactByName(name: string): Promise<number | null> {
  const exact = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(or(eq(contacts.officerName, name), eq(contacts.fullName, name)))
    .limit(1);
  if (exact[0]) return exact[0].id;

  const reversed = reverseName(name);
  if (reversed && reversed !== name) {
    const rev = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(or(eq(contacts.officerName, reversed), eq(contacts.fullName, reversed)))
      .limit(1);
    if (rev[0]) return rev[0].id;
  }

  const nameParts = name.trim().split(/\s+/);
  if (nameParts.length >= 2) {
    const first = nameParts[0]!;
    const last = nameParts[nameParts.length - 1]!;
    const byParts = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(
        sql`lower(${contacts.firstName}) = ${first.toLowerCase()}`,
        sql`lower(${contacts.lastName}) = ${last.toLowerCase()}`,
      ))
      .limit(1);
    if (byParts[0]) return byParts[0].id;
  }

  return null;
}

function reverseName(name: string): string | null {
  if (name.includes(',')) {
    const [last, first] = name.split(',').map((s) => s.trim());
    if (first && last) return `${first} ${last}`;
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length === 2) return `${parts[1]}, ${parts[0]}`;
  return null;
}
