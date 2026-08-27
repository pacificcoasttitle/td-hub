import type { WizardContact } from '@/lib/domain/parties/party-wizard-context';

// ─── Who to ask ──────────────────────────────────────────────────────────────
//
// A stranger being asked for their contact details needs a person to check with,
// and the block has to hold up when that person has no phone number. It usually
// does not: the escrow officer resolves on 42.7% of candidate orders and carries
// a usable phone on 31.2%, and a sales rep tier that would have taken phone
// coverage to ~87% was declined.
//
// So the phone is treated as a bonus line, never as a slot. Nothing renders a
// dash, an "N/A", or an empty row — the block is built out of the lines that
// exist, and it reads finished with one line or three.
//
// Card recipe is LIGHT_CARD from src/components/sales/dashboard-kpi.tsx:32-33.

const LIGHT_CARD =
  'rounded-[18px] border border-[#10213A]/[0.07] bg-white shadow-[0_14px_40px_-24px_rgba(16,33,58,0.45)]';

const KIND_LABEL: Record<WizardContact['kind'], string> = {
  escrow_officer: 'Escrow officer',
  title_officer: 'Title officer, Pacific Coast Title',
};

function mailto(email: string, subject: string | undefined): string {
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
}

export function ContactBlock({
  contact,
  heading = 'Questions about this request?',
  /**
   * A sentence above the contact, used by the failure states so the page says
   * what happened once instead of repeating the hero headline in a panel of
   * its own directly beneath it.
   */
  lead,
  /** Prefills the mail client, so the file number survives into the reply. */
  emailSubject,
}: {
  contact: WizardContact | null;
  heading?: string;
  lead?: string;
  emailSubject?: string;
}) {
  // Last rung of the ladder. They were forwarded an email by a real person, so
  // pointing them back at it is a genuine route rather than a shrug.
  if (!contact) {
    return (
      <div className={`${LIGHT_CARD} mt-4 px-5 py-4`}>
        {lead && <p className="mb-2 text-sm leading-relaxed text-[#4B5563]">{lead}</p>}
        <p className="text-sm leading-relaxed text-[#1A1A2E]">
          <span className="font-semibold">{heading}</span>{' '}
          <span className="text-[#6B7280]">
            Reply to the email that sent you here and it will reach the right person.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className={`${LIGHT_CARD} mt-4 px-5 py-4`}>
      {lead && (
        <p className="mb-3 border-b border-[#10213A]/[0.07] pb-3 text-sm leading-relaxed text-[#4B5563]">
          {lead}
        </p>
      )}
      <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">{heading}</p>

      <p className="mt-2 text-sm font-semibold text-[#10213A]">{contact.name}</p>
      <p className="text-xs text-[#6B7280]">
        {KIND_LABEL[contact.kind]}
        {contact.company && <span> · {contact.company}</span>}
      </p>

      <div className="mt-2.5 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-4">
        <a
          href={mailto(contact.email, emailSubject)}
          className="font-medium text-[#C2551A] transition-colors hover:text-[#A34716]"
        >
          {contact.email}
        </a>
        {contact.phone && (
          <a
            href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}
            className="font-medium text-[#C2551A] transition-colors hover:text-[#A34716]"
          >
            {contact.phone}
          </a>
        )}
      </div>
    </div>
  );
}
