import type { Metadata } from 'next';
import {
  recordLinkAccess, resolvePartyWizardLink, type LinkFailure,
} from '@/lib/domain/parties/party-wizard-service';
import { PartyWizardForm } from './party-wizard-form';

// ─── Party wizard ────────────────────────────────────────────────────────────
//
// Public, token-gated, and deliberately sparse. This URL is forwarded by hand
// through at least one inbox we do not control, so it must assume it will
// eventually reach the wrong person: it shows the file number and property
// address and nothing else — no names, no emails, no amounts, no parties.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm your details — Pacific Coast Title',
  // A forwarded link should not be indexed or previewed anywhere.
  robots: { index: false, follow: false, nocache: true },
};

const FAILURE_COPY: Record<LinkFailure, { title: string; body: string }> = {
  invalid: {
    title: 'This link is not valid',
    body: 'It may have been mistyped or truncated when it was forwarded. Ask your escrow officer to resend it.',
  },
  revoked: {
    title: 'This link has been withdrawn',
    body: 'Please contact your escrow officer at Pacific Coast Title if you still need to submit your details.',
  },
  expired: {
    title: 'This link has expired',
    body: 'Links stay open for 60 days. Ask your escrow officer for a fresh one.',
  },
  unsupported: {
    title: 'This link cannot be completed online',
    body: 'Please reply to your escrow officer directly.',
  },
  misconfigured: {
    title: 'This form is temporarily unavailable',
    body: 'Please try again shortly, or contact your escrow officer.',
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#F26B2B]">
            Pacific Coast Title
          </p>
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-slate-400">
          Pacific Coast Title Company
        </p>
      </div>
    </main>
  );
}

export default async function PartyWizardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolvePartyWizardLink(token);

  if (!resolved.ok) {
    const copy = FAILURE_COPY[resolved.reason] ?? FAILURE_COPY.invalid;
    return (
      <Shell>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-[#1B2A4A]">{copy.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.body}</p>
        </div>
      </Shell>
    );
  }

  const { link } = resolved;
  await recordLinkAccess(link.linkId);

  return (
    <Shell>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h1 className="text-xl font-semibold text-[#1B2A4A]">{link.form.heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{link.form.intro}</p>

        {/* Minimal order context — enough to recognise the file, no more. */}
        <dl className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm">
          {link.order.propertyAddress && (
            <div className="flex flex-col gap-0.5 border-b border-slate-200 py-2 first:pt-0 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-slate-500">Property</dt>
              <dd className="font-medium text-[#1B2A4A] sm:text-right">{link.order.propertyAddress}</dd>
            </div>
          )}
          <div className="flex flex-col gap-0.5 py-2 last:pb-0 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-slate-500">File number</dt>
            <dd className="font-medium text-[#1B2A4A] sm:text-right">{link.order.fileNumber}</dd>
          </div>
        </dl>

        <PartyWizardForm
          token={token}
          tokenId={link.tokenId}
          form={link.form}
          previousValues={link.previousValues}
          alreadySubmitted={link.alreadySubmitted}
        />
      </div>
    </Shell>
  );
}
