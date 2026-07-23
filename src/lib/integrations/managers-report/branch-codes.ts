/**
 * Boundary adapter: Managers Report display-name keys ↔ TD Hub branch suffix codes.
 * This is the ONLY module allowed to mention MR branch display names.
 * Suffix codes (GLT/OCT/ONT/PRV) are identity everywhere else.
 */

export type BranchCode = 'GLT' | 'OCT' | 'ONT' | 'PRV';

export const BRANCH_CODES: readonly BranchCode[] = ['GLT', 'OCT', 'ONT', 'PRV'] as const;

/** Our presentation labels keyed by code — not MR names. */
export const BRANCH_CODE_LABELS: Record<BranchCode, string> = {
  GLT: 'Glendale',
  OCT: 'Orange County',
  ONT: 'Inland Empire',
  PRV: 'Porterville',
};

export type BranchBucket = { closed: number; revenue: number };

export type ProductionByBranch =
  | {
      available: true;
      locations: Record<BranchCode, BranchBucket>;
      tsg: BranchBucket;
      unassigned: BranchBucket;
    }
  | { available: false; reason: string };

/** MR location display names → suffix code. Variants accepted; identity is the code. */
const MR_LOCATION_KEY_TO_CODE: Record<string, BranchCode> = {
  Glendale: 'GLT',
  Orange: 'OCT',
  'Orange County': 'OCT',
  'Inland Empire': 'ONT',
  Ontario: 'ONT',
  Porterville: 'PRV',
};

const MR_TSG_KEY = 'TSG';
const MR_UNASSIGNED_KEY = 'Unassigned';

const EMPTY_BUCKET: BranchBucket = { closed: 0, revenue: 0 };

function emptyLocations(): Record<BranchCode, BranchBucket> {
  return {
    GLT: { ...EMPTY_BUCKET },
    OCT: { ...EMPTY_BUCKET },
    ONT: { ...EMPTY_BUCKET },
    PRV: { ...EMPTY_BUCKET },
  };
}

function parseBucket(value: unknown): BranchBucket | null {
  if (!value || typeof value !== 'object') return null;
  const closed = (value as { closed?: unknown }).closed;
  const revenue = (value as { revenue?: unknown }).revenue;
  if (typeof closed !== 'number' || !Number.isFinite(closed)) return null;
  if (typeof revenue !== 'number' || !Number.isFinite(revenue)) return null;
  return { closed, revenue };
}

function isBranchCode(value: string): value is BranchCode {
  return (BRANCH_CODES as readonly string[]).includes(value);
}

/** Resolve profiles.branch_id → BranchCode via branches.code (never branches.name). */
export function branchCodeFromDbCode(code: string | null | undefined): BranchCode | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  return isBranchCode(normalized) ? normalized : null;
}

/**
 * Map MR `mtd.productionByBranch` into our typed shape.
 * - Polymorphic: `{ available:false, reason }` OR a branch-key map
 * - Exhaustive: unknown MR key → unavailable (never drop/fold dollars)
 * - Reconciliation: mapped revenue must equal mtd.revenue
 */
export function mapProductionByBranch(
  raw: unknown,
  mtdRevenue: number,
): ProductionByBranch {
  if (raw == null) {
    return { available: false, reason: 'productionByBranch missing from Managers Report response' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { available: false, reason: 'productionByBranch has unexpected shape' };
  }

  const record = raw as Record<string, unknown>;

  // ⚠️ Polymorphic — check available === false BEFORE iterating keys
  if (record.available === false) {
    const reason =
      typeof record.reason === 'string' && record.reason.trim()
        ? record.reason.trim()
        : 'Managers Report marked productionByBranch unavailable';
    return { available: false, reason };
  }

  const locations = emptyLocations();
  let tsg: BranchBucket = { ...EMPTY_BUCKET };
  let unassigned: BranchBucket = { ...EMPTY_BUCKET };

  for (const [key, value] of Object.entries(record)) {
    if (key === 'available' || key === 'reason') continue;

    const bucket = parseBucket(value);
    if (!bucket) {
      console.error(`[productionByBranch] invalid bucket for key=${JSON.stringify(key)}`, value);
      return { available: false, reason: `Invalid productionByBranch bucket for key: ${key}` };
    }

    if (key === MR_TSG_KEY) {
      tsg = bucket;
      continue;
    }
    if (key === MR_UNASSIGNED_KEY) {
      unassigned = bucket;
      continue;
    }

    const code = MR_LOCATION_KEY_TO_CODE[key];
    if (!code) {
      console.error(`[productionByBranch] unknown MR branch key: ${JSON.stringify(key)}`);
      return {
        available: false,
        reason: `Unknown productionByBranch key: ${key}`,
      };
    }

    // Sum if both name variants appear (e.g. Orange + Orange County) — rare; never fold unknowns.
    locations[code] = {
      closed: locations[code].closed + bucket.closed,
      revenue: locations[code].revenue + bucket.revenue,
    };
  }

  const mappedRevenue =
    BRANCH_CODES.reduce((sum, code) => sum + locations[code].revenue, 0)
    + tsg.revenue
    + unassigned.revenue;

  if (Math.abs(mappedRevenue - mtdRevenue) > 0.009) {
    console.error(
      `[productionByBranch] reconciliation failed: mapped=${mappedRevenue} mtd.revenue=${mtdRevenue}`,
    );
    return {
      available: false,
      reason: `Branch split does not tie to mtd.revenue (mapped ${mappedRevenue} vs ${mtdRevenue})`,
    };
  }

  return { available: true, locations, tsg, unassigned };
}

/** Canonical location order for neutral (no-home) rendering. */
export function orderedLocationCodes(homeBranch: BranchCode | null): BranchCode[] {
  if (!homeBranch) return [...BRANCH_CODES];
  return [homeBranch, ...BRANCH_CODES.filter((c) => c !== homeBranch)];
}
