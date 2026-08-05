// Per-rep rate limiting for the AI email-draft route.
//
// This route spends real Anthropic credits on every call, so an unthrottled
// endpoint is a credit-burn door: one rep holding down a button, or a script
// with a session cookie, could run up a bill unnoticed.
//
// The counter is DURABLE, not in-memory. On Vercel each request may land on a
// different lambda instance, so an in-process Map would enforce N-per-window
// PER INSTANCE — effectively no limit under load, and the failure would be
// invisible. Counting rows in vendor_api_logs instead means the limit holds
// across instances, survives cold starts, and shows up in the vendor logs the
// ops page already reads.

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

export const ANTHROPIC_VENDOR = 'anthropic';
export const DRAFT_OPERATION = 'crm_email_drafts';

/** Calls one rep may make in the window. Generous for real use, cheap to abuse. */
export const RATE_LIMIT_PER_REP = 20;
export const RATE_LIMIT_WINDOW_MINUTES = 60;

export interface RateLimitVerdict {
  allowed: boolean;
  used: number;
  limit: number;
  /** Seconds until the window frees up. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

/**
 * Counts this rep's draft calls in the trailing window.
 *
 * Fails CLOSED on a database error: if we cannot count, we cannot know we are
 * inside the budget, and the safe default for a spend-money endpoint is to
 * refuse rather than wave it through.
 */
export async function checkDraftRateLimit(profileId: string): Promise<RateLimitVerdict> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000);

  try {
    const [row] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(vendorApiLogs)
      .where(and(
        eq(vendorApiLogs.vendor, ANTHROPIC_VENDOR),
        eq(vendorApiLogs.operation, DRAFT_OPERATION),
        gte(vendorApiLogs.createdAt, since),
        sql`${vendorApiLogs.requestMeta}->>'profileId' = ${profileId}`,
      ));

    const used = Number(row?.used ?? 0);
    return {
      allowed: used < RATE_LIMIT_PER_REP,
      used,
      limit: RATE_LIMIT_PER_REP,
      retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60,
    };
  } catch {
    return {
      allowed: false,
      used: RATE_LIMIT_PER_REP,
      limit: RATE_LIMIT_PER_REP,
      retryAfterSeconds: 60,
    };
  }
}

/**
 * Records one attempt. This row IS the rate-limit counter, so it is written for
 * failures too — a call that errored still cost us the request, and not logging
 * it would let a failing loop retry without limit.
 *
 * Never throws: a logging failure must not turn a successful draft into an error
 * for the rep. It does mean that call goes uncounted, which is the right way
 * round — the alternative is failing a request we already paid for.
 */
export async function recordDraftCall(params: {
  profileId: string;
  clientId: number;
  success: boolean;
  startedAt: Date;
  errorCategory?: string | null;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}): Promise<void> {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: ANTHROPIC_VENDOR,
      operation: DRAFT_OPERATION,
      startedAt: params.startedAt,
      endedAt: new Date(),
      success: params.success,
      errorCategory: params.errorCategory ?? null,
      // No prompt, no client name, no note text — the counter needs an identity
      // to group by, not the content of the email.
      requestMeta: {
        profileId: params.profileId,
        clientId: params.clientId,
        model: params.model ?? null,
      },
      responseMeta: params.usage
        ? {
          inputTokens: params.usage.input_tokens ?? null,
          outputTokens: params.usage.output_tokens ?? null,
        }
        : null,
    });
  } catch {
    /* best effort — never fail the rep's request over telemetry */
  }
}
