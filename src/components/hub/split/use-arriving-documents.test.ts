import { describe, expect, it } from 'vitest';
import type { OrderDocuments } from '@/components/shared/orders-hub-parts';
import {
  arrivingDocsStillMissing,
  overlayDocumentsFromRows,
} from './use-arriving-documents';

const empty = (): OrderDocuments => ({
  cpl: { exists: false, count: 0, latestId: null, latestCreatedAt: null },
  prelim: { exists: false, count: 0, latestId: null, latestCreatedAt: null },
  proposedInsured: { exists: false, count: 0, latestId: null, latestCreatedAt: null },
  legalVesting: { exists: false },
  tax: { exists: false },
  grantDeed: { exists: false },
});

describe('arrivingDocsStillMissing', () => {
  it('is missing when the list row has no arriving docs', () => {
    expect(arrivingDocsStillMissing(empty())).toBe(true);
    expect(arrivingDocsStillMissing(undefined)).toBe(true);
  });

  it('keeps polling until tax lands even if LV and grant deed are present', () => {
    const docs = empty();
    docs.legalVesting = { exists: true };
    docs.grantDeed = { exists: true };
    expect(arrivingDocsStillMissing(docs)).toBe(true);
    docs.tax = { exists: true };
    expect(arrivingDocsStillMissing(docs)).toBe(false);
  });
});

describe('overlayDocumentsFromRows', () => {
  it('flips arriving chips from hub document rows without losing list prelim/CPL', () => {
    const base = empty();
    base.prelim = { exists: true, count: 1, latestId: 9, latestCreatedAt: '2026-08-01T00:00:00.000Z' };
    const next = overlayDocumentsFromRows(base, [
      { id: 5752, category: 'legal_vesting', createdAt: '2026-08-31T17:48:09.000Z' },
      { id: 5754, category: 'tax', createdAt: '2026-08-31T17:50:02.000Z' },
    ]);
    expect(next?.legalVesting.exists).toBe(true);
    expect(next?.tax.exists).toBe(true);
    expect(next?.grantDeed.exists).toBe(false);
    expect(next?.prelim.latestId).toBe(9);
  });

  it('leaves the list snapshot alone when SoftPro-side rows have not arrived yet', () => {
    const base = empty();
    expect(overlayDocumentsFromRows(base, [])).toBe(base);
  });
});
