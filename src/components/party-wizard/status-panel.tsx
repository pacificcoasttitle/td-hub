import type { LinkFailure } from '@/lib/domain/parties/party-wizard-service';

// ─── Terminal states ─────────────────────────────────────────────────────────
//
// Everything that is not a fillable form: submitted, already submitted, and the
// link failures. All of them get the same branded card rather than the bare
// centred paragraph the failures used to render, because a stranger who reaches
// a dead end still needs to be able to tell that they reached a real company.
//
// Card recipe is LIGHT_CARD from src/components/sales/dashboard-kpi.tsx:32-33.

const LIGHT_CARD =
  'rounded-[18px] border border-[#10213A]/[0.07] bg-white shadow-[0_14px_40px_-24px_rgba(16,33,58,0.45)]';

export type PanelTone = 'done' | 'neutral';

const TONE: Record<PanelTone, { ring: string; glyph: string }> = {
  // Green is used the way the dashboard uses it — as an accent on a white
  // surface (MetricCard accent="bg-green-500"), never as the surface itself.
  done: { ring: 'border-emerald-200 bg-emerald-50 text-emerald-700', glyph: '✓' },
  neutral: { ring: 'border-[#FBE0BF] bg-[#FFF4E4] text-[#B4621F]', glyph: '!' },
};

export function StatusPanel({
  tone, title, body, children,
}: {
  tone: PanelTone;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={`${LIGHT_CARD} mt-4 px-5 py-6 sm:px-7`}>
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg font-bold ${t.ring}`}
        aria-hidden
      >
        {t.glyph}
      </div>
      <h2 className="mt-4 font-serif text-[22px] font-semibold tracking-[-0.02em] text-[#10213A]">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">{body}</p>
      {children}
    </div>
  );
}

/**
 * What happens after they submit, stated as the three things that actually
 * happen in submitPartyWizard (party-wizard-service.ts:220-262). No estimate,
 * no promise about anyone calling them back.
 */
export function NextSteps() {
  return (
    <ol className="mt-4 space-y-2 border-t border-[#10213A]/[0.07] pt-4">
      {[
        'Your details are recorded against the file.',
        'They are posted to the order notes, where your escrow officer sees them.',
        'Nobody else is contacted on your behalf.',
      ].map((step, i) => (
        <li key={step} className="flex gap-3 text-sm leading-relaxed text-[#4B5563]">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF4E4] text-[11px] font-bold text-[#B4621F]">
            {i + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Copy for the failure states.
 *
 * There is no 'revoked' and no 'expired' key. Both resolve upstream to
 * 'inactive' (party-wizard-context.ts classifyLinkState), so it is not possible
 * to give them different wording from here even by accident — which is the
 * point, since the difference is exactly what a prober would want to learn.
 */
export const FAILURE_PANEL: Record<LinkFailure, { title: string; body: string }> = {
  invalid: {
    title: 'This link is not valid',
    body: 'It may have been mistyped or truncated when it was forwarded. Ask whoever sent it to you to resend the whole link.',
  },
  inactive: {
    title: 'This link is no longer active',
    body: 'Links stay open for 60 days. The person below can send you a new one.',
  },
  /**
   * A live, signature-valid link for a role that has no form.
   *
   * A new link for the same role fails identically, so this must not share
   * the inactive-state remedy ("ask for a new one"). The contact ladder is
   * the way out — they reply to the named person, who takes the details.
   */
  unsupported: {
    title: 'We cannot collect this detail online yet',
    body: 'This information cannot be entered through an online form. Reply to the person below and they will take your details.',
  },
  misconfigured: {
    title: 'This form is temporarily unavailable',
    body: 'Something on our end is not responding. Please try again shortly.',
  },
  /**
   * Says nothing about the link, on purpose.
   *
   * This card is shown for a real link and for a guessed one alike, so any
   * mention of validity — "your link is fine, but…" — would turn the throttle
   * into the oracle the throttle exists to close. It also says nothing about
   * being blocked: the reader is far more likely to be an agent on hotel wifi
   * sharing an address with a hundred other people than an attacker, and
   * accusing them is both rude and unhelpful.
   */
  throttled: {
    title: 'Please try again in a few minutes',
    body: 'We are limiting how often this page can be opened from one network. Nothing is wrong with your link — wait a few minutes and open it again, or reply to the person who sent it and they will take your details directly.',
  },
};
