import {
  ORANGE_TINT,
  PCT_ORANGE,
  TEXT_BODY,
  TEXT_PRIMARY,
  ctaButton,
  emailShell,
  esc,
  fieldTable,
} from '@/lib/domain/notifications/email-layout';
import { roleLabel } from './party-note';
import type { PartyRole } from './party-wizard-fields';

export interface RoleLinkBlock {
  role: PartyRole;
  url: string;
}

/**
 * Who is reading this email, which is NOT the same question as which lookup
 * found them.
 *
 * The invite was written for a PCT escrow officer — a colleague who knows what
 * TD Hub is and does not need PCT introduced. That assumption never held:
 * only 18.2% of the escrow-officer contacts orders point at are on a `@pct.com`
 * address (701 of 3,842). The rest are outside escrow firms — Powerhouse,
 * Corner Escrow, Escrow Options — holding escrow on a file where PCT does the
 * title work only.
 *
 * An external reader needs three things the internal copy does not give them:
 * PCT introduced, the relationship to their file stated, and a way to disregard
 * the message if it is not theirs. Sending them colleague copy reads as a
 * misdirected email, and a misdirected email does not get forwarded — which
 * costs exactly the outcome this job exists for.
 */
export type PartyWizardAudience = 'internal' | 'external';

export interface PartyWizardEmailInput {
  fileNumber: string;
  propertyAddress: string | null;
  transactionType: string | null;
  /** Whoever the invite resolved to: PCT officer or outside escrow holder. */
  recipientName: string | null;
  /** The outside firm, when we have it. Shown to external readers only. */
  recipientCompany?: string | null;
  audience: PartyWizardAudience;
  openedAt: Date;
  roleLinks: RoleLinkBlock[];
}

function missingRoles(input: PartyWizardEmailInput): string {
  return input.roleLinks.map((r) => roleLabel(r.role).toLowerCase()).join(' and ');
}

/**
 * The external subject names PCT, because the internal one does not and an
 * outside reader has no other cue in the inbox list that this is a title
 * company writing about a file they hold.
 */
export function buildPartyWizardSubject(input: PartyWizardEmailInput): string {
  if (input.audience === 'external') {
    return `Pacific Coast Title — ${missingRoles(input)} details needed on file ${input.fileNumber}`;
  }
  return `Missing ${missingRoles(input)} details — file ${input.fileNumber}`;
}

// ─── Shared sentences ────────────────────────────────────────────────────────
//
// The HTML and the plain text used to word the same ask differently ("the
// listing agent details for this file" vs "listing agent details on file X").
// Both bodies now read from one source, so approving the copy approves what both
// recipients see.

function askSentence(input: PartyWizardEmailInput): string {
  const plural = input.roleLinks.length > 1;
  if (input.audience === 'external') {
    return `Pacific Coast Title is handling the title work on this file, which you are holding `
      + `escrow on. We do not have the ${missingRoles(input)} details, so we cannot contact them `
      + `directly. If you have them, please forward the secure link${plural ? 's' : ''} below.`;
  }
  return `We do not have the ${missingRoles(input)} details for this file, so we cannot contact `
    + `them directly. Please forward the secure link${plural ? 's' : ''} below.`;
}

/**
 * The external reader's way out.
 *
 * An outside firm holds escrow on many files for many title companies. If our
 * record of who holds this one is stale, the honest thing is to say so in the
 * email rather than to leave a stranger wondering whether they are obliged to
 * act. Internal readers do not need it — they can open the order.
 */
function misdirectedSentence(input: PartyWizardEmailInput): string | null {
  if (input.audience !== 'external') return null;
  return `If this file is not one of yours, please disregard this message — no reply is needed `
    + `and we will not follow up.`;
}

/**
 * Why it is worth doing now rather than later.
 *
 * Deliberately claims only what is true: the job sends one invite per file and
 * never follows up, and an order with no agent contact leaves the officer as the
 * only route to them. There is no estimated closing date on the record to quote
 * and no service-level promise to invent, so neither appears here.
 *
 * SHARED BY BOTH AUDIENCES, unchanged. It is the sentence the owner approved,
 * and it happens to be true either way: whoever holds escrow is the routing
 * point for anything the missing party needs, whether they work for PCT or not.
 * Rewording it per audience would put an approved sentence back up for review to
 * no purpose.
 */
function consequenceSentence(input: PartyWizardEmailInput): string {
  return `This is the only reminder we send for this file. Until the ${missingRoles(input)} details `
    + `are on the order we have no way to contact them ourselves, so anything they need keeps `
    + `coming back to you.`;
}

function roleBlock(block: RoleLinkBlock): string {
  const label = roleLabel(block.role);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background:${ORANGE_TINT};border-radius:14px;"><tr><td style="padding:20px;">
<p style="margin:0 0 7px;color:${PCT_ORANGE};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Forward this to the ${esc(label.toLowerCase())}</p>
<p style="margin:0 0 16px;color:${TEXT_PRIMARY};font-size:14px;line-height:1.55;">They can enter their own details using this file-specific link. It expires in 60 days.</p>
${ctaButton(`${label} — enter details`, block.url)}
<p style="margin:13px 0 0;color:${TEXT_BODY};font-size:10px;line-height:1.5;word-break:break-all;">${esc(block.url)}</p>
</td></tr></table>`;
}

export function buildPartyWizardEmail(input: PartyWizardEmailInput): string {
  const external = input.audience === 'external';
  const greeting = input.recipientName?.trim()
    ? `Hi ${esc(input.recipientName.trim().split(' ')[0])},`
    : 'Hi,';

  const missing = missingRoles(input);
  const plural = input.roleLinks.length > 1;
  const partyWord = plural ? 'parties' : 'party';

  const detailRows = [
    { label: 'File number', valueHtml: esc(input.fileNumber) },
  ];
  // External readers hold escrow for several title companies at once, so the
  // firm name is what tells them which of their own files this is.
  if (external && input.recipientCompany?.trim()) {
    detailRows.push({ label: 'Escrow held by', valueHtml: esc(input.recipientCompany.trim()) });
  }
  if (input.propertyAddress?.trim()) {
    detailRows.push({ label: 'Property', valueHtml: esc(input.propertyAddress.trim()) });
  }
  if (input.transactionType?.trim()) {
    detailRows.push({ label: 'Transaction', valueHtml: esc(input.transactionType.trim()) });
  }
  detailRows.push({
    label: 'Opened',
    valueHtml: esc(input.openedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Los_Angeles',
    })),
  });

  const misdirected = misdirectedSentence(input);
  // "TD Hub" means nothing to an outside firm; name the company instead.
  const senderWord = external ? 'Pacific Coast Title' : 'TD Hub';

  const body = `<p style="margin:0 0 18px;color:${TEXT_PRIMARY};">${greeting}</p>
<p style="margin:0 0 22px;">${esc(askSentence(input))}</p>
${fieldTable(detailRows)}
${input.roleLinks.map(roleBlock).join('')}
<p style="margin:22px 0 0;color:${TEXT_PRIMARY};font-size:14px;line-height:1.6;font-weight:bold;">${esc(consequenceSentence(input))}</p>
<p style="margin:14px 0 0;font-size:13px;line-height:1.6;">Submitted details are recorded against the file and posted to the order notes. ${esc(senderWord)} will not contact the ${partyWord}—the forward remains yours to make.</p>${
  misdirected ? `\n<p style="margin:14px 0 0;color:${TEXT_BODY};font-size:12px;line-height:1.6;">${esc(misdirected)}</p>` : ''
}`;

  const subject = buildPartyWizardSubject(input);
  return emailShell({
    title: subject,
    // "Action required" is what you say to a colleague. To an outside firm doing
    // us a favour on a file we have no claim over, it is an instruction we are
    // not entitled to give.
    badge: external ? 'Request' : 'Action required',
    preheader: external
      ? `Pacific Coast Title needs the ${missing} details for file ${input.fileNumber}.`
      : `Please help us collect the ${missing} information for this file.`,
    hero: {
      icon: '!',
      eyebrow: external ? 'Title file — party information' : 'Party information',
      headline: plural ? 'A few details are still missing.' : 'One detail is still missing.',
      subcopy: external
        ? `We are handling the title work on this file and cannot reach the ${missing}.`
        : `Please help us collect the ${missing} information for this file.`,
    },
    bodyHtml: body,
  });
}

export function buildPartyWizardText(input: PartyWizardEmailInput): string {
  const external = input.audience === 'external';
  const lines: string[] = [
    input.recipientName?.trim() ? `Hi ${input.recipientName.trim().split(' ')[0]},` : 'Hi,',
    '',
    askSentence(input),
    '',
    `File number: ${input.fileNumber}`,
  ];
  if (external && input.recipientCompany?.trim()) {
    lines.push(`Escrow held by: ${input.recipientCompany.trim()}`);
  }
  if (input.propertyAddress) lines.push(`Property: ${input.propertyAddress}`);
  if (input.transactionType) lines.push(`Transaction: ${input.transactionType}`);
  lines.push('');

  for (const block of input.roleLinks) {
    const label = roleLabel(block.role);
    lines.push(`FORWARD THIS TO THE ${label.toUpperCase()}:`);
    lines.push(block.url);
    lines.push('');
  }

  lines.push(consequenceSentence(input));
  lines.push('');
  lines.push('The link expires in 60 days. Submissions are posted to the order notes.');

  const misdirected = misdirectedSentence(input);
  if (misdirected) lines.push('', misdirected);

  lines.push('', 'Pacific Coast Title Company');
  return lines.join('\n');
}
