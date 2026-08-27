import { LitCard } from '@/components/brand/lit-card';
import { formatOrderDate } from '@/lib/domain/orders/date-format';
import type { WizardOrderContext } from '@/lib/domain/parties/party-wizard-service';

/** email-layout.ts:13-14, copied rather than imported so this stays client-safe. */
const PCT_ORANGE = '#F26B2B';
const ORANGE_SOFT = '#FF8A4C';

/**
 * The email hero's warm glow, character for character from
 * email-layout.ts:188. LitCard's own default glow sits at different geometry;
 * this replaces it so the two surfaces are the same recipe and not merely a
 * similar one. hero-gradient.test.ts reads both files and fails if they drift.
 */
const EMAIL_HERO_GLOW = 'radial-gradient(circle at 80% 34%,rgba(242,107,43,.34),transparent 34%)';

// ─── The legitimacy header ───────────────────────────────────────────────────
//
// The problem this solves is not a missing field. It is a listing agent who
// receives a forwarded link to a domain they do not recognise, from a company
// that is not their escrow holder, asking for their phone number.
//
// The check such a person actually performs is to scroll back up to the email
// and compare. So this reuses LitCard, whose base surface
// (src/components/brand/lit-card.tsx:24) is
//   linear-gradient(180deg,#2C3564 0%,#15193A 100%)
// — byte-identical to the email hero at
// src/lib/domain/notifications/email-layout.ts:188 — and repeats the email's
// header row, its orange hairline (#F26B2B), and its #283052 detail chips from
// email-layout.ts:180-184.
//
// The named referrer is the strongest signal available, because on 30.8% of
// candidate orders the escrow officer works for an outside escrow company the
// recipient already deals with, even though they may never have heard of us.

/** Matches the email's trackerContext chip: #283052 panel, #9EA7C2 label. */
function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-white/[0.16] bg-[#283052] px-3.5 py-3">
      <p className="text-[9px] font-bold uppercase tracking-[1.25px] text-[#9EA7C2]">{label}</p>
      <p className="mt-1 break-words text-[13px] font-bold leading-snug text-white">{value}</p>
    </div>
  );
}

/**
 * Who sent them here.
 *
 * Only the escrow officer can be named, because only the escrow officer was
 * emailed. A title officer did not forward anything and must not be described
 * as though they had.
 *
 * With no escrow officer there is nothing true and specific left to say, so the
 * line goes. The generic version — "we are handling the title work on this
 * file" — was a near-verbatim restatement of the form's own intro sitting three
 * centimetres below it, which reads as padding and costs the hero its point.
 */
function referrerLine(context: WizardOrderContext): string | null {
  const contact = context.contact;
  if (contact?.kind !== 'escrow_officer') return null;
  const who = contact.company ? `${contact.name} at ${contact.company}` : contact.name;
  return `${who} asked us to reach you about this file.`;
}

export function LegitimacyHeader({
  context,
  headline,
  /**
   * Mirrors the email's orange badge (email-layout.ts:193), which for this send
   * reads "Action required" (party-wizard-email.ts:111).
   *
   * It is a prop and not a constant because the header sits above every state,
   * including the ones where nothing is required — "ACTION REQUIRED" over
   * "You have already sent these details" is the page contradicting itself in
   * its two largest pieces of type.
   */
  eyebrow,
}: {
  context: WizardOrderContext;
  headline: string;
  eyebrow: string;
}) {
  const opened = context.openedAt ? formatOrderDate(context.openedAt) : null;
  const referrer = referrerLine(context);

  return (
    <LitCard glow={EMAIL_HERO_GLOW}>
      {/* Type sizes, colours and tracking below are lifted from the email's own
          header row (email-layout.ts:190) and hero (193-195), because the check
          a suspicious reader runs is to scroll back up and compare the two. */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-bold leading-tight tracking-[0.1px] text-white">
          PACIFIC COAST TITLE COMPANY
        </p>
        {/* The email is a fixed 640px and never has to make this choice. At
            390px the two labels together force the wordmark onto two lines,
            which looks like a broken header rather than a brand — so on a phone
            the secondary label goes and the wordmark stays whole. */}
        <p className="hidden shrink-0 pt-px text-[10px] font-bold uppercase leading-tight tracking-[1.45px] text-[#9EA7C2] sm:block">
          Transaction Desk Hub
        </p>
      </div>
      <div className="mt-[18px] h-[2px] w-full" style={{ background: PCT_ORANGE }} />

      <p
        className="mt-[26px] text-[10px] font-bold uppercase leading-[1.2] tracking-[1.8px]"
        style={{ color: ORANGE_SOFT }}
      >
        {eyebrow}
      </p>
      <h1 className="mt-[11px] font-serif text-[26px] font-semibold leading-[1.08] tracking-[-0.8px] text-white sm:text-[30px]">
        {headline}
      </h1>
      {referrer && <p className="mt-3 text-sm leading-[1.55] text-[#D8DEE8]">{referrer}</p>}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {context.propertyAddress && <Chip label="Property" value={context.propertyAddress} />}
        <Chip label="File number" value={context.fileNumber} />
      </div>
      {(context.transactionType || opened) && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          {context.transactionType && <Chip label="Transaction" value={context.transactionType} />}
          {opened && <Chip label="Opened" value={opened} />}
        </div>
      )}
    </LitCard>
  );
}
