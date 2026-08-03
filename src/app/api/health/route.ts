import { NextResponse } from 'next/server';

/**
 * The commit this build was produced from.
 *
 * Vercel injects VERCEL_GIT_COMMIT_SHA at build time. Surfacing it here makes
 * "did the production alias actually move to my merge?" answerable with one
 * curl, instead of inferring it from a green check plus a 200.
 *
 * Falls back to 'unknown' locally, where the variable is absent. A commit SHA is
 * public information — it is already visible on every commit in the repo — so
 * this adds nothing sensitive to an unauthenticated endpoint.
 */
export function buildSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    app: 'td-hub',
    commit: buildSha(),
    timestamp: new Date().toISOString(),
  });
}
