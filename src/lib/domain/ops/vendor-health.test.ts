import { describe, expect, it } from 'vitest';
import {
  classifyVendorStatus,
  MIN_SAMPLE_FOR_ALERT,
  statusExplanation,
  successPct,
  VENDOR_STATUS_LABEL,
} from './vendor-health';

describe('classifyVendorStatus', () => {
  it('reports no calls as inactive', () => {
    expect(classifyVendorStatus({ total: 0, success: 0 })).toBe('inactive');
  });

  // ── The regression this whole change exists to prevent ────────────────────
  it('does NOT call a 3-call vendor with 1 failure critical', () => {
    expect(classifyVendorStatus({ total: 3, success: 2 })).toBe('low_volume');
  });

  it('still calls a high-volume vendor with the same percentage critical', () => {
    // Same 66% success, but over a real sample.
    expect(classifyVendorStatus({ total: 3000, success: 2000 })).toBe('critical');
  });

  it('treats a clean low-volume run as healthy, not a warning', () => {
    expect(classifyVendorStatus({ total: 3, success: 3 })).toBe('healthy');
    expect(classifyVendorStatus({ total: 1, success: 1 })).toBe('healthy');
  });

  it('never returns critical below the sample floor, at any failure rate', () => {
    for (let total = 1; total < MIN_SAMPLE_FOR_ALERT; total++) {
      expect(classifyVendorStatus({ total, success: 0 })).not.toBe('critical');
      expect(classifyVendorStatus({ total, success: 0 })).not.toBe('degraded');
    }
  });

  it('applies the percentage bands once the sample is big enough', () => {
    expect(classifyVendorStatus({ total: 100, success: 99 })).toBe('healthy');   // 99%
    expect(classifyVendorStatus({ total: 100, success: 95 })).toBe('healthy');   // 95% (boundary)
    expect(classifyVendorStatus({ total: 100, success: 94 })).toBe('degraded');  // 94%
    expect(classifyVendorStatus({ total: 100, success: 80 })).toBe('degraded');  // 80% (boundary)
    expect(classifyVendorStatus({ total: 100, success: 79 })).toBe('critical');  // 79%
  });

  it('classifies exactly at the sample floor', () => {
    expect(classifyVendorStatus({ total: MIN_SAMPLE_FOR_ALERT, success: 10 })).toBe('critical');
    expect(classifyVendorStatus({ total: MIN_SAMPLE_FOR_ALERT - 1, success: 10 })).toBe('low_volume');
  });

  it('handles a perfect high-volume vendor', () => {
    expect(classifyVendorStatus({ total: 8040, success: 8040 })).toBe('healthy');
  });
});

describe('successPct', () => {
  it('computes a percentage', () => {
    expect(successPct({ total: 200, success: 100 })).toBe(50);
  });
  it('treats no calls as 100 rather than dividing by zero', () => {
    expect(successPct({ total: 0, success: 0 })).toBe(100);
  });
});

describe('labels and explanations', () => {
  it('avoids alarming words for a small sample', () => {
    expect(VENDOR_STATUS_LABEL.low_volume).toBe('low volume');
    expect(VENDOR_STATUS_LABEL.critical).toBe('failing');
  });

  it('explains why a low-volume vendor is not being judged', () => {
    expect(statusExplanation('low_volume', { total: 3, success: 2 }))
      .toBe('only 3 calls in the last 24h — too few to judge');
    expect(statusExplanation('low_volume', { total: 1, success: 0 }))
      .toBe('only 1 call in the last 24h — too few to judge');
  });

  it('gives counts for a genuine problem', () => {
    expect(statusExplanation('critical', { total: 100, success: 60 }))
      .toBe('40 of 100 calls failed in the last 24h');
  });

  it('says nothing extra when healthy', () => {
    expect(statusExplanation('healthy', { total: 100, success: 100 })).toBeNull();
    expect(statusExplanation('inactive', { total: 0, success: 0 })).toBeNull();
  });
});
