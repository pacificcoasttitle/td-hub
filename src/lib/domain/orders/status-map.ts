export type OperationalStatus =
  | 'open'
  | 'in_process'
  | 'completed'
  | 'closed'
  | 'canceled'
  | 'duplicate'
  | 'hold';

export type TransactionType = 'Purchase' | 'Refinance' | 'Equity' | 'Other';

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
