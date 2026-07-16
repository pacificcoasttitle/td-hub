import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapStatus, mapTransactionType } from './status-map';

describe('mapStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps Hold -> hold', () => {
    expect(mapStatus('Hold')).toBe('hold');
    expect(mapStatus('hold')).toBe('hold');
  });

  it('maps known SoftPro statuses', () => {
    expect(mapStatus('Open')).toBe('open');
    expect(mapStatus('In Process')).toBe('in_process');
    expect(mapStatus('Completed')).toBe('completed');
    expect(mapStatus('Closed')).toBe('closed');
    expect(mapStatus('Canceled')).toBe('canceled');
    expect(mapStatus('Duplicate')).toBe('duplicate');
  });

  it('returns null for unknown status and logs the raw value (never guesses open)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(mapStatus('Pending Supervisor Review')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[mapStatus] Unknown SoftPro status — preserving existing (not guessing open)',
      { raw: 'Pending Supervisor Review' },
    );
  });

  it('returns null for blank status', () => {
    expect(mapStatus('')).toBeNull();
    expect(mapStatus(null)).toBeNull();
    expect(mapStatus(undefined)).toBeNull();
  });
});

describe('mapTransactionType', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps known types', () => {
    expect(mapTransactionType('Purchase')).toBe('Purchase');
    expect(mapTransactionType('Refinance')).toBe('Refinance');
    expect(mapTransactionType('Equity')).toBe('Equity');
    expect(mapTransactionType('Other')).toBe('Other');
  });

  it('returns null for unknown type (never guesses Other)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(mapTransactionType('1031 Exchange')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[mapTransactionType] Unknown SoftPro transaction type — not guessing Other',
      { raw: '1031 Exchange' },
    );
  });
});
