import type { Metadata } from 'next';
import { headers } from 'next/headers';
import {
  recordLinkAccess, resolvePartyWizardLink, type ResolveResult,
} from '@/lib/domain/parties/party-wizard-service';
import { guardPartyWizardRequest } from '@/lib/domain/parties/party-wizard-abuse';
import { PublicPageShell } from '@/components/party-wizard/public-page-shell';
import { WizardPageBody } from './wizard-page-body';

// ─── Party wizard ────────────────────────────────────────────────────────────
//
// Public, token-gated, and forwarded by hand through at least one inbox we do
// not control. The old page answered that by showing almost nothing, which was
// safe and also the reason nobody would fill it in: a stranger receiving an
// unbranded form asking for their phone number reads it as phishing, and that
// — not a missing field — is what costs the submission.
//
// So it now shows more, but only things the recipient already knows from their
// own role: the property, the file, the transaction, the open date, the person
// who forwarded it, and their own client's name for confirmation. Never a
// price, never a loan amount, never the lender, never another party's contact
// details. See party-wizard-context.ts, and the absence test that enforces it.
//
// ABUSE. Showing more also raises what a scrape is worth, so the GET is rate
// limited per IP before anything is resolved — see party-wizard-abuse.ts.
//
// force-dynamic is load-bearing for that, not just for freshness: a rate limit
// on a statically cached route would be evaluated once at build time and never
// again. If this line is ever removed the limiter silently stops existing.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm your details — Pacific Coast Title',
  // A forwarded link should not be indexed or previewed anywhere.
  robots: { index: false, follow: false, nocache: true },
};

export default async function PartyWizardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const resolved = await resolveWithinLimits(token);

  if (resolved.ok) await recordLinkAccess(resolved.link.linkId);

  return (
    <PublicPageShell>
      <WizardPageBody token={token} resolved={resolved} />
    </PublicPageShell>
  );
}

/**
 * The throttle, in front of resolution.
 *
 * In front rather than after because the whole point is to avoid the work: a
 * blocked request does no token lookup, no order query, and touches no order
 * data, so a throttled valid link and a throttled guess are the same three
 * database-free lines. That is also why the throttled result carries no
 * `order` — there is nothing to leak because nothing was loaded.
 *
 * A page cannot set a response status in the App Router, so this is a 200 with
 * a branded card rather than a 429. The POST route, which can, returns a real
 * 429 with Retry-After. Serving 200 either way is the mildly preferable
 * accident here: a scraper reading status codes learns nothing from it.
 */
async function resolveWithinLimits(token: string): Promise<ResolveResult> {
  const verdict = await guardPartyWizardRequest({
    kind: 'page_view',
    token,
    headers: await headers(),
  });

  if (!verdict.allowed) return { ok: false, reason: 'throttled' };

  return resolvePartyWizardLink(token);
}
