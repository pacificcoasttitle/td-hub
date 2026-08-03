// Vendor health classification for the operations page.
//
// The previous rule was a bare success percentage, which made a vendor with
// 3 calls and 1 failure (66%) rank identically to one failing thousands. A
// percentage over a tiny sample is noise, so volume is now part of the verdict.
// See docs/sitex-and-jobs-page-review.md (Part B).

export type VendorStatus = 'healthy' | 'degraded' | 'critical' | 'low_volume' | 'inactive';

/**
 * Minimum calls before a failure percentage is allowed to raise an alarm.
 * Matches the threshold the daily ops email already uses, so the page and the
 * email can never disagree about whether a vendor is in trouble.
 */
export const MIN_SAMPLE_FOR_ALERT = 20;

export const DEGRADED_BELOW_PCT = 95;
export const CRITICAL_BELOW_PCT = 80;

export interface VendorCounts {
  total: number;
  success: number;
}

export function successPct({ total, success }: VendorCounts): number {
  if (total <= 0) return 100;
  return (success / total) * 100;
}

/**
 * Classifies a vendor from its call counts.
 *
 * - no calls            → inactive
 * - below the sample floor → low_volume (never critical: too few calls to judge)
 * - otherwise the percentage decides
 */
export function classifyVendorStatus(counts: VendorCounts): VendorStatus {
  const { total } = counts;
  if (total <= 0) return 'inactive';

  const pct = successPct(counts);

  if (total < MIN_SAMPLE_FOR_ALERT) {
    // A handful of calls can't support a red alert. Perfect runs still read as
    // healthy; anything less is reported honestly as "too little to tell".
    return pct >= 100 ? 'healthy' : 'low_volume';
  }

  if (pct >= DEGRADED_BELOW_PCT) return 'healthy';
  if (pct >= CRITICAL_BELOW_PCT) return 'degraded';
  return 'critical';
}

/** Plain-English label for a status chip. */
export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  healthy: 'healthy',
  degraded: 'degraded',
  critical: 'failing',
  low_volume: 'low volume',
  inactive: 'not used',
};

/** Short explanation shown under a non-healthy tile. */
export function statusExplanation(status: VendorStatus, counts: VendorCounts): string | null {
  const { total, success } = counts;
  const failed = Math.max(0, total - success);
  switch (status) {
    case 'critical':
      return `${failed} of ${total} calls failed in the last 24h`;
    case 'degraded':
      return `${failed} of ${total} calls failed in the last 24h`;
    case 'low_volume':
      return `only ${total} call${total === 1 ? '' : 's'} in the last 24h — too few to judge`;
    default:
      return null;
  }
}
