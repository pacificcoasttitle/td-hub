import { ACTIVE_ORDER_STATUSES, type OperationalStatus } from './status-map';

// ─── Hub queue rail definitions ──────────────────────────────────────────────
//
// One place that names the six piles, so the rail, the list header, the status
// bar and the count endpoint cannot drift apart.
//
// MEASURED against production on 2026-08-24 (7,300 orders) — the numbers matter
// because a queue is only useful if it is smaller than the pile it came from:
//
//   TDY  opened today (Pacific)          34
//   ADR  missing address                225
//   CLI  no client contact            1,021
//   SYN  last vendor call failed         48   (7-day window — see below)
//   CPL  active with no CPL document   4,014   <-- every active order
//   ALL                                7,300
//
// CPL is flagged deliberately. It is not a filter problem: the whole database
// holds 3 rows in documents where category='cpl', the newest from 2026-07-23,
// against 4,014 active orders. CPL generation does not persist its output, so
// "no CPL issued" is true of essentially every order and the queue reproduces
// the ALL queue minus closed files. The filter matches the spec and the status
// cohort is correct; the underlying data is what makes it useless. Fixing that
// is document persistence — spec §19 question 1 — and belongs to phase 3.

export type HubQueueId =
  | 'today'
  | 'missingAddress'
  | 'noClient'
  | 'syncFailed'
  | 'cplPending'
  | 'all';

export type QueueTone = 'default' | 'warning' | 'error';

export interface HubQueue {
  id: HubQueueId;
  /** Three-letter mono code shown in the 58px rail. */
  code: string;
  /** Full name — list header, aria-label, title attribute, status bar. */
  label: string;
  tone: QueueTone;
  /** 1-based rail position; also the digit shortcut that jumps to it. */
  position: number;
  /** Shown when the queue is empty. For ADR and SYN an empty queue is good news. */
  emptyMessage: string;
}

export const HUB_QUEUES: readonly HubQueue[] = [
  { id: 'today', code: 'TDY', label: 'Opened today', tone: 'default', position: 1,
    emptyMessage: 'Nothing opened today yet.' },
  { id: 'missingAddress', code: 'ADR', label: 'Missing address', tone: 'warning', position: 2,
    emptyMessage: 'Every order has an address.' },
  { id: 'noClient', code: 'CLI', label: 'No client', tone: 'warning', position: 3,
    emptyMessage: 'Every order has a client.' },
  { id: 'syncFailed', code: 'SYN', label: 'Sync failed', tone: 'error', position: 4,
    emptyMessage: 'No failed syncs.' },
  { id: 'cplPending', code: 'CPL', label: 'CPL pending', tone: 'warning', position: 5,
    emptyMessage: 'No CPLs pending.' },
  { id: 'all', code: 'ALL', label: 'All orders', tone: 'default', position: 6,
    emptyMessage: 'Nothing in this queue.' },
] as const;

/** The rail draws a divider above ALL — it is a reset, not a pile. */
export const QUEUE_DIVIDER_BEFORE: HubQueueId = 'all';

export const DEFAULT_QUEUE: HubQueueId = 'today';

const BY_ID = new Map(HUB_QUEUES.map((q) => [q.id, q]));

export function isHubQueueId(value: string | null | undefined): value is HubQueueId {
  return value != null && BY_ID.has(value as HubQueueId);
}

export function hubQueue(id: HubQueueId): HubQueue {
  const q = BY_ID.get(id);
  if (!q) throw new Error(`Unknown hub queue: ${id}`);
  return q;
}

export function queueAtPosition(position: number): HubQueue | null {
  return HUB_QUEUES.find((q) => q.position === position) ?? null;
}

export type HubQueueCounts = Record<HubQueueId, number>;

/**
 * The status cohort the CPL queue is scoped to.
 *
 * Imported, never typed as a literal. 'open' holds 2 rows out of 7,300 because
 * SoftPro opens every order straight into 'in_process'; three features have
 * already been silently broken by scoping to it. See status-map.ts.
 */
export const CPL_QUEUE_STATUSES: readonly OperationalStatus[] = ACTIVE_ORDER_STATUSES;

/**
 * How far back a failed vendor call still counts as "sync failed".
 *
 * A failure older than this with nothing successful since is a stale order, not
 * a live problem. It is also the difference between a 126ms count query and a
 * 4.8s one: vendor_api_logs holds 1.08M rows, 358k of them inside 30 days, and
 * "latest call per order" over that span is a seq scan. Measured on production.
 */
export const SYNC_FAILURE_WINDOW_DAYS = 7;

/** Rail counts are abbreviated above 999 so they fit the 46px tile. */
export function formatQueueCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}
