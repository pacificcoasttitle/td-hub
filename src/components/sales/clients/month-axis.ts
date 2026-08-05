// Axis labels for the orders-by-month chart.
//
// The axis used to read "09 10 11 12 01 02" — every reader had to translate the
// numbers to months in their head, and the year wrap was invisible, so a
// December-to-January boundary looked like a drop from 12 to 1.
//
// Month names fix the translation; a year marker fixes the wrap.

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export interface MonthAxisLabel {
  /** "Sep" or "Jan '26". */
  label: string;
  /** True when this bar starts a new year — the UI can weight it. */
  startsYear: boolean;
}

/**
 * Turns "YYYY-MM" keys into readable axis labels.
 *
 * The year is shown on January, which is where the wrap actually happens. When
 * a range contains no January (a short window), the first bar carries the year
 * instead so the chart is never undated.
 */
export function monthAxisLabels(months: string[]): MonthAxisLabel[] {
  const parsed = months.map((m) => {
    const [y, mm] = m.split('-');
    return { year: Number(y), monthIndex: Number(mm) - 1 };
  });

  const hasJanuary = parsed.some((p) => p.monthIndex === 0);

  return parsed.map((p, i) => {
    const name = MONTH_NAMES[p.monthIndex] ?? '';
    const isJanuary = p.monthIndex === 0;
    // Anchor the range: January carries the year; if there is no January in
    // view, the first bar does the job instead.
    const showYear = isJanuary || (!hasJanuary && i === 0);
    const yy = String(p.year).slice(2);
    return {
      label: showYear ? `${name} '${yy}` : name,
      startsYear: isJanuary,
    };
  });
}
