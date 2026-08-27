import type { Metadata } from 'next';
import {
  recordLinkAccess, resolvePartyWizardLink,
} from '@/lib/domain/parties/party-wizard-service';
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
  const resolved = await resolvePartyWizardLink(token);

  if (resolved.ok) await recordLinkAccess(resolved.link.linkId);

  return (
    <PublicPageShell>
      <WizardPageBody token={token} resolved={resolved} />
    </PublicPageShell>
  );
}
