import { describe, expect, it } from 'vitest';
import { monthAxisLabels } from './month-axis';

/** The real 12-month window a profile renders on Aug 2026. */
const TWELVE = [
  '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-08',
];

describe('monthAxisLabels', () => {
  it('uses month names instead of numbers', () => {
    const labels = monthAxisLabels(TWELVE).map((l) => l.label);
    // Was: 09 10 11 12 01 02 …
    expect(labels).toEqual([
      'Sep', 'Oct', 'Nov', 'Dec',
      "Jan '26", 'Feb', 'Mar', 'Apr',
      'May', 'Jun', 'Jul', 'Aug',
    ]);
  });

  it('marks the year on January, where the wrap actually is', () => {
    const labels = monthAxisLabels(TWELVE);
    const jan = labels[4]!;
    expect(jan.label).toBe("Jan '26");
    expect(jan.startsYear).toBe(true);
    // December must NOT carry a year — the boundary belongs to January.
    expect(labels[3]!.startsYear).toBe(false);
    expect(labels[3]!.label).toBe('Dec');
  });

  it('flags exactly one year start across a 12-month window', () => {
    expect(monthAxisLabels(TWELVE).filter((l) => l.startsYear)).toHaveLength(1);
  });

  it('dates a short window that contains no January, via the first bar', () => {
    const labels = monthAxisLabels(['2026-05', '2026-06', '2026-07']).map((l) => l.label);
    expect(labels).toEqual(["May '26", 'Jun', 'Jul']);
  });

  it('does not double-date when the range starts in January', () => {
    const labels = monthAxisLabels(['2026-01', '2026-02']);
    expect(labels.map((l) => l.label)).toEqual(["Jan '26", 'Feb']);
    expect(labels.filter((l) => l.startsYear)).toHaveLength(1);
  });

  it('handles a range spanning two year wraps', () => {
    const labels = monthAxisLabels(['2024-12', '2025-01', '2025-12', '2026-01']);
    expect(labels.map((l) => l.label)).toEqual(['Dec', "Jan '25", 'Dec', "Jan '26"]);
  });

  it('is empty-safe', () => {
    expect(monthAxisLabels([])).toEqual([]);
  });
});
