import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { DEFAULT_CRITERIA, type CompCriteria } from './comp-filter';

// ─── Reading profiles for the operator UI ───────────────────────────────────

export interface ProfileSummary {
  id: number;
  orderId: number | null;
  status: string;
  requestedAddress: string;
  subjectAddressLine: string | null;
  createdAt: string;
  createdBy: string | null;
  errorMessage: string | null;
  hasPdf: boolean;
  pdfBytes: number | null;
  pdfPageCount: number | null;
  compsReturned: number;
  compsQualified: number;
  compsShown: number;
  criteria: CompCriteria;
  creditsCharged: number;
  /** Present only once retrieval succeeded — the handle for an invoice line. */
  sitexSearchId: number | null;
  /** True when there is stored data to re-render, so a retry is free. */
  canRenderFree: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toSummary(p: typeof conciergeProfiles.$inferSelect): ProfileSummary {
  return {
    id: p.id,
    orderId: p.orderId,
    status: p.status,
    requestedAddress: p.requestedAddress,
    subjectAddressLine: [p.requestedAddress, p.requestedCity, [p.requestedState, p.requestedZip].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ') || null,
    createdAt: p.createdAt.toISOString(),
    createdBy: p.createdBy,
    errorMessage: p.errorMessage,
    hasPdf: !!p.pdfStorageKey,
    pdfBytes: p.pdfBytes,
    pdfPageCount: p.pdfPageCount,
    compsReturned: p.compsReturned,
    compsQualified: p.compsQualified,
    compsShown: p.compsShown,
    criteria: {
      sameUseCode: p.criteriaSameUseCode,
      livingAreaPct: p.criteriaLivingAreaPct,
      bedDelta: p.criteriaBedDelta,
      bathDelta: p.criteriaBathDelta,
      radiusMiles: num(p.criteriaRadiusMiles),
      months: p.criteriaMonths,
      maxComps: p.criteriaMaxComps ?? DEFAULT_CRITERIA.maxComps,
    },
    creditsCharged: p.sitexCreditsCharged,
    sitexSearchId: p.sitexSearchId,
    canRenderFree: !!p.rawStorageKey,
  };
}

/**
 * The profile shown on an order's Documents tile: the most recent one.
 *
 * A failed attempt is returned too, deliberately. The tile has to be able to
 * say "this failed, and why" — a tile that shows nothing after a spent credit
 * invites a second click and a second credit.
 */
export async function getProfileForOrder(orderId: number): Promise<ProfileSummary | null> {
  const [row] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.orderId, orderId))
    .orderBy(desc(conciergeProfiles.createdAt))
    .limit(1);
  return row ? toSummary(row) : null;
}

export async function getProfile(id: number): Promise<ProfileSummary | null> {
  const [row] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, id)).limit(1);
  return row ? toSummary(row) : null;
}

export async function getProfilePdfKey(id: number): Promise<string | null> {
  const [row] = await db.select({ key: conciergeProfiles.pdfStorageKey })
    .from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  return row?.key ?? null;
}

export interface SpendSnapshot { thisMonth: number; allTime: number }

/**
 * What the operator is shown at the confirmation step.
 *
 * Summed from credits actually charged, not from row counts, so a retried
 * generation cannot understate the spend. SiteX's production balance endpoint
 * returns INT32_MAX, so this is the only number that means anything.
 */
export async function getSpendSnapshot(): Promise<SpendSnapshot> {
  const [row] = await db.select({
    allTime: sql<number>`coalesce(sum(${conciergeProfiles.sitexCreditsCharged}), 0)`,
    thisMonth: sql<number>`coalesce(sum(${conciergeProfiles.sitexCreditsCharged}) filter (
      where ${conciergeProfiles.createdAt} >= date_trunc('month', now() at time zone 'America/Los_Angeles')
    ), 0)`,
  }).from(conciergeProfiles);
  return { thisMonth: Number(row?.thisMonth ?? 0), allTime: Number(row?.allTime ?? 0) };
}
