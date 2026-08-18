export type OperationalStatus =
  | 'open'
  | 'in_process'
  | 'completed'
  | 'closed'
  | 'canceled'
  | 'duplicate'
  | 'hold';

export type TransactionType = 'Purchase' | 'Refinance' | 'Equity' | 'Other';

// ─── Status cohorts ──────────────────────────────────────────────────────────
//
// USE THESE. Do not hand-roll `operational_status = 'open'`.
//
// 'open' is a trap: it is the word everyone reaches for, and it is nearly
// unused. SoftPro opens every order straight into 'in_process', so 'open' holds
// 2 rows out of ~7,100 while 'in_process' holds 3,886. A query scoped to 'open'
// returns almost nothing and reports success, which is indistinguishable from
// "no work to do".
//
// This has now bitten three times, by three different authors:
//   1. verify_order_sync sampled 2 orders a day and reported a clean run,
//      hiding ~24% status drift for months (since fixed).
//   2. /api/dashboard still reports 2 active orders instead of 3,888.
//   3. party_wizard_invite would have scanned nothing on its first run.
//
// A constant cannot stop someone typing a literal, but it gives the correct
// answer a name and one place to find it.

/**
 * Orders that are live work: not finished, not abandoned.
 * The default cohort for "is this order still going?"
 */
export const ACTIVE_ORDER_STATUSES = ['open', 'in_process'] as const;

/**
 * Live work plus finished-but-not-closed. The right cohort for enrichment and
 * backfill, which are harmless on a completed file and often still wanted
 * there. Matches the predicate the enrichment jobs already used.
 */
export const ENRICHABLE_ORDER_STATUSES = ['open', 'in_process', 'completed'] as const;

/** Orders no longer worth acting on. */
export const INACTIVE_ORDER_STATUSES = ['closed', 'canceled', 'duplicate', 'hold'] as const;

/** Render a cohort as a SQL literal list, e.g. `'open', 'in_process'`. */
export function statusSqlList(statuses: readonly OperationalStatus[]): string {
  return statuses.map((s) => `'${s}'`).join(', ');
}

/**
 * Map SoftPro OrderStatus → operational_status.
 * Returns null for blank/unknown values — callers must preserve existing
 * status on re-process and never silently guess 'open'.
 */
export function mapStatus(raw: string | null | undefined): OperationalStatus | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.toLowerCase().trim();
  switch (s) {
    case 'open': return 'open';
    case 'in process':
    case 'inprocess':
    case 'in_process': return 'in_process';
    case 'completed':
    case 'clear for policy': return 'completed';
    case 'closed': return 'closed';
    case 'canceled':
    case 'cancelled': return 'canceled';
    case 'duplicate': return 'duplicate';
    case 'hold': return 'hold';
    default:
      console.warn('[mapStatus] Unknown SoftPro status — preserving existing (not guessing open)', {
        raw,
      });
      return null;
  }
}

/**
 * Map SoftPro TransactionType. Unknown values return null (do not guess 'Other').
 */
export function mapTransactionType(raw: string | null | undefined): TransactionType | null {
  if (!raw || !raw.trim()) return null;
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'purchase': return 'Purchase';
    case 'refinance':
    case 'refi': return 'Refinance';
    case 'equity':
    case 'home equity': return 'Equity';
    case 'other': return 'Other';
    default:
      console.warn('[mapTransactionType] Unknown SoftPro transaction type — not guessing Other', {
        raw,
      });
      return null;
  }
}
