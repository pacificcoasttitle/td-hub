import { pacificYmd } from '@/lib/domain/ops/calendar-day';

// ─── Pure transforms for the hub split-view list ─────────────────────────────
//
// Everything here is a function of its arguments. `now` is always passed in by
// the caller so "today" is testable and so the server and the browser cannot
// disagree about which day it is.
//
// Day boundaries are Pacific, resolved through the same DST-correct helper the
// ops daily report uses. A naive local midnight would flip the day at 5pm
// Pacific for anyone whose machine is on UTC — which is every server.

const TZ = 'America/Los_Angeles';

export type SyncStatus = 'synced' | 'failed' | 'pending';

export interface HubListOrder {
  id: number;
  fileNumber: string;
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  clientName: string | null;
  clientCompany: string | null;
  transactionType: string | null;
  operationalStatus: string | null;
  /** ISO 8601 instant. Null when the order has no opened_at. */
  openedAtIso: string | null;
  syncStatus: SyncStatus;
  county: string | null;
  apn: string | null;
  softproStatus: string | null;
  createdByName: string | null;
}

// ─── Missing fields ──────────────────────────────────────────────────────────

/** Order matters: the banner lists them address, then client, then order type. */
export const INCOMPLETE_FIELDS = ['address', 'client', 'order type'] as const;
export type IncompleteField = typeof INCOMPLETE_FIELDS[number];

export function clientLabel(o: Pick<HubListOrder, 'clientName' | 'clientCompany'>): string | null {
  return nonEmpty(o.clientName) ?? nonEmpty(o.clientCompany);
}

export function missingFields(o: HubListOrder): IncompleteField[] {
  const out: IncompleteField[] = [];
  if (!nonEmpty(o.propertyStreet)) out.push('address');
  if (!clientLabel(o)) out.push('client');
  if (!nonEmpty(o.transactionType)) out.push('order type');
  return out;
}

export function isIncomplete(o: HubListOrder): boolean {
  return missingFields(o).length > 0;
}

/**
 * SoftPro copy with no property on the file. Permanent — Gerard confirmed
 * these are in-house copies, not a sync miss. Street or city present means
 * there is a property, even a thin one; both empty is a shell.
 */
export function isShellOrder(
  o: Pick<HubListOrder, 'propertyStreet' | 'propertyCity'>,
): boolean {
  return !nonEmpty(o.propertyStreet) && !nonEmpty(o.propertyCity);
}

/** "no address, no client and no order type" — for the warning banner. */
export function describeMissing(fields: readonly IncompleteField[]): string {
  const parts = fields.map((f) => `no ${f}`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ─── Address ─────────────────────────────────────────────────────────────────

/**
 * What the 352px list row shows.
 *
 * The spec asks for the trailing ", CA #####" to be stripped. In this database
 * it never needs stripping: order_properties keeps street, city, state and zip
 * in separate columns and the street column holds "118 Trafalgar Ln". So the
 * row renders the street and the pane assembles the full line. No regex, and
 * nothing to get wrong on an address that legitimately contains a comma.
 */
export function listAddress(o: Pick<HubListOrder, 'propertyStreet'>): string | null {
  return nonEmpty(o.propertyStreet);
}

export function fullAddress(o: HubListOrder): string | null {
  const street = nonEmpty(o.propertyStreet);
  const city = nonEmpty(o.propertyCity);
  const stateZip = [nonEmpty(o.propertyState), nonEmpty(o.propertyZip)].filter(Boolean).join(' ');
  const parts = [street, city, stateZip || null].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Type chip ───────────────────────────────────────────────────────────────

export interface TypeChip { letter: string; label: string; text: string; bg: string }

const CHIP_PURCHASE: TypeChip = { letter: 'P', label: 'Purchase', text: '#22558F', bg: '#E8F0FB' };
const CHIP_REFI: TypeChip = { letter: 'R', label: 'Refinance', text: '#5B3E96', bg: '#F2ECFA' };
const CHIP_OTHER: TypeChip = { letter: 'O', label: 'Other', text: '#5C6474', bg: '#F0F1F4' };
const CHIP_UNSET: TypeChip = { letter: '–', label: 'Type not set', text: '#5C6474', bg: '#F0F1F4' };

export function typeChip(transactionType: string | null | undefined): TypeChip {
  const t = transactionType?.trim().toLowerCase();
  if (!t) return CHIP_UNSET;
  if (t === 'purchase') return CHIP_PURCHASE;
  if (t === 'refinance') return CHIP_REFI;
  return CHIP_OTHER;
}

// ─── Time and day grouping ───────────────────────────────────────────────────

/** 'YYYY-MM-DD' for the Pacific calendar day an instant falls in. */
export function pacificDayKey(iso: string | null | undefined): string | null {
  const d = parseInstant(iso);
  if (!d) return null;
  const { year, month, day } = pacificYmd(d);
  return `${year}-${pad(month)}-${pad(day)}`;
}

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
});

/** "4:12p" — the day divider carries the date, so the row only needs the clock. */
export function timeOfDay(iso: string | null | undefined): string | null {
  const d = parseInstant(iso);
  if (!d) return null;
  const parts = TIME_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const suffix = get('dayPeriod').toLowerCase().startsWith('p') ? 'p' : 'a';
  return `${get('hour')}:${get('minute')}${suffix}`;
}

const DIVIDER_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
});

/**
 * "TODAY · MON AUG 24" for today, "FRI · AUG 21" otherwise.
 *
 * Formatted in UTC from the already-resolved Pacific y/m/d, so the label can
 * never disagree with the key the row was grouped under.
 */
export function dayDividerLabel(dayKey: string, todayKey: string | null): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  const parts = DIVIDER_FMT.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday').toUpperCase();
  const monthDay = `${get('month').toUpperCase()} ${get('day')}`;
  return dayKey === todayKey ? `TODAY · ${weekday} ${monthDay}` : `${weekday} · ${monthDay}`;
}

/** "Mon Aug 24, 10:47a" — the absolute stamp, for the detail pane's Order grid. */
export function fullDateTime(iso: string | null | undefined): string | null {
  const d = parseInstant(iso);
  if (!d) return null;
  const { year, month, day } = pacificYmd(d);
  const parts = DIVIDER_FMT.formatToParts(new Date(Date.UTC(year, month - 1, day, 12)));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')}, ${timeOfDay(iso)}`;
}

export interface DayGroup<T> {
  dayKey: string;
  label: string;
  count: number;
  orders: T[];
}

export const NO_DATE_KEY = 'no-date';

/**
 * Group rows into consecutive Pacific-day runs, preserving arrival order.
 *
 * It does NOT sort. The server decides the order and a client-side re-sort
 * here would make the list disagree with the Sort control — the same class of
 * defect as a comps table disagreeing with its map.
 *
 * Rows with no opened_at collect under a trailing NO DATE group rather than
 * being dropped: an order with no date is still an order that needs keying.
 */
export function groupByDay<T extends { openedAtIso: string | null }>(
  rows: readonly T[],
  now: Date,
): DayGroup<T>[] {
  const todayKey = pacificDayKey(now.toISOString());
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const key = pacificDayKey(row.openedAtIso) ?? NO_DATE_KEY;
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) {
      last.orders.push(row);
      last.count += 1;
    } else {
      groups.push({
        dayKey: key,
        label: key === NO_DATE_KEY ? 'NO DATE' : dayDividerLabel(key, todayKey),
        count: 1,
        orders: [row],
      });
    }
  }
  return groups;
}

// ─── Next incomplete ─────────────────────────────────────────────────────────

/**
 * Index of the next incomplete order after `fromIndex`, wrapping at the end.
 *
 * Returns -1 when nothing in the list is incomplete. When the current row is
 * the only incomplete one it returns that same index rather than -1 — pressing
 * Tab again should not silently do nothing that looks like an error.
 */
export function nextIncompleteIndex(
  rows: readonly HubListOrder[],
  fromIndex: number,
): number {
  if (rows.length === 0) return -1;
  const start = fromIndex < 0 ? -1 : fromIndex;
  for (let step = 1; step <= rows.length; step++) {
    const i = (start + step + rows.length * 2) % rows.length;
    if (isIncomplete(rows[i]!)) return i;
  }
  return -1;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function nonEmpty(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
