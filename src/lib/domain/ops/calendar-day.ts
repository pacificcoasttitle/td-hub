// Calendar-day boundaries in Pacific time for the daily operations report.
//
// The report previously covered a rolling 24h window ending at send time, which
// meant "yesterday" in the email never matched "yesterday" in conversation.
// These helpers produce a true prior-calendar-day window (midnight to midnight,
// America/Los_Angeles) so the plain-English wording is accurate.

const TZ = 'America/Los_Angeles';

interface Ymd { year: number; month: number; day: number }

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function pacificParts(instant: Date) {
  const map: Record<string, string> = {};
  for (const p of PARTS.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl can emit "24" for midnight in hour12:false; normalise to 0.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset of Pacific time from UTC at a given instant, in minutes (negative west of UTC). */
function pacificOffsetMinutes(instant: Date): number {
  const p = pacificParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * The UTC instant corresponding to midnight Pacific on the given Pacific date.
 * Resolved iteratively so it stays correct across DST transitions, where the
 * offset before and after midnight can differ.
 */
export function pacificMidnightUtc({ year, month, day }: Ymd): Date {
  // First guess assumes -08:00; correct it using the real offset at that guess.
  let instant = new Date(Date.UTC(year, month - 1, day, 8, 0, 0));
  for (let i = 0; i < 3; i++) {
    const offset = pacificOffsetMinutes(instant);
    const corrected = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset * 60_000);
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant;
}

export function pacificYmd(instant: Date): Ymd {
  const p = pacificParts(instant);
  return { year: p.year, month: p.month, day: p.day };
}

export interface CalendarDayWindow {
  /** Inclusive start — midnight Pacific at the beginning of the reported day. */
  start: Date;
  /** Exclusive end — midnight Pacific at the beginning of the following day. */
  end: Date;
  /** The reported day in Pacific terms, for labelling. */
  ymd: Ymd;
}

/**
 * The full calendar day before `now` in Pacific time.
 * Sending at ~6am Pacific means this is always a complete, closed day.
 */
export function previousPacificDay(now: Date): CalendarDayWindow {
  const today = pacificYmd(now);
  const todayMidnight = pacificMidnightUtc(today);
  // Step back 12h from today's midnight and re-read the Pacific date: lands
  // safely on the previous day regardless of a 23- or 25-hour DST day.
  const yesterday = pacificYmd(new Date(todayMidnight.getTime() - 12 * 60 * 60 * 1000));
  return {
    start: pacificMidnightUtc(yesterday),
    end: todayMidnight,
    ymd: yesterday,
  };
}

/** e.g. "Thursday, July 30" — the day the report is about. */
export function formatDayLabel({ year, month, day }: Ymd): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
