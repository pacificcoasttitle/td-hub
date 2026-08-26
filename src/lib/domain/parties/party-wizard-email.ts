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

export interface PartyWizardEmailInput {
  fileNumber: string;
  propertyAddress: string | null;
  transactionType: string | null;
  escrowOfficerName: string | null;
  openedAt: Date;
  roleLinks: RoleLinkBlock[];
}

function missingRoles(input: PartyWizardEmailInput): string {
  return input.roleLinks.map((r) => roleLabel(r.role).toLowerCase()).join(' and ');
}

export function buildPartyWizardSubject(input: PartyWizardEmailInput): string {
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
  return `We do not have the ${missingRoles(input)} details for this file, so we cannot contact `
    + `them directly. Please forward the secure link${plural ? 's' : ''} below.`;
}

/**
 * Why it is worth doing now rather than later.
 *
 * Deliberately claims only what is true: the job sends one invite per file and
 * never follows up, and an order with no agent contact leaves the officer as the
 * only route to them. There is no estimated closing date on the record to quote
 * and no service-level promise to invent, so neither appears here.
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
  const greeting = input.escrowOfficerName?.trim()
    ? `Hi ${esc(input.escrowOfficerName.trim().split(' ')[0])},`
    : 'Hi,';

  const missing = missingRoles(input);
  const plural = input.roleLinks.length > 1;
  const partyWord = plural ? 'parties' : 'party';

  const detailRows = [
    { label: 'File number', valueHtml: esc(input.fileNumber) },
  ];
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

  const body = `<p style="margin:0 0 18px;color:${TEXT_PRIMARY};">${greeting}</p>
<p style="margin:0 0 22px;">${esc(askSentence(input))}</p>
${fieldTable(detailRows)}
${input.roleLinks.map(roleBlock).join('')}
<p style="margin:22px 0 0;color:${TEXT_PRIMARY};font-size:14px;line-height:1.6;font-weight:bold;">${esc(consequenceSentence(input))}</p>
<p style="margin:14px 0 0;font-size:13px;line-height:1.6;">Submitted details are recorded against the file and posted to the order notes. TD Hub will not contact the ${partyWord}—the forward remains yours to make.</p>`;

  const subject = buildPartyWizardSubject(input);
  return emailShell({
    title: subject,
    badge: 'Action required',
    preheader: `Please help us collect the ${missing} information for this file.`,
    hero: {
      icon: '!',
      eyebrow: 'Party information',
      headline: plural ? 'A few details are still missing.' : 'One detail is still missing.',
      subcopy: `Please help us collect the ${missing} information for this file.`,
    },
    bodyHtml: body,
  });
}

export function buildPartyWizardText(input: PartyWizardEmailInput): string {
  const lines: string[] = [
    input.escrowOfficerName?.trim() ? `Hi ${input.escrowOfficerName.trim().split(' ')[0]},` : 'Hi,',
    '',
    askSentence(input),
    '',
    `File number: ${input.fileNumber}`,
  ];
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
  lines.push('', 'Pacific Coast Title Company');
  return lines.join('\n');
}
