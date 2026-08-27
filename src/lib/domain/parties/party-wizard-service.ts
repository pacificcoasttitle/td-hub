import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import {
  contacts, orderParties, orderProperties, orders, partySubmissions, partyWizardLinks,
} from '@/lib/db/schema';
import { addNotes } from '@/lib/integrations/softpro';
import {
  buildPartyWizardUrl, matchesStoredHash, mintPartyWizardToken, verifyPartyWizardToken,
} from './party-wizard-token';
import {
  getRoleForm, getSubmissionSchema, toPartyColumns, toSellerColumns,
  type ListingAgentSubmission, type PartyColumns, type PartyRole, type RoleFormDefinition,
} from './party-wizard-fields';
import {
  classifyLinkState, resolveCounterpartName, resolveWizardContact, type WizardContact,
} from './party-wizard-context';
import { buildPartyNote } from './party-note';

// ─── Party wizard service ────────────────────────────────────────────────────
//
// Verification is deliberately two-stage: HMAC first (cheap, no I/O), then row
// state (revocation, expiry, rate limit). A forged token never reaches the DB.

/**
 * Submissions allowed per link per window. Generous — the honest case is an
 * agent correcting a typo, and locking them out is worse than a few extra rows.
 * The cap exists to stop a leaked link being used to hammer the AddNotes API.
 */
export const SUBMISSION_RATE_LIMIT = 5;
export const SUBMISSION_RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Everything the public page may render about the order.
 *
 * Still deliberately narrow — a link in the wrong inbox must reveal only what
 * the intended recipient already knows from their own role. What is here was
 * approved field by field; what is absent (price, loan amount, the lender, any
 * other party's contact details) is absent on purpose and stays that way.
 */
export interface WizardOrderContext {
  fileNumber: string;
  propertyAddress: string | null;
  transactionType: string | null;
  openedAt: Date | null;
  /** The recipient's own client, for confirmation. Null far more often than not. */
  counterpartName: string | null;
  /** Who to ask about this file. Null when neither officer resolves. */
  contact: WizardContact | null;
}

export interface ResolvedLink {
  linkId: number;
  orderId: number;
  role: PartyRole;
  tokenId: string;
  form: RoleFormDefinition;
  order: WizardOrderContext;
  /** Prior answers, so reopening the link on any device resumes. */
  previousValues: Record<string, string> | null;
  alreadySubmitted: boolean;
}

export type LinkFailure =
  | 'invalid'        // bad signature, malformed, or no such row
  | 'inactive'       // revoked OR expired — deliberately indistinguishable
  | 'unsupported'    // role we cannot render a form for
  | 'misconfigured'; // secret unset

export type ResolveResult =
  | { ok: true; link: ResolvedLink }
  /**
   * `order` is attached only for failures that required a signature-valid token
   * matching a real row — see the note on probing in resolvePartyWizardLink.
   */
  | { ok: false; reason: LinkFailure; order?: WizardOrderContext };

/**
 * Resolve a token to a usable link. Read-only; call recordLinkAccess separately
 * so a HEAD/prefetch does not inflate the access count.
 *
 * ON PROBING. Revoked and expired resolve to the same reason — 'inactive' —
 * and the page renders one message for it, so the outcome cannot tell anyone
 * which of the two happened, or that a link was ever deliberately withdrawn.
 *
 * They do return more than 'invalid' does, and that is deliberate rather than a
 * gap: reaching this point at all requires an HMAC over `tokenId.secretHalf`
 * that verifies against PARTY_WIZARD_TOKEN_SECRET, so anyone who gets here is
 * holding a token we minted and handed out. They already knew the file. What
 * they need now is a person to ask, which is exactly what the panel gives them.
 */
export async function resolvePartyWizardLink(token: string): Promise<ResolveResult> {
  const verified = verifyPartyWizardToken(token);
  if (!verified.ok) {
    return { ok: false, reason: verified.error === 'Server misconfigured' ? 'misconfigured' : 'invalid' };
  }

  const { tokenId, secretHalf } = verified.parsed;

  const [row] = await db
    .select({
      id: partyWizardLinks.id,
      orderId: partyWizardLinks.orderId,
      role: partyWizardLinks.role,
      tokenHash: partyWizardLinks.tokenHash,
      expiresAt: partyWizardLinks.expiresAt,
      revokedAt: partyWizardLinks.revokedAt,
      usedAt: partyWizardLinks.usedAt,
    })
    .from(partyWizardLinks)
    .where(eq(partyWizardLinks.tokenId, tokenId))
    .limit(1);

  if (!row) return { ok: false, reason: 'invalid' };
  // The id alone is not enough — the secret half must match the stored digest.
  if (!matchesStoredHash(secretHalf, row.tokenHash)) return { ok: false, reason: 'invalid' };

  const role = row.role as PartyRole;
  const order = await loadOrderContext(row.orderId, role);
  if (!order) return { ok: false, reason: 'invalid' };

  // One reason for both, so the two cannot be told apart from the outside. The
  // operational difference stays legible where it belongs: on the row itself.
  if (classifyLinkState(row) === 'inactive') {
    return { ok: false, reason: 'inactive', order };
  }

  const form = getRoleForm(role);
  if (!form) return { ok: false, reason: 'unsupported', order };

  return {
    ok: true,
    link: {
      linkId: row.id,
      orderId: row.orderId,
      role,
      tokenId,
      form,
      order,
      previousValues: await loadPreviousValues(row.orderId, role),
      alreadySubmitted: row.usedAt !== null,
    },
  };
}

/**
 * Everything the page renders about the order, in one query.
 *
 * Two aliased joins onto contacts because the escrow officer and the title
 * officer are both contacts rows and the ladder needs whichever it can get.
 * Note what is NOT selected: sales_price, loan_amount, lender_id, and every
 * other party. Those are not filtered out downstream — they never leave the
 * database.
 */
async function loadOrderContext(
  orderId: number,
  role: PartyRole,
): Promise<WizardOrderContext | null> {
  const escrowOfficer = alias(contacts, 'escrow_officer');
  const titleOfficer = alias(contacts, 'title_officer');

  const [row] = await db
    .select({
      fileNumber: orders.fileNumber,
      transactionType: orders.transactionType,
      openedAt: orders.openedAt,
      address: orderProperties.fullAddress,
      street: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
      zip: orderProperties.zip,
      primaryOwner: orderProperties.primaryOwner,
      escrowOfficerName: escrowOfficer.fullName,
      escrowOfficerEmail: escrowOfficer.email,
      escrowOfficerPhone: escrowOfficer.phone,
      escrowOfficerCompany: escrowOfficer.companyName,
      titleOfficerName: titleOfficer.fullName,
      titleOfficerEmail: titleOfficer.email,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .leftJoin(escrowOfficer, eq(escrowOfficer.id, orders.escrowOfficerId))
    .leftJoin(titleOfficer, eq(titleOfficer.id, orders.titleOfficerId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) return null;

  return {
    fileNumber: row.fileNumber,
    propertyAddress: composeAddress(row),
    transactionType: row.transactionType ?? null,
    openedAt: row.openedAt ?? null,
    counterpartName: resolveCounterpartName(role, row.primaryOwner),
    contact: resolveWizardContact(row),
  };
}

function composeAddress(row: {
  address: string | null; street: string | null;
  city: string | null; state: string | null; zip: string | null;
}): string | null {
  if (row.address?.trim()) return row.address.trim();
  const parts = [row.street, [row.city, row.state].filter(Boolean).join(', '), row.zip]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(', ') : null;
}

/** Latest submission for this order+role, so a reopened link is pre-filled. */
async function loadPreviousValues(
  orderId: number,
  role: PartyRole,
): Promise<Record<string, string> | null> {
  const [prev] = await db
    .select({ values: partySubmissions.submittedValues })
    .from(partySubmissions)
    .where(and(eq(partySubmissions.orderId, orderId), eq(partySubmissions.role, role)))
    .orderBy(desc(partySubmissions.submittedAt))
    .limit(1);

  if (!prev?.values || typeof prev.values !== 'object') return null;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(prev.values as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Bump access telemetry. Best-effort — never blocks rendering the form. */
export async function recordLinkAccess(linkId: number): Promise<void> {
  try {
    await db
      .update(partyWizardLinks)
      .set({
        accessCount: sql`${partyWizardLinks.accessCount} + 1`,
        lastAccessedAt: new Date(),
        firstAccessedAt: sql`COALESCE(${partyWizardLinks.firstAccessedAt}, NOW())`,
      })
      .where(eq(partyWizardLinks.id, linkId));
  } catch {
    // Telemetry only.
  }
}

export type SubmitResult =
  | { ok: true; submissionId: number; noteStatus: 'sent' | 'failed' }
  | { ok: false; reason: LinkFailure | 'rate_limited' | 'validation'; fieldErrors?: Record<string, string> };

/**
 * Record a submission.
 *
 * Order matters: party_submissions is written FIRST and is the only step whose
 * failure aborts. The projection and the note are best-effort — if either
 * fails, the agent's answer is still durably captured and replayable.
 */
export async function submitPartyWizard(
  token: string,
  rawValues: unknown,
): Promise<SubmitResult> {
  const resolved = await resolvePartyWizardLink(token);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const { link } = resolved;

  const limited = await isRateLimited(link.linkId, link.role);
  if (limited) return { ok: false, reason: 'rate_limited' };

  const schema = getSubmissionSchema(link.role);
  if (!schema) return { ok: false, reason: 'unsupported' };

  const parsed = schema.safeParse(rawValues);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, reason: 'validation', fieldErrors };
  }

  const values = parsed.data as ListingAgentSubmission;
  const partyCols = toPartyColumns(link.role, values);
  const sellerCols = toSellerColumns(values);
  const submittedAt = new Date();

  const [submission] = await db
    .insert(partySubmissions)
    .values({
      orderId: link.orderId,
      role: link.role,
      sourceLinkId: link.linkId,
      tokenId: link.tokenId,
      submitterEmail: values.agentEmail ?? null,
      ...partyCols,
      submittedValues: values as Record<string, unknown>,
      submittedAt,
    })
    .returning({ id: partySubmissions.id });

  // A named seller replays through the same path, so it gets its own row.
  if (sellerCols) {
    await db.insert(partySubmissions).values({
      orderId: link.orderId,
      role: 'seller',
      sourceLinkId: link.linkId,
      tokenId: link.tokenId,
      submitterEmail: values.agentEmail ?? null,
      ...sellerCols,
      submittedValues: {
        sellerName: values.sellerName, sellerEmail: values.sellerEmail, sellerPhone: values.sellerPhone,
      },
      submittedAt,
    });
  }

  await db
    .update(partyWizardLinks)
    .set({
      submissionCount: sql`${partyWizardLinks.submissionCount} + 1`,
      lastSubmittedAt: submittedAt,
      usedAt: sql`COALESCE(${partyWizardLinks.usedAt}, NOW())`,
    })
    .where(eq(partyWizardLinks.id, link.linkId));

  await projectToOrderParties(link.orderId, link.role, partyCols);
  if (sellerCols) await projectToOrderParties(link.orderId, 'seller', sellerCols);

  const noteStatus = await postPartyNote(submission.id, link, values, partyCols, submittedAt);

  return { ok: true, submissionId: submission.id, noteStatus };
}

/**
 * Count SUBMISSION EVENTS, not rows.
 *
 * One submit can write two rows against the same link — the agent, plus the
 * seller they named. Counting rows made the cap of 5 mean two-and-a-bit real
 * submissions for any agent who filled in the seller, so an agent correcting a
 * typo twice got locked out.
 *
 * Filtering to the link's OWN role counts exactly one row per submit: the
 * secondary seller row is written under role='seller', which a listing_agent
 * link never matches.
 */
async function isRateLimited(linkId: number, role: PartyRole): Promise<boolean> {
  const since = new Date(Date.now() - SUBMISSION_RATE_WINDOW_MS);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(partySubmissions)
    .where(and(
      eq(partySubmissions.sourceLinkId, linkId),
      eq(partySubmissions.role, role),
      sql`${partySubmissions.submittedAt} > ${since}`,
    ));
  return (row?.n ?? 0) >= SUBMISSION_RATE_LIMIT;
}

/**
 * Update the projection.
 *
 * PER-FIELD, NON-EMPTY ONLY — the same rule both SoftPro writers already use
 * (enrich-orders upsertResolvedParty, verify-order-sync reconcileParties). A
 * blank never clobbers a populated field, in either direction, so wizard and
 * sync data merge instead of taking turns winning.
 *
 * The projection is expendable: party_submissions is the record, and this table
 * can be rebuilt from it.
 */
export async function projectToOrderParties(
  orderId: number,
  role: PartyRole,
  cols: PartyColumns,
): Promise<void> {
  const values: Record<string, string> = {};
  if (cols.submittedName) values.externalName = cols.submittedName;
  if (cols.submittedCompany) values.externalCompany = cols.submittedCompany;
  if (cols.submittedEmail) values.externalEmail = cols.submittedEmail;
  if (cols.submittedPhone) values.externalPhone = cols.submittedPhone;
  if (Object.keys(values).length === 0) return;

  const [existing] = await db
    .select({ id: orderParties.id })
    .from(orderParties)
    .where(and(
      eq(orderParties.orderId, orderId),
      eq(orderParties.role, role),
      eq(orderParties.isPrimary, true),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(orderParties)
      .set({ ...values, source: 'party_wizard' })
      .where(eq(orderParties.id, existing.id));
  } else {
    await db.insert(orderParties).values({
      orderId,
      role,
      isPrimary: true,
      source: 'party_wizard',
      ...values,
    });
  }
}

/** Post the structured note and record the outcome on the submission row. */
async function postPartyNote(
  submissionId: number,
  link: ResolvedLink,
  values: ListingAgentSubmission,
  cols: PartyColumns,
  submittedAt: Date,
): Promise<'sent' | 'failed'> {
  const text = buildPartyNote({
    role: link.role,
    name: cols.submittedName,
    company: cols.submittedCompany,
    email: cols.submittedEmail,
    phone: cols.submittedPhone,
    submitterEmail: values.agentEmail ?? null,
    submittedAt,
    seller: values.sellerName || values.sellerEmail || values.sellerPhone
      ? { name: values.sellerName ?? null, email: values.sellerEmail ?? null, phone: values.sellerPhone ?? null }
      : null,
    // Only meaningful alongside the name we actually showed them.
    counterpartDisputed: values.counterpartFlagged === 'true'
      ? link.order.counterpartName
      : null,
  });

  try {
    const result = await addNotes(link.order.fileNumber, text);
    if (result.success) {
      const noteId = Array.isArray(result.data) ? result.data[0]?.Id ?? null : null;
      await db.update(partySubmissions).set({
        softproNoteStatus: 'sent',
        softproNoteId: noteId ? String(noteId) : null,
        softproNoteAt: new Date(),
      }).where(eq(partySubmissions.id, submissionId));
      return 'sent';
    }
    await db.update(partySubmissions).set({
      softproNoteStatus: 'failed',
      softproNoteError: result.error?.message?.slice(0, 500) ?? 'AddNotes returned failure',
      softproNoteAt: new Date(),
    }).where(eq(partySubmissions.id, submissionId));
    return 'failed';
  } catch (err) {
    await db.update(partySubmissions).set({
      softproNoteStatus: 'failed',
      softproNoteError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown AddNotes error',
      softproNoteAt: new Date(),
    }).where(eq(partySubmissions.id, submissionId));
    return 'failed';
  }
}

// ─── Link minting ────────────────────────────────────────────────────────────

export interface MintedLink {
  linkId: number;
  url: string;
}

/**
 * Mint a NEW link for an order+role. Always inserts — it does not check for or
 * reuse an existing link.
 *
 * Callers that must not hand out a second URL for the same request are
 * responsible for calling findLiveLink first; the invite job does exactly that.
 */
export async function mintLinkForOrder(
  orderId: number,
  role: PartyRole,
  createdBy = 'party_wizard_invite',
): Promise<MintedLink | null> {
  const minted = mintPartyWizardToken();

  const [row] = await db
    .insert(partyWizardLinks)
    .values({
      orderId,
      role,
      tokenId: minted.tokenId,
      tokenHash: minted.tokenHash,
      expiresAt: minted.expiresAt,
      createdBy,
    })
    .returning({ id: partyWizardLinks.id });

  if (!row) return null;
  return { linkId: row.id, url: buildPartyWizardUrl(minted.token) };
}

/** Is there already a usable link for this order+role? */
export async function findLiveLink(orderId: number, role: PartyRole): Promise<{ id: number } | null> {
  const [row] = await db
    .select({ id: partyWizardLinks.id })
    .from(partyWizardLinks)
    .where(and(
      eq(partyWizardLinks.orderId, orderId),
      eq(partyWizardLinks.role, role),
      sql`${partyWizardLinks.revokedAt} IS NULL`,
      sql`${partyWizardLinks.expiresAt} > NOW()`,
    ))
    .limit(1);
  return row ?? null;
}
