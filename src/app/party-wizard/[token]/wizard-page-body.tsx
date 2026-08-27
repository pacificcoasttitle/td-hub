import type { ResolveResult } from '@/lib/domain/parties/party-wizard-service';
import { counterpartLabel } from '@/lib/domain/parties/party-wizard-context';
import { LegitimacyHeader } from '@/components/party-wizard/legitimacy-header';
import { ContactBlock } from '@/components/party-wizard/contact-block';
import { FAILURE_PANEL, StatusPanel } from '@/components/party-wizard/status-panel';
import { PartyWizardForm } from './party-wizard-form';

// ─── Everything the page renders ─────────────────────────────────────────────
//
// Split out from page.tsx so it can be rendered in a test without a database.
// That split exists for one test in particular: the NEVER-list assertion in
// party-wizard-page.test.tsx renders every state through THIS component and
// checks that no price, loan amount, lender or third-party contact appears in
// the markup. Composing the same subtree by hand in the test would let the page
// and the thing under test drift apart, which would make the assertion
// worthless exactly when it mattered.
//
// Only the shell chrome (logo, background, footer) stays in page.tsx, because
// it is static and carries no order data.

export function WizardPageBody({
  token,
  resolved,
}: {
  token: string;
  resolved: ResolveResult;
}) {
  if (!resolved.ok) {
    const copy = FAILURE_PANEL[resolved.reason] ?? FAILURE_PANEL.invalid;
    const order = resolved.order;

    // With a file, the hero carries the message and the card carries the way
    // out. Without one there is no hero to carry anything, so the panel does
    // both. Saying it in the hero AND in a panel directly beneath it reads as
    // a rendering fault rather than as emphasis.
    if (!order) {
      return (
        <>
          <BrandOnlyHeader />
          <StatusPanel tone="neutral" title={copy.title} body={copy.body} />
        </>
      );
    }

    return (
      <>
        <LegitimacyHeader context={order} headline={copy.title} eyebrow="Link status" />
        <ContactBlock
          contact={order.contact}
          lead={copy.body}
          heading="Ask for a new link"
          emailSubject={`New link for file ${order.fileNumber}`}
        />
      </>
    );
  }

  const { link } = resolved;

  return (
    <>
      {/* The header is rendered by the form on this path, not here — see the
          note on PartyWizardForm's `context` prop. */}
      <PartyWizardForm
        token={token}
        tokenId={link.tokenId}
        form={link.form}
        previousValues={link.previousValues}
        alreadySubmitted={link.alreadySubmitted}
        counterpartLabel={counterpartLabel(link.role)}
        context={link.order}
      />

      <ContactBlock
        contact={link.order.contact}
        emailSubject={`File ${link.order.fileNumber}`}
      />
    </>
  );
}

/**
 * The header for a token we cannot tie to an order — mistyped, truncated, or
 * never ours. There is no file to name, so it carries the brand and nothing
 * else, which is still the thing a suspicious reader is checking for.
 */
function BrandOnlyHeader() {
  return (
    <div className="rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,#2C3564_0%,#15193A_100%)] px-6 py-[22px] shadow-[0_22px_55px_-26px_rgba(16,33,58,0.55)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-bold leading-tight tracking-[0.1px] text-white">
          PACIFIC COAST TITLE COMPANY
        </p>
        {/* Hidden on a phone for the same reason as in LegitimacyHeader: at
            390px it pushes the wordmark onto two lines. */}
        <p className="hidden shrink-0 text-[10px] font-bold uppercase tracking-[1.45px] text-[#9EA7C2] sm:block">
          Transaction Desk Hub
        </p>
      </div>
      <div className="mt-3 h-[2px] w-full bg-[#F26B2B]" />
    </div>
  );
}
