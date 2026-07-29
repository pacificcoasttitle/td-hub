import { and, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  contacts, crmClientNotes, crmClients, orderParties, orders, profiles,
} from '@/lib/db/schema';
import { getSalesScopedContactIds, isSalesScopedRole } from '@/lib/security/permissions';
import type { SessionUser } from '@/lib/security/auth';

// My Clients (sales rep CRM). The client list is independent of SoftPro:
// this module never writes to contacts/orders/companies — reads on those
// tables exist only to suggest links and display order history.

export class CrmAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MAX_IMPORT_ROWS = 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CrmScope {
  /** Owner profile IDs whose client lists the caller may read. */
  visibleOwnerProfileIds: string[];
  /** ownerProfileId → that owner's sales-rep contact id (for business lookups). */
  ownerContactIdByProfile: Map<string, number | null>;
}

export interface CrmClientInput {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CrmClientPatch extends Partial<CrmClientInput> {
  /** Set to a contacts.id to link, null to unlink. Verified to exist; read-only bridge. */
  contactId?: number | null;
}

export interface ContactSuggestion {
  id: number;
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  matchedBy: 'email' | 'name';
}

export interface BusinessSummary {
  orderCount: number;
  lastOpenedAt: Date | null;
  lastClosedAt: Date | null;
}

interface OrderLinkRow {
  orderId: number;
  salesRepId: number | null;
  contactId: number | null;
  openedAt: Date;
  closedAt: Date | null;
}

export interface ImportRowInput {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ImportRowResult {
  row: number;
  status: 'added' | 'skipped_duplicate' | 'error';
  message?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** Strip ilike wildcards so user input can't widen a pattern. */
function escapeLike(value: string): string {
  return value.replace(/[%_]/g, '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Scope resolution ────────────────────────────────────────────────────────

/**
 * Resolves which owners' client lists the caller may read.
 *
 * - Non-sales roles get 404 (these APIs do not exist for them — spec §9).
 * - sales_rep: own list only; any repId other than their own contact id → 404.
 * - sales_manager: own list by default; repId=<managed rep contact id> for one
 *   rep's list; repId=all for self + all managed reps. Unknown rep → 404.
 *
 * Reading is scoped here; writing is always owner-only (checked per record).
 */
export async function resolveCrmScope(
  session: SessionUser,
  requestedRepId?: string | null,
): Promise<CrmScope> {
  if (!isSalesScopedRole(session.role)) {
    throw new CrmAccessError('Not found', 404);
  }

  if (session.role === 'sales_rep') {
    if (requestedRepId && Number(requestedRepId) !== session.contactId) {
      throw new CrmAccessError('Not found', 404);
    }
    return {
      visibleOwnerProfileIds: [session.id],
      ownerContactIdByProfile: new Map([[session.id, session.contactId]]),
    };
  }

  // sales_manager
  const scopedContactIds = await getSalesScopedContactIds(session);
  const ownerContactIdByProfile = new Map<string, number | null>([[session.id, session.contactId]]);

  if (!requestedRepId) {
    return { visibleOwnerProfileIds: [session.id], ownerContactIdByProfile };
  }

  const teamProfiles = scopedContactIds.length > 0
    ? await db
      .select({ id: profiles.id, contactId: profiles.contactId })
      .from(profiles)
      .where(inArray(profiles.contactId, scopedContactIds))
    : [];
  for (const p of teamProfiles) ownerContactIdByProfile.set(p.id, p.contactId);

  if (requestedRepId === 'all') {
    const ids = new Set<string>([session.id, ...teamProfiles.map((p) => p.id)]);
    return { visibleOwnerProfileIds: Array.from(ids), ownerContactIdByProfile };
  }

  const repId = Number(requestedRepId);
  if (!Number.isInteger(repId)) throw new CrmAccessError('Invalid repId', 400);
  if (!scopedContactIds.includes(repId)) throw new CrmAccessError('Not found', 404);

  const repProfileIds = teamProfiles.filter((p) => p.contactId === repId).map((p) => p.id);
  if (repId === session.contactId) repProfileIds.push(session.id);
  if (repProfileIds.length === 0) throw new CrmAccessError('Not found', 404);

  return {
    visibleOwnerProfileIds: Array.from(new Set(repProfileIds)),
    ownerContactIdByProfile,
  };
}

// ─── Business summary (READ-ONLY over orders/order_parties) ─────────────────

/**
 * Pure merge of the two link queries. An order can match a client through
 * orders.client_contact_id and order_parties simultaneously — dedupe by order
 * id. Orders only count toward a client when their sales rep is that client's
 * OWNER (the rep who keeps the list), never the viewer.
 */
export function composeBusinessSummaries(
  clients: Array<{ id: number; contactId: number | null; ownerContactId: number | null }>,
  linkRows: OrderLinkRow[],
): Map<number, BusinessSummary> {
  const result = new Map<number, BusinessSummary>();
  for (const client of clients) {
    if (client.contactId === null || client.ownerContactId === null) continue;
    const seen = new Set<number>();
    let lastOpenedAt: Date | null = null;
    let lastClosedAt: Date | null = null;
    for (const row of linkRows) {
      if (row.contactId !== client.contactId) continue;
      if (row.salesRepId !== client.ownerContactId) continue;
      if (seen.has(row.orderId)) continue;
      seen.add(row.orderId);
      if (!lastOpenedAt || row.openedAt > lastOpenedAt) lastOpenedAt = row.openedAt;
      if (row.closedAt && (!lastClosedAt || row.closedAt > lastClosedAt)) lastClosedAt = row.closedAt;
    }
    if (seen.size > 0) {
      result.set(client.id, { orderCount: seen.size, lastOpenedAt, lastClosedAt });
    }
  }
  return result;
}

async function fetchOrderLinkRows(
  ownerContactIds: number[],
  linkedContactIds: number[],
): Promise<OrderLinkRow[]> {
  if (ownerContactIds.length === 0 || linkedContactIds.length === 0) return [];

  const [direct, viaParties] = await Promise.all([
    db
      .select({
        orderId: orders.id,
        salesRepId: orders.salesRepId,
        contactId: orders.clientContactId,
        openedAt: orders.openedAt,
        closedAt: orders.closedAt,
      })
      .from(orders)
      .where(and(
        inArray(orders.salesRepId, ownerContactIds),
        inArray(orders.clientContactId, linkedContactIds),
      )),
    db
      .select({
        orderId: orders.id,
        salesRepId: orders.salesRepId,
        contactId: orderParties.contactId,
        openedAt: orders.openedAt,
        closedAt: orders.closedAt,
      })
      .from(orders)
      .innerJoin(orderParties, eq(orderParties.orderId, orders.id))
      .where(and(
        inArray(orders.salesRepId, ownerContactIds),
        inArray(orderParties.contactId, linkedContactIds),
      )),
  ]);

  return [...direct, ...viaParties];
}

// ─── Contact link suggestions (READ-ONLY over contacts) ─────────────────────

/**
 * Up to 5 suggested matches from the synced contacts table: email matches
 * first (case-insensitive exact), then name contains. Suggestions only —
 * linking always requires an explicit rep confirmation (spec §7.2).
 */
export async function suggestContacts(
  name: string,
  email: string | null,
): Promise<ContactSuggestion[]> {
  const suggestions: ContactSuggestion[] = [];

  if (email) {
    const emailRows = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        companyName: contacts.companyName,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(ilike(contacts.email, escapeLike(email)), eq(contacts.isActive, true)))
      .limit(5);
    for (const row of emailRows) suggestions.push({ ...row, matchedBy: 'email' });
  }

  const nameNeedle = escapeLike(name.trim());
  if (suggestions.length < 5 && nameNeedle.length >= 2) {
    const nameRows = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        companyName: contacts.companyName,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(ilike(contacts.fullName, `%${nameNeedle}%`), eq(contacts.isActive, true)))
      .limit(5);
    for (const row of nameRows) {
      if (suggestions.length >= 5) break;
      if (suggestions.some((s) => s.id === row.id)) continue;
      suggestions.push({ ...row, matchedBy: 'name' });
    }
  }

  return suggestions;
}

// ─── List ────────────────────────────────────────────────────────────────────

export interface ListClientsParams {
  search?: string;
  page?: number;
  pageSize?: number;
  repId?: string | null;
}

export async function listClients(session: SessionUser, params: ListClientsParams) {
  const scope = await resolveCrmScope(session, params.repId);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 25), 100);

  const conditions = [inArray(crmClients.ownerProfileId, scope.visibleOwnerProfileIds)];
  const q = params.search?.trim();
  if (q) {
    const safe = escapeLike(q);
    if (safe.length > 0) {
      const pat = `%${safe}%`;
      conditions.push(or(
        ilike(crmClients.name, pat),
        ilike(crmClients.company, pat),
        ilike(crmClients.email, pat),
      )!);
    }
  }
  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db.select().from(crmClients).where(where)
      .orderBy(crmClients.name)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)` }).from(crmClients).where(where),
  ]);

  const summaryInput = rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    ownerContactId: scope.ownerContactIdByProfile.get(r.ownerProfileId) ?? null,
  }));
  const ownerContactIds = Array.from(new Set(
    summaryInput.map((r) => r.ownerContactId).filter((v): v is number => v !== null),
  ));
  const linkedContactIds = Array.from(new Set(
    summaryInput.filter((r) => r.contactId !== null && r.ownerContactId !== null)
      .map((r) => r.contactId as number),
  ));
  const linkRows = await fetchOrderLinkRows(ownerContactIds, linkedContactIds);
  const summaries = composeBusinessSummaries(summaryInput, linkRows);

  const clientIds = rows.map((r) => r.id);
  const latestNoteByClient = new Map<number, { body: string; createdAt: Date }>();
  if (clientIds.length > 0) {
    const noteRows = await db
      .select({
        clientId: crmClientNotes.clientId,
        body: crmClientNotes.body,
        createdAt: crmClientNotes.createdAt,
      })
      .from(crmClientNotes)
      .where(inArray(crmClientNotes.clientId, clientIds))
      .orderBy(desc(crmClientNotes.createdAt));
    for (const note of noteRows) {
      if (!latestNoteByClient.has(note.clientId)) {
        latestNoteByClient.set(note.clientId, { body: note.body, createdAt: note.createdAt });
      }
    }
  }

  return {
    clients: rows.map((r) => ({
      ...r,
      canEdit: r.ownerProfileId === session.id,
      business: summaries.get(r.id) ?? null,
      latestNote: latestNoteByClient.get(r.id) ?? null,
    })),
    total: Number(countResult[0]?.total ?? 0),
    page,
    pageSize,
  };
}

// ─── Detail ──────────────────────────────────────────────────────────────────

async function getVisibleClient(session: SessionUser, clientId: number, repId?: string | null) {
  const scope = await resolveCrmScope(session, repId);
  const [row] = await db
    .select()
    .from(crmClients)
    .where(and(
      eq(crmClients.id, clientId),
      inArray(crmClients.ownerProfileId, scope.visibleOwnerProfileIds),
    ))
    .limit(1);
  if (!row) throw new CrmAccessError('Not found', 404);
  return { row, scope };
}

/** Loads a client the caller OWNS, for writes. Invisible → 404; visible but not owned → 403. */
async function getOwnedClient(session: SessionUser, clientId: number) {
  // Managers may see a rep's client via repId, but writes never take repId:
  // resolve against the caller's widest read scope, then require ownership.
  const widestRepId = session.role === 'sales_manager' ? 'all' : null;
  const { row } = await getVisibleClient(session, clientId, widestRepId);
  if (row.ownerProfileId !== session.id) {
    throw new CrmAccessError('Read-only access — only the list owner can make changes', 403);
  }
  return row;
}

export async function getClientDetail(session: SessionUser, clientId: number, repId?: string | null) {
  const { row, scope } = await getVisibleClient(session, clientId, repId);

  const notes = await db
    .select({
      id: crmClientNotes.id,
      body: crmClientNotes.body,
      createdAt: crmClientNotes.createdAt,
      authorProfileId: crmClientNotes.authorProfileId,
      authorName: profiles.displayName,
    })
    .from(crmClientNotes)
    .leftJoin(profiles, eq(crmClientNotes.authorProfileId, profiles.id))
    .where(eq(crmClientNotes.clientId, row.id))
    .orderBy(desc(crmClientNotes.createdAt));

  const ownerContactId = scope.ownerContactIdByProfile.get(row.ownerProfileId) ?? null;
  let business: Array<{
    id: number;
    fileNumber: string;
    operationalStatus: string;
    transactionType: string | null;
    openedAt: Date;
    closedAt: Date | null;
    salesPrice: string | null;
  }> = [];
  if (row.contactId !== null && ownerContactId !== null) {
    business = await db
      .select({
        id: orders.id,
        fileNumber: orders.fileNumber,
        operationalStatus: orders.operationalStatus,
        transactionType: orders.transactionType,
        openedAt: orders.openedAt,
        closedAt: orders.closedAt,
        salesPrice: orders.salesPrice,
      })
      .from(orders)
      .where(and(
        eq(orders.salesRepId, ownerContactId),
        or(
          eq(orders.clientContactId, row.contactId),
          exists(
            db.select({ id: orderParties.id })
              .from(orderParties)
              .where(and(
                eq(orderParties.orderId, orders.id),
                eq(orderParties.contactId, row.contactId),
              )),
          ),
        ),
      ))
      .orderBy(desc(orders.openedAt))
      .limit(20);
  }

  const suggestions = row.contactId === null
    ? await suggestContacts(row.name, row.email)
    : [];

  return {
    client: { ...row, canEdit: row.ownerProfileId === session.id },
    notes,
    business,
    suggestions,
  };
}

// ─── Create / Update / Delete ────────────────────────────────────────────────

async function findDuplicateByEmail(ownerProfileId: string, email: string, excludeId?: number) {
  const conditions = [
    eq(crmClients.ownerProfileId, ownerProfileId),
    ilike(crmClients.email, escapeLike(email)),
  ];
  const rows = await db
    .select({ id: crmClients.id })
    .from(crmClients)
    .where(and(...conditions))
    .limit(2);
  return rows.find((r) => r.id !== excludeId) ?? null;
}

export async function createClient(session: SessionUser, input: CrmClientInput) {
  await resolveCrmScope(session); // sales-role gate (404 for other roles)

  const email = normalizeEmail(input.email);
  if (email) {
    const dup = await findDuplicateByEmail(session.id, email);
    if (dup) {
      throw new CrmAccessError('A client with this email is already in your list', 409);
    }
  }

  const [created] = await db
    .insert(crmClients)
    .values({
      ownerProfileId: session.id,
      name: input.name.trim(),
      company: cleanOptional(input.company),
      email,
      phone: cleanOptional(input.phone),
    })
    .returning();

  const suggestions = await suggestContacts(created!.name, created!.email);
  return { client: { ...created!, canEdit: true }, suggestions };
}

export async function updateClient(session: SessionUser, clientId: number, patch: CrmClientPatch) {
  const existing = await getOwnedClient(session, clientId);

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.company !== undefined) values.company = cleanOptional(patch.company);
  if (patch.phone !== undefined) values.phone = cleanOptional(patch.phone);
  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email);
    if (email) {
      const dup = await findDuplicateByEmail(session.id, email, existing.id);
      if (dup) {
        throw new CrmAccessError('A client with this email is already in your list', 409);
      }
    }
    values.email = email;
  }
  if (patch.contactId !== undefined) {
    if (patch.contactId === null) {
      values.contactId = null;
    } else {
      const [contact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, patch.contactId))
        .limit(1);
      if (!contact) throw new CrmAccessError('Contact not found', 400);
      values.contactId = patch.contactId;
    }
  }

  const [updated] = await db
    .update(crmClients)
    .set(values)
    .where(eq(crmClients.id, existing.id))
    .returning();
  return { ...updated!, canEdit: true };
}

export async function deleteClient(session: SessionUser, clientId: number) {
  const existing = await getOwnedClient(session, clientId);
  await db.delete(crmClients).where(eq(crmClients.id, existing.id));
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export async function addNote(session: SessionUser, clientId: number, body: string) {
  await getOwnedClient(session, clientId);
  const [note] = await db
    .insert(crmClientNotes)
    .values({ clientId, authorProfileId: session.id, body: body.trim() })
    .returning();
  return { ...note!, authorName: session.displayName };
}

export async function deleteNote(session: SessionUser, clientId: number, noteId: number) {
  await getOwnedClient(session, clientId);
  const [note] = await db
    .select({ id: crmClientNotes.id, authorProfileId: crmClientNotes.authorProfileId })
    .from(crmClientNotes)
    .where(and(eq(crmClientNotes.id, noteId), eq(crmClientNotes.clientId, clientId)))
    .limit(1);
  if (!note) throw new CrmAccessError('Not found', 404);
  if (note.authorProfileId !== session.id) {
    throw new CrmAccessError('Only the author can delete a note', 403);
  }
  await db.delete(crmClientNotes).where(eq(crmClientNotes.id, note.id));
}

// ─── CSV import / export ─────────────────────────────────────────────────────

/**
 * Pure per-row triage: validates and dedupes against the owner's existing
 * emails and earlier rows in the same file (first occurrence wins).
 * Returns the rows to insert plus a per-row result report.
 */
export function triageImportRows(
  rows: ImportRowInput[],
  existingEmailsLower: Set<string>,
): { toInsert: Array<Omit<CrmClientInput, 'name'> & { name: string }>; results: ImportRowResult[] } {
  const toInsert: Array<{ name: string; company: string | null; email: string | null; phone: string | null }> = [];
  const results: ImportRowResult[] = [];
  const seenInFile = new Set<string>(existingEmailsLower);

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const name = row.name?.trim();
    if (!name) {
      results.push({ row: rowNum, status: 'error', message: 'Missing name' });
      return;
    }
    const email = normalizeEmail(row.email);
    if (email && !EMAIL_RE.test(email)) {
      results.push({ row: rowNum, status: 'error', message: 'Invalid email' });
      return;
    }
    if (email && seenInFile.has(email)) {
      results.push({ row: rowNum, status: 'skipped_duplicate' });
      return;
    }
    if (email) seenInFile.add(email);
    toInsert.push({
      name,
      company: cleanOptional(row.company),
      email,
      phone: cleanOptional(row.phone),
    });
    results.push({ row: rowNum, status: 'added' });
  });

  return { toInsert, results };
}

export async function importClients(session: SessionUser, rows: ImportRowInput[]) {
  await resolveCrmScope(session); // sales-role gate

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new CrmAccessError(
      `That file has more than ${MAX_IMPORT_ROWS} rows — please split it into smaller files`,
      400,
    );
  }

  const existing = await db
    .select({ email: crmClients.email })
    .from(crmClients)
    .where(eq(crmClients.ownerProfileId, session.id));
  const existingEmails = new Set(
    existing.map((r) => r.email?.toLowerCase()).filter((e): e is string => Boolean(e)),
  );

  const { toInsert, results } = triageImportRows(rows, existingEmails);

  if (toInsert.length > 0) {
    await db.transaction(async (tx) => {
      await tx.insert(crmClients).values(
        toInsert.map((r) => ({ ...r, ownerProfileId: session.id })),
      );
    });
  }

  return {
    added: results.filter((r) => r.status === 'added').length,
    skipped: results.filter((r) => r.status === 'skipped_duplicate').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };
}

function csvCell(value: string | null): string {
  const v = value ?? '';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Pure CSV builder for the four client columns + created date. */
export function buildClientsCsv(
  rows: Array<{ name: string; company: string | null; email: string | null; phone: string | null; createdAt: Date }>,
): string {
  const header = 'name,company,email,phone,created';
  const lines = rows.map((r) => [
    csvCell(r.name),
    csvCell(r.company),
    csvCell(r.email),
    csvCell(r.phone),
    r.createdAt.toISOString().slice(0, 10),
  ].join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** Exports the CALLER'S OWN list only (spec §6), regardless of manager scope. */
export async function exportClients(session: SessionUser): Promise<string> {
  await resolveCrmScope(session); // sales-role gate

  const rows = await db
    .select({
      name: crmClients.name,
      company: crmClients.company,
      email: crmClients.email,
      phone: crmClients.phone,
      createdAt: crmClients.createdAt,
    })
    .from(crmClients)
    .where(eq(crmClients.ownerProfileId, session.id))
    .orderBy(crmClients.name);

  return buildClientsCsv(rows);
}
