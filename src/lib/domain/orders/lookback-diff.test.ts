import { describe, expect, it } from 'vitest';
import {
  accumulate,
  bandFor,
  correctionPct,
  diffOrder,
  emptyCounts,
  LOOKBACK_MAX_AGE_DAYS,
  LOOKBACK_MIN_AGE_DAYS,
  LOOKBACK_PHASE2_MAX_AGE_DAYS,
  LOOKBACK_STATUS_SOURCE,
  type LookbackOrderRow,
} from './lookback-diff';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

function row(over: Partial<LookbackOrderRow> = {}): LookbackOrderRow {
  return {
    id: 1, fileNumber: '20020625-OCT', operationalStatus: 'in_process',
    salesPrice: null, loanAmount: null, band: '30-90d', ...over,
  };
}
function item(over: Partial<SoftProOrderDetailItem> = {}): SoftProOrderDetailItem {
  return { OrderNumber: '20020625-OCT', OrderStatus: 'InProcess', SalesPrice: '0' } as SoftProOrderDetailItem;
}
function withStatus(s: string, over: Record<string, unknown> = {}) {
  return { ...item(), OrderStatus: s, ...over } as SoftProOrderDetailItem;
}

describe('window bands', () => {
  it('matches the measured drift bands', () => {
    expect(bandFor(29)).toBe('other');          // under 30d: 0/45 drifted, skipped
    expect(bandFor(LOOKBACK_MIN_AGE_DAYS)).toBe('30-90d');
    expect(bandFor(89)).toBe('30-90d');
    // The ACTIVE sweep stops at 90 (phase 1), but 90-180d stays classifiable
    // so phase-2 reporting needs no change.
    expect(LOOKBACK_MAX_AGE_DAYS).toBe(90);
    expect(bandFor(90)).toBe('90-180d');
    expect(bandFor(179)).toBe('90-180d');
    expect(bandFor(LOOKBACK_PHASE2_MAX_AGE_DAYS)).toBe('other');
    expect(bandFor(400)).toBe('other');
  });
});

describe('the status-history tag must stay enum-legal', () => {
  it('uses a value the status_change_source enum actually has', () => {
    // Writing a value the enum lacks fails at runtime with `invalid input value
    // for enum` — and because a dry run writes nothing, that failure would
    // first appear in production, on the write pass, on every corrected order.
    // 'lookback_sync' is legal ONLY once docs/migration-lookback-sync-enum.sql
    // has been applied; this list must track the database.
    expect(['softpro_sync', 'manual', 'system', 'webhook', 'lookback_sync'])
      .toContain(LOOKBACK_STATUS_SOURCE);
  });

  it('is a typed enum value, not a string marker hidden in notes', () => {
    // Provenance belongs in a column. Guards against regressing to the
    // notes-prefix workaround this replaced.
    expect(LOOKBACK_STATUS_SOURCE).toBe('lookback_sync');
    expect(LOOKBACK_STATUS_SOURCE).not.toContain('[');
  });
});

describe('diffOrder — unreadable orders are never "no change"', () => {
  it('is unusable when SoftPro returned nothing', () => {
    const d = diffOrder(row(), null);
    expect(d.usable).toBe(false);
    expect(d.statusChanged).toBe(false);
  });

  it('is unusable when the status is unrecognised', () => {
    const d = diffOrder(row(), withStatus('Something New'));
    expect(d.usable).toBe(false);
    // It must NOT claim a change, and must not claim correctness either.
    expect(d.statusChanged).toBe(false);
    expect(d.rawStatus).toBe('Something New');
  });

  it('is unusable when the status is blank', () => {
    expect(diffOrder(row(), withStatus('')).usable).toBe(false);
  });
});

describe('diffOrder — status drift', () => {
  it('detects the drift the look-back exists to fix', () => {
    for (const [raw, expected] of [['Closed', 'closed'], ['Completed', 'completed'], ['Canceled', 'canceled']] as const) {
      const d = diffOrder(row(), withStatus(raw));
      expect(d.usable).toBe(true);
      expect(d.statusChanged).toBe(true);
      expect(d.becameTerminal).toBe(true);
      expect(d.statusTo).toBe(expected);
      expect(d.rawStatus).toBe(raw);
    }
  });

  it('reports no change when SoftPro agrees', () => {
    const d = diffOrder(row(), withStatus('InProcess'));
    expect(d.usable).toBe(true);
    expect(d.statusChanged).toBe(false);
    expect(d.becameTerminal).toBe(false);
  });

  it('treats "Clear for Policy" as completed, per the existing status map', () => {
    expect(diffOrder(row(), withStatus('Clear for Policy')).statusTo).toBe('completed');
  });
});

describe('diffOrder — field changes', () => {
  it('ignores a zero sales price, which is what refis send', () => {
    const d = diffOrder(row({ salesPrice: null }), withStatus('InProcess', { SalesPrice: '0' }));
    expect(d.fieldChanges).not.toContain('salesPrice');
  });

  it('reports a real sales price arriving', () => {
    const d = diffOrder(row({ salesPrice: null }), withStatus('InProcess', { SalesPrice: '775000' }));
    expect(d.fieldChanges).toContain('salesPrice');
  });

  it('does not report a sales price that already matches, formatting aside', () => {
    const d = diffOrder(row({ salesPrice: '775000.00' }), withStatus('InProcess', { SalesPrice: '$775,000.00' }));
    expect(d.fieldChanges).not.toContain('salesPrice');
  });

  it('picks up LoanAmount the day the API ships it, with no code change', () => {
    // The field is not in the GetOrderDetails contract yet; this proves the
    // handler will start reporting it as soon as it appears.
    const d = diffOrder(row({ loanAmount: null }), withStatus('InProcess', { LoanAmount: '565000.00' }));
    expect(d.fieldChanges).toContain('loanAmount');
  });

  it('ignores LoanAmount when absent, which is today', () => {
    expect(diffOrder(row(), withStatus('InProcess')).fieldChanges).not.toContain('loanAmount');
  });
});

describe('counts — timeouts must never flatter the rate', () => {
  it('excludes unchecked orders from the denominator', () => {
    const c = emptyCounts();
    accumulate(c, '30-90d', diffOrder(row(), withStatus('Closed')));   // corrected
    accumulate(c, '30-90d', diffOrder(row(), withStatus('InProcess'))); // checked, no change
    accumulate(c, '30-90d', diffOrder(row(), null));                    // unchecked
    accumulate(c, '30-90d', diffOrder(row(), null));                    // unchecked

    expect(c.examined).toBe(4);
    expect(c.checked).toBe(2);
    expect(c.unchecked).toBe(2);
    expect(c.corrected).toBe(1);
    // 1/2 = 50%, NOT 1/4 = 25%. Counting timeouts as "fine" would make a bad
    // SoftPro day look like a clean population.
    expect(correctionPct(c)).toBe(50);
  });

  it('returns null rather than 0% when nothing could be checked', () => {
    const c = emptyCounts();
    accumulate(c, '30-90d', diffOrder(row(), null));
    expect(correctionPct(c)).toBeNull();
    expect(c.checked).toBe(0);
  });

  it('breaks down by band and records what it drifted to', () => {
    const c = emptyCounts();
    accumulate(c, '30-90d', diffOrder(row(), withStatus('Closed')));
    accumulate(c, '30-90d', diffOrder(row(), withStatus('Completed')));
    accumulate(c, '90-180d', diffOrder(row(), withStatus('InProcess')));

    expect(c.byBand['30-90d']).toEqual({ checked: 2, corrected: 2 });
    expect(c.byBand['90-180d']).toEqual({ checked: 1, corrected: 0 });
    expect(c.correctedTo).toEqual({ Closed: 1, Completed: 1 });
  });

  it('tallies field changes across orders', () => {
    const c = emptyCounts();
    accumulate(c, '30-90d', diffOrder(row(), withStatus('InProcess', { SalesPrice: '100' })));
    accumulate(c, '30-90d', diffOrder(row(), withStatus('InProcess', { SalesPrice: '200' })));
    expect(c.fieldsChanged.salesPrice).toBe(2);
  });
});
