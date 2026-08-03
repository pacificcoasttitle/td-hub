import { and, desc, eq, exists, ilike, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  contacts, crmClientNotes, crmClients, orderParties, orders, profiles,
} from '@/lib/db/schema';
import { getSalesScopedContactIds, isSalesScopedRole } from '@/lib/security/permissions';
import type { SessionUser } from '@/lib/security/auth';
import { deriveClientType, type CrmClientType } from './types';
import {
  computeClientMetrics, type ClientOrderMetrics, type ClientOrderRow,
} from './client-metrics';

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
  type?: CrmClientType | null;
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
  /** Server-side classification filter. Undefined = all types. */
  type?: CrmClientType | null;
  /** When true, restrict to clients that have gone quiet (see isGoneQuiet). */
  quietOnly?: boolean;
}

// ─── "Gone quiet" insight (derived on read — no stored state) ───────────────

/**
 * A client is "quiet" when they have prior business with this rep but no order
 * opened in this many months. One fixed constant, deliberately NOT per-rep
 * configurable — the signal is only useful if it means the same thing to
 * everyone looking at it.
 */
export const QUIET_AFTER_MONTHS = 3;

/**
 * Pure rule. Unlinked clients have no business summary and are therefore never
 * quiet — "quiet" means a relationship that went cold, not one we can't see.
 */
export function isGoneQuiet(
  business: BusinessSummary | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!business || business.orderCount === 0) return false;
  if (!business.lastOpenedAt) return false;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - QUIET_AFTER_MONTHS);
  return business.lastOpenedAt < cutoff;
}

/**
 * Ids of every linked client in scope that has gone quiet. Computed over the
 * WHOLE scoped set (not just the current page) so the summary count is honest
 * and the filter can page correctly. READ-ONLY over orders/order_parties.
 */
async function fetchQuietClientIds(scope: CrmScope): Promise<Set<number>> {
  const all = await db
    .select({
      id: crmClients.id,
      contactId: crmClients.contactId,
      ownerProfileId: crmClients.ownerProfileId,
    })
    .from(crmClients)
    .where(and(
      inArray(crmClients.ownerProfileId, scope.visibleOwnerProfileIds),
      isNotNull(crmClients.contactId),
    ));

  if (all.length === 0) return new Set();

  const summaryInput = all.map((r) => ({
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

  const now = new Date();
  const quiet = new Set<number>();
  for (const [clientId, summary] of summaries) {
    if (isGoneQuiet(summary, now)) quiet.add(clientId);
  }
  return quiet;
}

export async function listClients(session: SessionUser, params: ListClientsParams) {
  const scope = await resolveCrmScope(session, params.repId);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 25), 100);

  // Derived on read — nothing about "quiet" is stored, so it self-updates as
  // deals flow. Needed up front because it both filters and is summarised.
  const quietIds = await fetchQuietClientIds(scope);

  const conditions = [inArray(crmClients.ownerProfileId, scope.visibleOwnerProfileIds)];
  if (params.type) conditions.push(eq(crmClients.type, params.type));
  if (params.quietOnly) {
    conditions.push(quietIds.size > 0
      ? inArray(crmClients.id, Array.from(quietIds))
      : sql`false`);
  }
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
      isQuiet: quietIds.has(r.id),
    })),
    total: Number(countResult[0]?.total ?? 0),
    page,
    pageSize,
    /** Across the whole scoped list, not just this page. */
    quietCount: quietIds.size,
    quietAfterMonths: QUIET_AFTER_MONTHS,
  };
}

// ─── Recent activity feed ───────────────────────────────────────────────────

export interface RecentNote {
  id: number;
  clientId: number;
  clientName: string;
  /** Included so the UI can fall back to it when the name is just an email. */
  clientCompany: string | null;
  body: string;
  createdAt: Date;
  authorName: string | null;
}

/**
 * The rep's most recent notes across ALL their clients. Scoped exactly like
 * the list: own notes by default, a managed rep's when repId is supplied.
 * READ-ONLY.
 */
export async function listRecentNotes(
  session: SessionUser,
  params: { repId?: string | null; limit?: number } = {},
): Promise<RecentNote[]> {
  const scope = await resolveCrmScope(session, params.repId);
  const limit = Math.min(Math.max(1, params.limit ?? 10), 50);

  const rows = await db
    .select({
      id: crmClientNotes.id,
      clientId: crmClientNotes.clientId,
      clientName: crmClients.name,
      clientCompany: crmClients.company,
      body: crmClientNotes.body,
      createdAt: crmClientNotes.createdAt,
      authorName: profiles.displayName,
    })
    .from(crmClientNotes)
    .innerJoin(crmClients, eq(crmClientNotes.clientId, crmClients.id))
    .leftJoin(profiles, eq(crmClientNotes.authorProfileId, profiles.id))
    .where(inArray(crmClients.ownerProfileId, scope.visibleOwnerProfileIds))
    .orderBy(desc(crmClientNotes.createdAt))
    .limit(limit);

  return rows;
}

// ─── Health snapshot (READ-ONLY; one client's own orders) ───────────────────

/**
 * Loads the order rows for ONE client, using the exact predicate the Business
 * section already uses: this rep's orders where the client's linked contact is
 * either the order's client contact or a party on the order.
 *
 * Bounded, and measured rather than assumed. On prod (6.6k orders, 30.6k
 * order_parties) the plan for the heaviest real client — 98 orders — is:
 *
 *   Index Scan using orders_sales_rep_idx  (sales_rep_id = $1)   -> 3.76ms total
 *     Filter: client_contact_id = $2 OR id = ANY(hashed SubPlan)
 *     SubPlan -> Seq Scan on order_parties (contact_id = $2)
 *
 * So: no full scan of `orders` — the leading equality is index-served and the
 * busiest rep has 824 orders. `order_parties.contact_id` has no index, so the
 * EXISTS is one hashed seq scan of order_parties, run ONCE per query (not per
 * order). At 30.6k rows that is ~3ms. It grows linearly with order_parties, so
 * if that table gets an order of magnitude bigger this wants an index on
 * `order_parties(contact_id)` — a schema change, deliberately out of scope here.
 *
 * This is the same predicate the Business section above already runs on every
 * drawer open, so the snapshot adds one query of an existing cost class.
 *
 * No LIMIT: full history is required for first-order date, average monthly
 * volume and the same-period-last-year window.
 */
async function fetchClientMetricRows(
  ownerContactId: number,
  contactId: number,
): Promise<ClientOrderRow[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      openedAt: orders.openedAt,
      closedAt: orders.closedAt,
      operationalStatus: orders.operationalStatus,
    })
    .from(orders)
    .where(and(
      eq(orders.salesRepId, ownerContactId),
      or(
        eq(orders.clientContactId, contactId),
        exists(
          db.select({ id: orderParties.id })
            .from(orderParties)
            .where(and(
              eq(orderParties.orderId, orders.id),
              eq(orderParties.contactId, contactId),
            )),
        ),
      ),
    ));

  return rows;
}

/**
 * The client's health snapshot.
 *
 * Keys off exactly what the My Clients list keys off — this crm_clients row and
 * its own linked contact. Two rows for the same firm get two snapshots; nothing
 * is stitched. Returns a zeroed, `unlinked` snapshot when there is no contact
 * link or no rep contact, rather than omitting the section.
 */
async function loadClientMetrics(
  clientId: number,
  contactId: number | null,
  ownerContactId: number | null,
  now: Date = new Date(),
): Promise<ClientOrderMetrics> {
  const orderRows = contactId !== null && ownerContactId !== null
    ? await fetchClientMetricRows(ownerContactId, contactId)
    : [];

  return computeClientMetrics({ clientId, contactId, orders: orderRows, now });
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

  const metrics = await loadClientMetrics(row.id, row.contactId, ownerContactId);

  return {
    client: { ...row, canEdit: row.ownerProfileId === session.id },
    notes,
    business,
    metrics,
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
      type: input.type ?? null,
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
  // An explicit pick always wins and is applied before any derivation below.
  if (patch.type !== undefined) values.type = patch.type ?? null;

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

      // Derive on link — but ONLY into an empty type. Suggest, don't override:
      // a type the rep chose (or one set by a previous link) is never clobbered.
      const typeAfterPatch = patch.type !== undefined ? patch.type : existing.type;
      if (!typeAfterPatch) {
        const derived = await deriveTypeForContact(session, patch.contactId);
        if (derived) values.type = derived;
      }
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

export interface ExportClientRow {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

export interface ExportNoteRow {
  clientId: number;
  body: string;
  authorName: string | null;
  createdAt: Date;
}

/**
 * Pure CSV builder. The first five columns are unchanged from the original
 * export; notes are appended as three more columns, one row per note, so the
 * rep's relationship intel travels with the file (spec §6 — no lock-in).
 * A client with no notes still appears once, with the note columns empty.
 */
export function buildClientsCsv(rows: ExportClientRow[], notes: ExportNoteRow[] = []): string {
  const header = 'name,company,email,phone,created,note,note_author,note_date';

  const notesByClient = new Map<number, ExportNoteRow[]>();
  for (const note of notes) {
    const list = notesByClient.get(note.clientId);
    if (list) list.push(note);
    else notesByClient.set(note.clientId, [note]);
  }

  const lines: string[] = [];
  for (const r of rows) {
    const base = [
      csvCell(r.name),
      csvCell(r.company),
      csvCell(r.email),
      csvCell(r.phone),
      r.createdAt.toISOString().slice(0, 10),
    ];
    const clientNotes = notesByClient.get(r.id) ?? [];
    if (clientNotes.length === 0) {
      lines.push([...base, '', '', ''].join(','));
      continue;
    }
    for (const note of clientNotes) {
      lines.push([
        ...base,
        csvCell(note.body),
        csvCell(note.authorName),
        note.createdAt.toISOString().slice(0, 10),
      ].join(','));
    }
  }
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** Exports the CALLER'S OWN list only (spec §6), regardless of manager scope. */
export async function exportClients(session: SessionUser): Promise<string> {
  await resolveCrmScope(session); // sales-role gate

  const rows = await db
    .select({
      id: crmClients.id,
      name: crmClients.name,
      company: crmClients.company,
      email: crmClients.email,
      phone: crmClients.phone,
      createdAt: crmClients.createdAt,
    })
    .from(crmClients)
    .where(eq(crmClients.ownerProfileId, session.id))
    .orderBy(crmClients.name);

  if (rows.length === 0) return buildClientsCsv([], []);

  // Notes for the caller's own clients only — same ownership fence as above.
  const noteRows = await db
    .select({
      clientId: crmClientNotes.clientId,
      body: crmClientNotes.body,
      authorName: profiles.displayName,
      createdAt: crmClientNotes.createdAt,
    })
    .from(crmClientNotes)
    .innerJoin(crmClients, eq(crmClientNotes.clientId, crmClients.id))
    .leftJoin(profiles, eq(crmClientNotes.authorProfileId, profiles.id))
    .where(eq(crmClients.ownerProfileId, session.id))
    .orderBy(crmClientNotes.clientId, desc(crmClientNotes.createdAt));

  return buildClientsCsv(rows, noteRows);
}

// ─── Seed from transactions (READ-ONLY over orders/order_parties/contacts) ───

export interface TransactionClientSuggestion {
  contactId: number;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  /** Distinct roles this contact held on the rep's orders, most useful first. */
  roles: string[];
  orderCount: number;
  lastOrderAt: Date | null;
}

interface TxLinkRow {
  orderId: number;
  contactId: number | null;
  openedAt: Date;
  role: string;
}

/**
 * Party roles that are consumers on a single transaction rather than business
 * sources a rep cultivates. My Clients is for "the real estate agents, lenders,
 * and escrow contacts they work" (spec §1), so these never seed the list —
 * otherwise every one-time buyer would drown out the referral relationships.
 *
 * A contact who also appears in a business-source role still surfaces: the
 * filter drops consumer ROWS, not people.
 */
export const CONSUMER_PARTY_ROLES = ['buyer', 'seller', 'borrower'] as const;

function isBusinessSourceRole(role: string): boolean {
  return !(CONSUMER_PARTY_ROLES as readonly string[]).includes(role);
}

/**
 * Pure merge/exclude/rank step. Counts distinct orders per contact, drops
 * contacts the rep already has (by linked contact id or matching email), and
 * ranks by how much business they represent.
 */
export function composeTransactionClientSuggestions(
  linkRows: TxLinkRow[],
  contactRows: Array<{
    id: number; fullName: string | null; companyName: string | null;
    email: string | null; phone: string | null;
  }>,
  excludedContactIds: Set<number>,
  excludedEmailsLower: Set<string>,
): TransactionClientSuggestion[] {
  const byContact = new Map<number, { orders: Set<number>; roles: Set<string>; lastOrderAt: Date | null }>();

  for (const row of linkRows) {
    if (row.contactId === null) continue;
    if (!isBusinessSourceRole(row.role)) continue;
    if (excludedContactIds.has(row.contactId)) continue;
    let entry = byContact.get(row.contactId);
    if (!entry) {
      entry = { orders: new Set(), roles: new Set(), lastOrderAt: null };
      byContact.set(row.contactId, entry);
    }
    entry.orders.add(row.orderId);
    entry.roles.add(row.role);
    if (!entry.lastOrderAt || row.openedAt > entry.lastOrderAt) entry.lastOrderAt = row.openedAt;
  }

  const contactsById = new Map(contactRows.map((c) => [c.id, c]));
  const out: TransactionClientSuggestion[] = [];

  for (const [contactId, entry] of byContact) {
    const contact = contactsById.get(contactId);
    if (!contact) continue;
    const email = normalizeEmail(contact.email);
    if (email && excludedEmailsLower.has(email)) continue;
    out.push({
      contactId,
      name: contact.fullName,
      company: contact.companyName,
      email: contact.email,
      phone: contact.phone,
      roles: Array.from(entry.roles).sort(),
      orderCount: entry.orders.size,
      lastOrderAt: entry.lastOrderAt,
    });
  }

  // Most business first; ties broken by recency, then name for stability.
  out.sort((a, b) =>
    b.orderCount - a.orderCount
    || (b.lastOrderAt?.getTime() ?? 0) - (a.lastOrderAt?.getTime() ?? 0)
    || (a.name ?? '').localeCompare(b.name ?? ''));

  return out;
}

/** Contacts already in the caller's list, by linked id and by email. */
async function fetchOwnExclusions(ownerProfileId: string) {
  const existing = await db
    .select({ contactId: crmClients.contactId, email: crmClients.email })
    .from(crmClients)
    .where(eq(crmClients.ownerProfileId, ownerProfileId));

  return {
    contactIds: new Set(
      existing.map((r) => r.contactId).filter((id): id is number => id !== null),
    ),
    emails: new Set(
      existing.map((r) => normalizeEmail(r.email)).filter((e): e is string => e !== null),
    ),
  };
}

export interface TransactionClientsParams {
  page?: number;
  pageSize?: number;
}

/**
 * Suggests people the caller has actually done deals with, so a new rep can
 * seed their list instead of typing it. READ-ONLY: this never writes to
 * orders/order_parties/contacts — it only reads them to suggest.
 * Always the CALLER'S OWN transactions (owner-only action).
 */
export async function listTransactionClients(
  session: SessionUser,
  params: TransactionClientsParams = {},
) {
  await resolveCrmScope(session); // sales-role gate (404 for other roles)

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 25), 100);
  const all = await fetchTransactionClientSuggestions(session);

  return {
    suggestions: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
  };
}

/** Unpaginated suggestion set — shared by the list route and the add action. */
async function fetchTransactionClientSuggestions(
  session: SessionUser,
): Promise<TransactionClientSuggestion[]> {
  const repContactId = session.contactId;
  if (repContactId === null || repContactId === undefined) return [];

  const [direct, viaParties, exclusions] = await Promise.all([
    db
      .select({
        orderId: orders.id,
        contactId: orders.clientContactId,
        openedAt: orders.openedAt,
      })
      .from(orders)
      .where(and(
        eq(orders.salesRepId, repContactId),
        sql`${orders.clientContactId} is not null`,
      )),
    db
      .select({
        orderId: orders.id,
        contactId: orderParties.contactId,
        openedAt: orders.openedAt,
        role: orderParties.role,
      })
      .from(orderParties)
      .innerJoin(orders, eq(orderParties.orderId, orders.id))
      .where(and(
        eq(orders.salesRepId, repContactId),
        sql`${orderParties.contactId} is not null`,
        // Consumer roles never seed the list — filtered here so they don't
        // leave the database, and again in the pure composer as the guard.
        notInArray(orderParties.role, [...CONSUMER_PARTY_ROLES]),
      )),
    fetchOwnExclusions(session.id),
  ]);

  const linkRows: TxLinkRow[] = [
    ...direct.map((r) => ({ ...r, role: 'client' })),
    ...viaParties.map((r) => ({ orderId: r.orderId, contactId: r.contactId, openedAt: r.openedAt, role: String(r.role) })),
  ];

  const candidateIds = Array.from(new Set(
    linkRows
      .map((r) => r.contactId)
      .filter((id): id is number => id !== null && !exclusions.contactIds.has(id)),
  ));

  const contactRows = candidateIds.length > 0
    ? await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        companyName: contacts.companyName,
        email: contacts.email,
        phone: contacts.phone,
      })
      .from(contacts)
      .where(inArray(contacts.id, candidateIds))
    : [];

  return composeTransactionClientSuggestions(
    linkRows, contactRows, exclusions.contactIds, exclusions.emails,
  );
}

/**
 * Creates crm_clients rows for contacts the rep explicitly chose. The
 * contactId is pre-linked because the rep picked them off their own order
 * history — the link is confirmed by that choice, not guessed.
 * WRITES ONLY to crm_clients. Owner-only.
 */
/**
 * Resolves a contact's party roles across the CALLER'S OWN orders and maps them
 * to a client type. READ-ONLY over orders/order_parties — writes nothing.
 * Returns null when the contact doesn't appear on the caller's orders, or when
 * their roles don't imply a classification.
 */
export async function deriveTypeForContact(
  session: SessionUser,
  contactId: number,
): Promise<CrmClientType | null> {
  const repContactId = session.contactId;
  if (repContactId === null || repContactId === undefined) return null;

  const rows = await db
    .select({ role: orderParties.role })
    .from(orderParties)
    .innerJoin(orders, eq(orderParties.orderId, orders.id))
    .where(and(
      eq(orders.salesRepId, repContactId),
      eq(orderParties.contactId, contactId),
    ));

  return deriveClientType(rows.map((r) => String(r.role)));
}

/**
 * Fills in `type` for the caller's existing clients that are linked to a
 * contact but still unclassified. Idempotent and fill-when-empty only — it
 * never changes a type that is already set. Owner's own list only.
 */
export async function backfillClientTypes(session: SessionUser) {
  await resolveCrmScope(session); // sales-role gate

  const candidates = await db
    .select({ id: crmClients.id, contactId: crmClients.contactId })
    .from(crmClients)
    .where(and(
      eq(crmClients.ownerProfileId, session.id),
      isNull(crmClients.type),
      isNotNull(crmClients.contactId),
    ));

  let updated = 0;
  for (const row of candidates) {
    const derived = await deriveTypeForContact(session, row.contactId!);
    if (!derived) continue;
    await db
      .update(crmClients)
      .set({ type: derived, updatedAt: new Date() })
      // Re-assert the empty check in the WHERE so a concurrent manual pick wins.
      .where(and(eq(crmClients.id, row.id), isNull(crmClients.type)));
    updated++;
  }

  return { examined: candidates.length, updated };
}

export async function addClientsFromTransactions(session: SessionUser, contactIds: number[]) {
  await resolveCrmScope(session); // sales-role gate

  const repContactId = session.contactId;
  if (repContactId === null || repContactId === undefined) {
    throw new CrmAccessError('Not found', 404);
  }
  const requested = Array.from(new Set(contactIds));
  if (requested.length === 0) return { added: 0, skipped: 0, clients: [] };

  // Only contacts that genuinely appear on this rep's own orders may be added
  // this way — re-verified server-side against the full set, never trusted
  // from the request body.
  const eligible = await fetchTransactionClientSuggestions(session);
  const byId = new Map(eligible.map((s) => [s.contactId, s]));
  const toInsert = requested
    .map((id) => byId.get(id))
    .filter((s): s is TransactionClientSuggestion => s !== undefined);

  if (toInsert.length === 0) return { added: 0, skipped: requested.length, clients: [] };

  const created = await db
    .insert(crmClients)
    .values(toInsert.map((s) => ({
      ownerProfileId: session.id,
      name: (s.name ?? s.email ?? 'Unnamed contact').trim(),
      company: cleanOptional(s.company),
      email: normalizeEmail(s.email),
      phone: cleanOptional(s.phone),
      contactId: s.contactId,
      // Seeded clients arrive already classified from their party roles.
      type: deriveClientType(s.roles),
    })))
    .returning();

  return {
    added: created.length,
    skipped: requested.length - created.length,
    clients: created.map((c) => ({ ...c, canEdit: true })),
  };
}
