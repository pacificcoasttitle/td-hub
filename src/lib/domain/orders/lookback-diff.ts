import { mapStatus, type OperationalStatus } from './status-map';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

// Pure comparison logic for the look-back sync.
//
// Kept free of the database and the vendor client so the rules that decide
// "would this order change?" can be tested directly. The handler uses the SAME
// function in dry-run and write mode — the only difference is whether it then
// calls processOrderDetail. That is deliberate: a dry run that computed its
// answer differently from the real pass would not be a rehearsal of anything.

/**
 * Look-back window, in days since `opened_at`.
 *
 * Measured drift by age band (verify_sync, 195 checks over 5 runs):
 *   <30d    45 checked,  0 drifted   0.0%
 *   30-90d  85 checked, 26 drifted  30.6%
 *   90-180d 58 checked,  9 drifted  15.5%
 *   >180d    7 checked,  0 drifted   (too few to trust)
 *
 * Under 30 days is excluded because the hourly GetOrders(today, today) sync
 * still covers those orders — 45 consecutive samples found zero drift. Over 180
 * days is excluded because there is no evidence of drift there and the
 * population is 219 orders.
 */
export const LOOKBACK_MIN_AGE_DAYS = 30;
export const LOOKBACK_MAX_AGE_DAYS = 180;

/**
 * How look-back-written `order_status_history` rows are tagged.
 *
 * The design called for `source: 'lookback_sync'`. That is NOT possible without
 * a migration: `status_change_source` is a Postgres enum whose only values are
 * softpro_sync | manual | system | webhook, so writing 'lookback_sync' fails
 * with `invalid input value for enum`. Adding it needs ALTER TYPE, and this
 * work is explicitly migration-free.
 *
 * So the tag is a legal enum value ('system' — this IS a system-initiated
 * change, not a SoftPro push) plus a stable marker at the front of `notes`.
 * The activity feed filters on the marker. It is precise, needs no schema
 * change, and if the one-line enum migration is later approved, switching to a
 * dedicated source value is a two-constant edit.
 */
export const LOOKBACK_STATUS_SOURCE = 'system' as const;

/** Marker prefixed to `order_status_history.notes` for look-back rows. */
export const LOOKBACK_NOTE_PREFIX = '[lookback_sync]';

/** Statuses meaning SoftPro considers the file finished. */
const TERMINAL = new Set<OperationalStatus>(['closed', 'completed', 'canceled', 'duplicate']);

export type LookbackBand = '30-90d' | '90-180d' | 'other';

export function bandFor(ageDays: number): LookbackBand {
  if (ageDays >= LOOKBACK_MIN_AGE_DAYS && ageDays < 90) return '30-90d';
  if (ageDays >= 90 && ageDays < LOOKBACK_MAX_AGE_DAYS) return '90-180d';
  return 'other';
}

export interface LookbackOrderRow {
  id: number;
  fileNumber: string;
  operationalStatus: string | null;
  salesPrice: string | null;
  loanAmount: string | null;
  band: LookbackBand;
}

export interface OrderDiff {
  /** Null when SoftPro's status is missing or unrecognised — see `usable`. */
  statusTo: OperationalStatus | null;
  statusFrom: string | null;
  /** True when the order's operational_status would change. */
  statusChanged: boolean;
  /** True when the new status is a terminal one (the drift we are correcting). */
  becameTerminal: boolean;
  /** Raw SoftPro status string, for reporting what it drifted to. */
  rawStatus: string | null;
  /**
   * Non-status fields that would gain or change a value. Reporting only — the
   * actual write is processOrderDetail's, and it may legitimately update more.
   */
  fieldChanges: string[];
  /**
   * False when we learned nothing usable about this order. The caller MUST
   * count these as unchecked, never as "no change".
   */
  usable: boolean;
}

function normalizeMoney(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n === 0 ? null : n.toFixed(2);
}

/**
 * What would change if we applied `item` to `row`.
 *
 * An unrecognised or missing SoftPro status yields `usable: false` rather than
 * "no change". Treating "we could not read it" as "it is fine" is exactly how a
 * bad vendor day would read as an improvement.
 */
export function diffOrder(
  row: LookbackOrderRow,
  item: SoftProOrderDetailItem | null,
): OrderDiff {
  const empty: OrderDiff = {
    statusTo: null, statusFrom: row.operationalStatus, statusChanged: false,
    becameTerminal: false, rawStatus: null, fieldChanges: [], usable: false,
  };
  if (!item) return empty;

  const mapped = mapStatus(item.OrderStatus);
  if (mapped === null) return { ...empty, rawStatus: item.OrderStatus ?? null };

  const statusChanged = mapped !== row.operationalStatus;

  const fieldChanges: string[] = [];
  const incomingPrice = normalizeMoney(item.SalesPrice);
  if (incomingPrice !== null && incomingPrice !== normalizeMoney(row.salesPrice)) {
    fieldChanges.push('salesPrice');
  }
  // LoanAmount is not in the GetOrderDetails contract yet (Aashima's team is
  // adding it). Reading it defensively means the day it ships, this job starts
  // reporting it with no code change.
  const incomingLoan = normalizeMoney(
    (item as unknown as { LoanAmount?: string | null }).LoanAmount,
  );
  if (incomingLoan !== null && incomingLoan !== normalizeMoney(row.loanAmount)) {
    fieldChanges.push('loanAmount');
  }

  return {
    statusTo: mapped,
    statusFrom: row.operationalStatus,
    statusChanged,
    becameTerminal: statusChanged && TERMINAL.has(mapped),
    rawStatus: item.OrderStatus ?? null,
    fieldChanges,
    usable: true,
  };
}

export interface LookbackCounts {
  examined: number;
  checked: number;
  unchecked: number;
  corrected: number;
  correctedTo: Record<string, number>;
  byBand: Record<string, { checked: number; corrected: number }>;
  fieldsChanged: Record<string, number>;
}

export function emptyCounts(): LookbackCounts {
  return {
    examined: 0, checked: 0, unchecked: 0, corrected: 0,
    correctedTo: {}, byBand: {}, fieldsChanged: {},
  };
}

/** Folds one order's diff into the running counts. */
export function accumulate(counts: LookbackCounts, band: LookbackBand, diff: OrderDiff): void {
  counts.examined++;
  if (!diff.usable) {
    counts.unchecked++;
    return;
  }
  counts.checked++;
  counts.byBand[band] ??= { checked: 0, corrected: 0 };
  counts.byBand[band]!.checked++;

  if (diff.statusChanged) {
    counts.corrected++;
    counts.byBand[band]!.corrected++;
    const key = diff.rawStatus ?? diff.statusTo ?? 'unknown';
    counts.correctedTo[key] = (counts.correctedTo[key] ?? 0) + 1;
  }
  for (const f of diff.fieldChanges) {
    counts.fieldsChanged[f] = (counts.fieldsChanged[f] ?? 0) + 1;
  }
}

/**
 * Correction rate over `checked`.
 *
 * The denominator is `checked`, never `examined`: a timed-out call taught us
 * nothing, so counting it as a non-correction would make a bad SoftPro day look
 * like a clean population.
 */
export function correctionPct(counts: LookbackCounts): number | null {
  return counts.checked > 0 ? (counts.corrected / counts.checked) * 100 : null;
}
