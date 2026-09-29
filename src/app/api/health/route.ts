import { NextResponse } from 'next/server';
// font-files, NOT fonts: the latter imports @react-pdf/renderer to register,
// and a health endpoint has no business carrying a PDF renderer to answer
// "is this file here?".
import { FONT_FILES, missingFonts } from '@/lib/domain/concierge/document/font-files';

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

/**
 * Are the Concierge document's TTFs inside THIS build's bundle?
 *
 * The question is about the deployed function's filesystem, and rule 3 says a
 * local render cannot answer it. The alternative ways to ask all cost
 * something: re-rendering a profile needs a session, and a session is exactly
 * what this endpoint does not have.
 *
 * So it reports file presence instead — `existsSync` against the same paths
 * `registerDocumentFonts()` uses. One unauthenticated curl after a deploy.
 *
 * IT IS A PROXY, NOT PROOF, and the limit is worth stating rather than
 * discovering. `outputFileTracingIncludes` is configured PER ROUTE, and Vercel
 * may put this route and the Concierge routes in different functions with
 * different filesystems. next.config.ts therefore includes the fonts for this
 * route as well — but "health says ok" means the fonts reached THIS bundle.
 *
 * The definitive check is still a PDF rendered by the deployed Concierge
 * function with the fonts embedded in it:
 * scripts/audit/concierge-verify-deployed-render.mts. This one is the cheap
 * early signal that catches a tracing config that never worked at all.
 *
 * Filenames only. No paths, no sizes — a font filename is not sensitive, and
 * the directory layout of the server is not worth publishing.
 */
function fontHealth(): { ok: boolean; expected: number; missing: string[] } {
  try {
    const missing = missingFonts();
    return { ok: missing.length === 0, expected: FONT_FILES.length, missing };
  } catch (err) {
    // Never let a health check be the thing that breaks. An unreadable
    // directory is a finding, not a 500.
    return { ok: false, expected: FONT_FILES.length, missing: [err instanceof Error ? err.message : 'unreadable'] };
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    app: 'td-hub',
    commit: buildSha(),
    timestamp: new Date().toISOString(),
    conciergeFonts: fontHealth(),
  });
}
