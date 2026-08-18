import {
  BORDER_SOFT, CARD_BG, ORANGE_TINT, PCT_ORANGE, TEXT_MUTED, TEXT_PRIMARY,
  button, detailsRow, emailLayout, esc,
} from '@/lib/domain/notifications/email-layout';
import { roleLabel } from './party-note';
import type { PartyRole } from './party-wizard-fields';

// ─── "We're missing party details" email ─────────────────────────────────────
//
// Goes to the ESCROW OFFICER, not to the agent — we usually have no agent email
// (that is the whole point). The officer forwards it, so the forwardable part
// has to be unmistakable and self-contained: an officer skimming on a phone
// should see one labelled block per missing role and know exactly what to send
// on and to whom.
//
// Built around a LIST of role links so v2 roles slot in without a redesign: one
// link renders as one block, three render as three, and the copy adapts.

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

export function buildPartyWizardSubject(input: PartyWizardEmailInput): string {
  const roles = input.roleLinks.map((r) => roleLabel(r.role).toLowerCase()).join(' and ');
  return `Missing ${roles} details — file ${input.fileNumber}`;
}

/**
 * One forwardable block per role. The instruction line sits ABOVE the button so
 * it survives a forward that strips styling, and the raw URL is printed beneath
 * because some mail clients drop the anchor when text is re-quoted.
 */
function roleBlock(block: RoleLinkBlock): string {
  const label = roleLabel(block.role);
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${ORANGE_TINT};border:1px solid ${PCT_ORANGE};border-radius:12px;margin:0 0 16px;">
    <tr><td style="padding:18px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${PCT_ORANGE};">
        Forward this to the ${esc(label.toLowerCase())}
      </p>
      <p style="margin:0 0 14px;font-size:14px;color:${TEXT_PRIMARY};line-height:1.5;">
        The link below lets them enter their own details. It is specific to this file and expires in 60 days.
      </p>
      <table cellpadding="0" cellspacing="0"><tr>${button(`${esc(label)} — enter details`, block.url)}</tr></table>
      <p style="margin:12px 0 0;font-size:11px;color:${TEXT_MUTED};word-break:break-all;">
        ${esc(block.url)}
      </p>
    </td></tr>
  </table>`;
}

export function buildPartyWizardEmail(input: PartyWizardEmailInput): string {
  const greeting = input.escrowOfficerName?.trim()
    ? `Hi ${esc(input.escrowOfficerName.trim().split(' ')[0])},`
    : 'Hi,';

  const missing = input.roleLinks.map((r) => roleLabel(r.role).toLowerCase()).join(' and ');
  const plural = input.roleLinks.length > 1;

  const details = [
    detailsRow('File number', input.fileNumber),
    input.propertyAddress ? detailsRow('Property', input.propertyAddress) : '',
    input.transactionType ? detailsRow('Transaction', input.transactionType) : '',
    detailsRow('Opened', input.openedAt.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
    })),
  ].filter(Boolean).join('');

  const body = `
  <p style="margin:0 0 16px;color:${TEXT_PRIMARY};font-size:15px;">${greeting}</p>

  <p style="margin:0 0 20px;">
    We do not have ${esc(missing)} details on this file yet, so we cannot reach
    them directly. Could you forward the link${plural ? 's' : ''} below?
  </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border:1px solid ${BORDER_SOFT};border-radius:12px;margin:0 0 24px;">
    ${details}
  </table>

  ${input.roleLinks.map(roleBlock).join('')}

  <p style="margin:20px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.6;">
    Whatever they submit is recorded against this file and posted to the order notes,
    so you will see it without having to chase it. Nothing is sent to the
    ${plural ? 'parties' : 'party'} by us — the forward is yours to make.
  </p>`;

  return emailLayout('Party details needed', body);
}

/** Plain-text fallback. Some officers forward from clients that strip HTML. */
export function buildPartyWizardText(input: PartyWizardEmailInput): string {
  const lines: string[] = [
    input.escrowOfficerName?.trim() ? `Hi ${input.escrowOfficerName.trim().split(' ')[0]},` : 'Hi,',
    '',
    `We do not have ${input.roleLinks.map((r) => roleLabel(r.role).toLowerCase()).join(' and ')} details on file ${input.fileNumber} yet.`,
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

  lines.push('The link expires in 60 days. Submissions are posted to the order notes.');
  lines.push('', 'Pacific Coast Title Company');
  return lines.join('\n');
}
