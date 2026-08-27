import type { PartyRole } from './party-wizard-fields';

// ─── Structured note posted back to the SoftPro order ────────────────────────
//
// This is the ONLY write v1 makes to SoftPro. AddNotes is verified working on
// both deployed builds; updateOrder party attachment is not, so nothing here
// depends on it.
//
// The note is what the escrow officer actually sees in the file, so it is
// written for a human reading the order — not as a data payload. It is prefixed
// with a stable marker so these notes can be found later, and so a replay job
// can tell its own notes from anything typed by a person.

export const PARTY_NOTE_MARKER = '[TD Hub — Party details collected]';

const ROLE_LABELS: Partial<Record<PartyRole, string>> = {
  listing_agent: 'Listing agent',
  buyer_agent: 'Buyer agent',
  seller: 'Seller',
  buyer: 'Buyer',
  lender: 'Lender',
};

export function roleLabel(role: PartyRole): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}

export interface PartyNoteInput {
  role: PartyRole;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  /** Who filled the form in, when it differs from the party's own email. */
  submitterEmail: string | null;
  submittedAt: Date;
  /** Seller contact supplied alongside, if any. */
  seller?: { name: string | null; email: string | null; phone: string | null } | null;
  /**
   * The name we showed them on the form, when they told us it is wrong.
   *
   * Worth a line of its own rather than a field somewhere: it is a person who
   * knows the file telling us the SiteX owner name is not their client, and
   * that is the only channel we have for that correction.
   */
  counterpartDisputed?: string | null;
}

function line(label: string, value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? `${label}: ${v}` : null;
}

/**
 * Build the note body. Deterministic and free of markup — SoftPro renders it
 * as plain text in the order's notes panel.
 */
export function buildPartyNote(input: PartyNoteInput): string {
  const label = roleLabel(input.role);

  const lines: Array<string | null> = [
    PARTY_NOTE_MARKER,
    '',
    `${label} details were submitted by the ${label.toLowerCase()} via a secure link.`,
    '',
    line('Name', input.name),
    line('Company', input.company),
    line('Email', input.email),
    line('Phone', input.phone),
  ];

  if (input.seller && (input.seller.name || input.seller.email || input.seller.phone)) {
    lines.push('', 'Seller contact (provided by the agent):');
    lines.push(line('  Name', input.seller.name));
    lines.push(line('  Email', input.seller.email));
    lines.push(line('  Phone', input.seller.phone));
  }

  const disputed = input.counterpartDisputed?.trim();
  if (disputed) {
    lines.push(
      '',
      'ACTION: the agent says the owner name on file is wrong.',
      `  We showed them "${disputed}" and they marked it as not their client.`,
    );
  }

  // Only worth stating when it is not the same person, otherwise it is noise.
  const submitter = input.submitterEmail?.trim();
  if (submitter && submitter.toLowerCase() !== input.email?.trim().toLowerCase()) {
    lines.push('', line('Submitted by', submitter));
  }

  lines.push(
    '',
    `Received ${formatNoteDate(input.submittedAt)}.`,
    'Recorded in TD Hub. Not yet written to the SoftPro contact record.',
  );

  return lines.filter((l): l is string => l !== null).join('\n');
}

/** Stable, human-first, and independent of the server locale. */
export function formatNoteDate(d: Date): string {
  const date = d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  });
  return `${date} at ${time} PT`;
}
