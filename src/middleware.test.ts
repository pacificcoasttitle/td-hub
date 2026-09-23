import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// ─── A webhook the middleware blocks is not a webhook ───────────────────────
//
// On 2026-09-22 the SendGrid event webhook shipped, fully tested, correct in
// every unit — and received nothing at all. `isPublic()` exempts the SoftPro
// webhooks by prefix and nothing else, so the middleware demanded a Supabase
// session from SendGrid, which has none, and answered:
//
//     401  {"error":"Unauthorized"}
//
// Which is BYTE-IDENTICAL to what the handler itself returns for a batch it
// cannot verify. Probing the live URL therefore "confirmed" the endpoint was
// refusing unsigned events correctly. It was refusing everything, one layer
// earlier, and the handler had never run once.
//
// The only evidence that told the truth was an absence: the handler writes a
// `sendgrid_events_rejected` row on every refusal, and there were none.
//
// So: every webhook route in the tree must be reachable without a session, or
// be named here as deliberately session-gated. A provider cannot log in.

const APP = join(process.cwd(), 'src/app');
const MIDDLEWARE = join(process.cwd(), 'src/middleware.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** '/api/webhooks/sendgrid/events' for every route.ts under app/api/webhooks. */
const webhookRoutes = walk(join(APP, 'api', 'webhooks'))
  .filter((f) => /[\\/]route\.ts$/.test(f))
  .map((f) => `/${relative(APP, f).replace(/\\/g, '/').replace(/\/route\.ts$/, '')}`);

/**
 * Webhook paths that SHOULD require a session — an internal caller that does
 * hold one. Empty today; anything added needs the reason with it.
 */
const DELIBERATELY_SESSION_GATED = new Set<string>([
  // Not a webhook despite the path: a GET that READS the webhook log for the
  // Job Log page, admin-only, called by our own UI with a session. Nothing
  // external posts to it.
  '/api/webhooks/log',
]);

// Imported rather than re-implemented: a copy of the rules would drift from
// the rules, and agree with itself while the site disagreed.
const { isPublicForTest } = await import('./middleware');

describe('every webhook is reachable by the provider that calls it', () => {
  it('finds the webhook routes at all', () => {
    // A glob that silently matched nothing would pass forever.
    expect(webhookRoutes.length).toBeGreaterThan(0);
    expect(webhookRoutes).toContain('/api/webhooks/sendgrid/events');
  });

  it.each(webhookRoutes)('%s is public, or named as deliberately gated', (route) => {
    if (DELIBERATELY_SESSION_GATED.has(route)) return;
    expect(
      isPublicForTest(route),
      `${route} requires a Supabase session. The provider calling it has none, so every `
      + 'delivery gets 401 — and the middleware\'s 401 body is identical to a handler\'s, '
      + 'so this failure is invisible from outside. Exempt it in isPublic(), or add it to '
      + 'DELIBERATELY_SESSION_GATED with the reason.',
    ).toBe(true);
  });
});

describe('what stays behind the session', () => {
  it('keeps ordinary API routes gated', () => {
    // The exemption must be a prefix on webhooks, not a hole under /api.
    expect(isPublicForTest('/api/reports')).toBe(false);
    expect(isPublicForTest('/api/concierge/profiles')).toBe(false);
    expect(isPublicForTest('/api/contacts')).toBe(false);
  });

  it('keeps the admin pages gated', () => {
    expect(isPublicForTest('/admin/reports')).toBe(false);
    expect(isPublicForTest('/sales/reports')).toBe(false);
  });

  it('does not exempt a path that merely looks like a webhook', () => {
    expect(isPublicForTest('/api/webhooks-admin/settings')).toBe(false);
    expect(isPublicForTest('/api/fake/webhooks/sendgrid/events')).toBe(false);
  });

  it('still lets the health check and login through', () => {
    expect(isPublicForTest('/api/health')).toBe(true);
    expect(isPublicForTest('/login')).toBe(true);
  });
});
