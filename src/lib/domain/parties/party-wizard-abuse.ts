import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { getSettings } from '@/lib/domain/settings/service';
import { verifyPartyWizardToken } from './party-wizard-token';

// ─── Abuse control for the unauthenticated party wizard ──────────────────────
//
// /party-wizard/[token] is the only page in TD Hub that serves order data to a
// request with no session. The token is the credential, and it is forwarded by
// hand through at least one inbox we do not control, so we have to assume URLs
// leak. What we can refuse to do is let one host work through a list of them.
//
// STORAGE. Counting rows in vendor_api_logs, which is the pattern
// src/lib/integrations/anthropic/rate-limit.ts already established for exactly
// this reason: on Vercel each request may land on a different lambda, so a Map
// in module scope enforces N-per-window PER INSTANCE — no real limit, and the
// hole is invisible. This repo has no Upstash, no Vercel KV and no Redis (see
// package.json); Postgres is the only durable store available, so Postgres is
// where the counter lives. Same table, same shape, so it also lands in the
// vendor log the Operations page already reads, with no new admin UI.
//
// The counter is the log row. One insert per admitted request, and rows are
// only written while a bucket is under its limit, which is what bounds write
// amplification: a blocked host stops adding rows, so the most it can ever
// cost us is `limit` inserts per window.
//
// FAILURE MODE. Fail-OPEN on infrastructure faults, deliberately. This limiter
// guards a convenience feature; the database it counts in is the same database
// every order in the company depends on. A backstop that turns a Postgres
// hiccup into a dead public page is worse than the enumeration it prevents, so
// every path out of here that is not a real over-limit verdict returns
// `allowed: true` and shouts on the way past. Contrast the Anthropic limiter,
// which fails CLOSED because it guards spend — different asset, different
// default.

export const PARTY_WIZARD_VENDOR = 'party_wizard';

/** operation values written to vendor_api_logs. Prefixed so they read as public traffic. */
export const OP_PAGE_VIEW = 'public_page_view';
export const OP_SUBMIT = 'public_submit';
export const OP_INVALID_TOKEN = 'public_invalid_token';
export const OP_THROTTLED = 'public_throttled';

/**
 * Windows are fixed; the limits inside them are settings-tunable.
 *
 * Two windows rather than one because the two signals have different natural
 * timescales. Burst behaviour (reloads, a second person opening the same link)
 * happens inside minutes, so the volume caps use ten. Breadth — how many
 * DIFFERENT files one host touched, and how many tokens it got wrong — is only
 * meaningful over a longer arc, so those use an hour.
 */
export const BURST_WINDOW_MS = 10 * 60 * 1000;
export const BREADTH_WINDOW_MS = 60 * 60 * 1000;

/** At most one throttle log row per IP per minute, so a blocked host cannot flood the log. */
const BLOCK_LOG_DEDUPE_MS = 60 * 1000;

// ─── Defaults ────────────────────────────────────────────────────────────────
//
// IMPORTANT, and stated plainly because it changes how much these numbers are
// worth: there is no production usage to fit them to. The feature has never
// sent — at the time of writing party_wizard_links holds 2 rows, each accessed
// once, with zero submissions. So these are reasoned from the mechanism, not
// measured from behaviour, and that is precisely why every one of them is a
// setting: the first real week of traffic should retune them without a deploy.

/**
 * Page loads per IP per 10 minutes, signature-valid tokens.
 *
 * Shape being allowed for: one recipient opens the link, reloads a few times
 * while typing, comes back on their phone — call it ten. An agent and their
 * assistant behind one office NAT, twenty. An escrow office checking three live
 * links before forwarding them, thirty. 40 clears all of that with room to
 * spare, which is the side to err on: the executive's constraint is that
 * legitimate users must not be blocked.
 *
 * What it still buys: one host is held to 240 page loads an hour, so working
 * through a harvested list of a thousand links takes half a day and leaves a
 * row per request in the vendor log while it happens.
 */
export const DEFAULT_GET_LIMIT = 40;

/**
 * Submissions per IP per 10 minutes.
 *
 * A legitimate party submits once. A typo correction makes two. The existing
 * per-LINK cap is already 5 per 10 minutes (SUBMISSION_RATE_LIMIT), so 6 per IP
 * sits just above it on purpose: it never binds before the per-link cap for
 * someone working on a single file, and only bites when one host is submitting
 * across several different links — which no real party ever does.
 */
export const DEFAULT_POST_LIMIT = 6;

/**
 * Signature-INVALID tokens per IP per hour. The hardest limit here, and the
 * most valuable one.
 *
 * A stranger holding one real link produces valid-token traffic forever and
 * looks identical to the intended recipient. Someone guessing produces invalid
 * tokens, and the HMAC catches those for the price of one hash before any query
 * runs (verifyPartyWizardToken), so this signal is both the cleanest and the
 * cheapest we have.
 *
 * Legitimate invalid tokens do happen: a link truncated by a mail client gives
 * the recipient one or two failed opens before they give up and ask for a
 * resend. 6 an hour covers that and nothing beyond it. Tripping it darkens the
 * IP for ALL party wizard traffic for the hour, valid tokens included — the
 * point of separating the signal is to be able to act on it harder.
 */
export const DEFAULT_INVALID_LIMIT = 6;

/**
 * DISTINCT tokens per IP per hour.
 *
 * The breadth check, and the only one that catches the case the volume caps
 * cannot: a compromised escrow mailbox holding fifty real links, opened slowly.
 * Each request is individually unremarkable and every token passes the HMAC, so
 * nothing else here would notice.
 *
 * Legitimate breadth is 1. An office forwarding several files at once might
 * reach 3. 10 an hour is far above any honest pattern and far below a scrape.
 */
export const DEFAULT_DISTINCT_TOKEN_LIMIT = 10;

export const SETTING_GET_LIMIT = 'party_wizard_get_limit_per_ip';
export const SETTING_POST_LIMIT = 'party_wizard_post_limit_per_ip';
export const SETTING_INVALID_LIMIT = 'party_wizard_invalid_limit_per_ip';
export const SETTING_DISTINCT_TOKEN_LIMIT = 'party_wizard_distinct_tokens_per_ip';

export interface AbuseLimits {
  get: number;
  post: number;
  invalid: number;
  distinctTokens: number;
}

const DEFAULT_LIMITS: AbuseLimits = {
  get: DEFAULT_GET_LIMIT,
  post: DEFAULT_POST_LIMIT,
  invalid: DEFAULT_INVALID_LIMIT,
  distinctTokens: DEFAULT_DISTINCT_TOKEN_LIMIT,
};

/**
 * Read the tunables. Any failure yields the compiled-in defaults rather than
 * propagating: an unreadable settings table must not decide whether a public
 * page renders.
 */
export async function loadAbuseLimits(): Promise<AbuseLimits> {
  try {
    const raw = await getSettings([
      SETTING_GET_LIMIT, SETTING_POST_LIMIT, SETTING_INVALID_LIMIT, SETTING_DISTINCT_TOKEN_LIMIT,
    ]);
    return {
      get: positiveIntOr(raw[SETTING_GET_LIMIT], DEFAULT_GET_LIMIT),
      post: positiveIntOr(raw[SETTING_POST_LIMIT], DEFAULT_POST_LIMIT),
      invalid: positiveIntOr(raw[SETTING_INVALID_LIMIT], DEFAULT_INVALID_LIMIT),
      distinctTokens: positiveIntOr(raw[SETTING_DISTINCT_TOKEN_LIMIT], DEFAULT_DISTINCT_TOKEN_LIMIT),
    };
  } catch {
    return DEFAULT_LIMITS;
  }
}

/** A zero or a negative would be an accidental full block, so it falls back instead. */
function positiveIntOr(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

// ─── Caller identity ─────────────────────────────────────────────────────────

/** Anything with a header getter — a Headers, or NextRequest.headers. */
export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * The client IP, or null when no header carries one.
 *
 * x-vercel-forwarded-for first because it is set by Vercel's own proxy and is
 * not client-settable. x-forwarded-for is last and only its FIRST hop is used:
 * on Vercel that value is overwritten at the edge, but ordering the trusted
 * header ahead of it means a spoofed x-forwarded-for cannot win anywhere.
 */
export function clientIpFromHeaders(headers: HeaderSource): string | null {
  const vercel = headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel) return firstHop(vercel);

  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;

  const forwarded = headers.get('x-forwarded-for')?.trim();
  if (forwarded) return firstHop(forwarded);

  return null;
}

function firstHop(value: string): string | null {
  const first = value.split(',')[0]?.trim();
  return first ? first : null;
}

/**
 * Salted digest of the IP. The counter needs an identity to group by, not an
 * address, and an unsalted SHA-256 of an IPv4 is reversible by exhausting four
 * billion candidates. Salting with the token secret costs nothing and means the
 * vendor log holds no reversible visitor addresses.
 *
 * A secret rotation changes every hash and so resets the counters. That is a
 * rare, deliberate operation and losing a ten-minute window to it is fine.
 */
export function hashIp(ip: string): string {
  const salt = process.env.PARTY_WIZARD_TOKEN_SECRET ?? 'party-wizard-unsalted';
  return crypto.createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}

// ─── Verdicts ────────────────────────────────────────────────────────────────

export type AbuseOutcome =
  | 'allowed'
  /** Over a limit. The only outcome that blocks. */
  | 'throttled'
  /** No usable client IP. Cannot attribute, so cannot limit. Allowed. */
  | 'no_client_ip'
  /** The counter store failed. Allowed, loudly. */
  | 'store_unavailable';

export interface AbuseVerdict {
  allowed: boolean;
  outcome: AbuseOutcome;
  /** Which limit tripped. Null unless throttled. */
  tripped: 'get' | 'post' | 'invalid' | 'distinct_tokens' | null;
  retryAfterSeconds: number;
}

export type GuardKind = 'page_view' | 'submit';

export interface AbuseCounters {
  getAttempts: number;
  postAttempts: number;
  invalidAttempts: number;
  distinctTokens: number;
  recentBlockLogs: number;
}

/**
 * Every counter this IP needs, in one round trip.
 *
 * FILTER aggregates rather than four queries because this runs on the critical
 * path of a page render. The WHERE clause is bounded by the widest window so
 * the planner can use vendor_logs_created_idx and never touch the million-plus
 * historical rows in this table.
 */
async function readCounters(ipHash: string, now: number): Promise<AbuseCounters> {
  const burstSince = new Date(now - BURST_WINDOW_MS);
  const breadthSince = new Date(now - BREADTH_WINDOW_MS);
  const blockLogSince = new Date(now - BLOCK_LOG_DEDUPE_MS);

  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (
        WHERE operation = ${OP_PAGE_VIEW} AND created_at > ${burstSince}
      )::int AS get_attempts,
      count(*) FILTER (
        WHERE operation = ${OP_SUBMIT} AND created_at > ${burstSince}
      )::int AS post_attempts,
      count(*) FILTER (
        WHERE operation = ${OP_INVALID_TOKEN} AND created_at > ${breadthSince}
      )::int AS invalid_attempts,
      count(DISTINCT request_meta->>'tokenId') FILTER (
        WHERE operation = ${OP_PAGE_VIEW} AND created_at > ${breadthSince}
      )::int AS distinct_tokens,
      count(*) FILTER (
        WHERE operation = ${OP_THROTTLED} AND created_at > ${blockLogSince}
      )::int AS recent_block_logs
    FROM vendor_api_logs
    WHERE vendor = ${PARTY_WIZARD_VENDOR}
      AND created_at > ${breadthSince}
      AND request_meta->>'ipHash' = ${ipHash}
  `) as unknown as Array<Record<string, unknown>>;

  const row = rows[0];

  return {
    getAttempts: intOf(row?.get_attempts),
    postAttempts: intOf(row?.post_attempts),
    invalidAttempts: intOf(row?.invalid_attempts),
    distinctTokens: intOf(row?.distinct_tokens),
    recentBlockLogs: intOf(row?.recent_block_logs),
  };
}

function intOf(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const ALLOWED: AbuseVerdict = {
  allowed: true, outcome: 'allowed', tripped: null, retryAfterSeconds: 0,
};

/**
 * Decide whether to serve this request, and record it.
 *
 * Sequence matters. The HMAC is checked here, before any query, so a guessed
 * token is classified as invalid for the price of one hash and counted against
 * the strict bucket rather than the generous one. The token is verified again
 * downstream by resolvePartyWizardLink — a second HMAC is cheap and it keeps
 * this module out of the service's business.
 *
 * The caller gets nothing back that depends on whether the token was real. A
 * throttled valid token and a throttled guess produce the identical verdict,
 * so the response cannot be used as an oracle.
 */
export async function guardPartyWizardRequest(params: {
  kind: GuardKind;
  token: string;
  headers: HeaderSource;
}): Promise<AbuseVerdict> {
  const { kind, token, headers } = params;

  const ip = clientIpFromHeaders(headers);
  if (!ip) {
    // No attributable caller. Refusing here would mean one changed platform
    // header takes the page down for everyone, so it is allowed and shouted.
    console.error('[party-wizard-abuse] no client IP header; request not rate limited', { kind });
    return { ...ALLOWED, outcome: 'no_client_ip' };
  }

  const ipHash = hashIp(ip);
  // Signature-valid tokens carry a public opaque id that is safe to log; a
  // guess carries nothing we want to keep.
  const verified = verifyPartyWizardToken(token);
  const tokenId = verified.ok ? verified.parsed.tokenId : null;
  const signatureValid = verified.ok;

  let limits: AbuseLimits;
  let counters: AbuseCounters;
  const now = Date.now();
  try {
    [limits, counters] = await Promise.all([loadAbuseLimits(), readCounters(ipHash, now)]);
  } catch (err) {
    // The store is the same Postgres the whole company runs on. If it is
    // unreachable the page still renders; see the FAILURE MODE note above.
    console.error(
      '[party-wizard-abuse] rate limit store unreachable — FAILING OPEN, request served unlimited',
      { kind, signatureValid, error: err instanceof Error ? err.message : String(err) },
    );
    return { ...ALLOWED, outcome: 'store_unavailable' };
  }

  const tripped = evaluate({ kind, signatureValid, tokenId, limits, counters });

  if (tripped) {
    const retryAfterSeconds = Math.ceil(
      (tripped === 'invalid' || tripped === 'distinct_tokens' ? BREADTH_WINDOW_MS : BURST_WINDOW_MS) / 1000,
    );
    // Deduped, so a host hammering a blocked endpoint writes one row a minute
    // rather than one a request.
    if (counters.recentBlockLogs === 0) {
      await recordAttempt({
        operation: OP_THROTTLED,
        ipHash,
        tokenId,
        success: false,
        httpStatus: 429,
        meta: { tripped, kind, signatureValid },
      });
    }
    return { allowed: false, outcome: 'throttled', tripped, retryAfterSeconds };
  }

  // Only admitted requests are recorded, and that IS the limiter: the count
  // rises to the cap, blocks, and frees one slot each time the oldest row ages
  // out of the window. It also bounds what a blocked host can make us write.
  await recordAttempt({
    operation: signatureValid ? operationFor(kind) : OP_INVALID_TOKEN,
    ipHash,
    tokenId,
    success: true,
    httpStatus: null,
    meta: { kind },
  });

  return ALLOWED;
}

function operationFor(kind: GuardKind): string {
  return kind === 'submit' ? OP_SUBMIT : OP_PAGE_VIEW;
}

/**
 * Pure threshold comparison, separated so the arithmetic is testable without a
 * database and so the ordering of checks is visible in one place.
 *
 * The invalid-token check runs FIRST and applies to every kind of request. An
 * IP that has been guessing is over budget for valid tokens too — treating the
 * two independently would let a prober keep full access to any real link it
 * happened to find.
 */
export function evaluate(params: {
  kind: GuardKind;
  signatureValid: boolean;
  tokenId: string | null;
  limits: AbuseLimits;
  counters: AbuseCounters;
}): AbuseVerdict['tripped'] {
  const { kind, signatureValid, limits, counters } = params;

  if (counters.invalidAttempts >= limits.invalid) return 'invalid';
  if (!signatureValid) {
    // Not yet over the invalid budget, so this attempt is admitted and counted.
    return null;
  }

  if (kind === 'submit') {
    return counters.postAttempts >= limits.post ? 'post' : null;
  }

  if (counters.getAttempts >= limits.get) return 'get';
  // A token already seen in this window adds no breadth, so a recipient
  // reloading their own link can never trip the distinct-token cap.
  if (counters.distinctTokens >= limits.distinctTokens) return 'distinct_tokens';
  return null;
}

/**
 * Write one counter row.
 *
 * Never throws. A failed insert means one uncounted request, which is the right
 * way round — the alternative is failing a page load over telemetry.
 */
async function recordAttempt(params: {
  operation: string;
  ipHash: string;
  tokenId: string | null;
  success: boolean;
  httpStatus: number | null;
  meta: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: PARTY_WIZARD_VENDOR,
      operation: params.operation,
      startedAt: new Date(),
      endedAt: new Date(),
      success: params.success,
      httpStatus: params.httpStatus,
      errorCategory: params.success ? null : 'rate_limited',
      // No IP, no token secret, no order data. An identity to group by and a
      // public token id, nothing else.
      requestMeta: { ipHash: params.ipHash, tokenId: params.tokenId, ...params.meta },
    });
  } catch (err) {
    console.error('[party-wizard-abuse] failed to record attempt; request uncounted', {
      operation: params.operation,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
