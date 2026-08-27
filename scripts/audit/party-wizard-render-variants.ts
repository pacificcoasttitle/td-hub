/**
 * Render both party wizard invite copy variants for review.
 *
 * The owner reviews copy from real rendered output, not from drafts, so this
 * runs the SHIPPING builders — `buildPartyWizardSubject/Email/Text` — against
 * two real production orders rather than reproducing the wording here.
 *
 * Read-only in the strongest sense: it makes no database connection at all. The
 * two orders below were read once via a read-only query and pasted in, so this
 * can be re-run to re-review copy without touching production or risking a
 * send. The link is a placeholder; a working link requires a write.
 *
 *   npx tsx scripts/audit/party-wizard-render-variants.ts
 */
import { writeFileSync } from 'node:fs';
import {
  buildPartyWizardEmail, buildPartyWizardSubject, buildPartyWizardText,
} from '../../src/lib/domain/parties/party-wizard-email';
import { pickInviteRecipient } from '../../src/lib/domain/parties/party-wizard-recipient';

const LINK = 'https://example.invalid/party-wizard/DRY-RUN-NO-LINK-MINTED';
const OUT = 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/_scratch_untracked';

/** Real rows, read 2026-08-26. Both are current Purchase candidates. */
const ORDERS = [
  {
    label: 'INTERNAL — PCT escrow officer',
    fileNumber: '20020386-GLT',
    propertyAddress: '15222 OSAGE AVE',
    transactionType: 'Purchase',
    openedAt: new Date('2026-07-28T17:26:47Z'),
    sources: {
      officerId: 8996,
      officerName: 'Lupe Vidaca',
      officerEmail: 'lvidaca@pct.com',
      companyExternalEmail: 'lvidaca@pct.com',
      companyExternalName: 'Lupe Vidaca',
      companyExternalCompany: 'Pacific Coast Title Company',
      companyContactEmail: 'lvidaca@pct.com',
      companyContactName: 'Lupe Vidaca',
    },
  },
  {
    label: 'EXTERNAL — outside escrow company, reached by the fallback',
    fileNumber: '20020381-GLT',
    propertyAddress: '108 PINETREE CT',
    transactionType: 'Purchase',
    openedAt: new Date('2026-07-28T17:06:57Z'),
    sources: {
      officerId: null,
      officerName: null,
      officerEmail: null,
      companyExternalEmail: 'ck@goodnewsescrow.com',
      companyExternalName: 'Cindy Kim',
      companyExternalCompany: 'Good News Escrow',
      companyContactEmail: 'ck@goodnewsescrow.com',
      companyContactName: null,
    },
  },
];

for (const order of ORDERS) {
  const recipient = pickInviteRecipient(order.sources);
  if (!recipient) throw new Error(`no recipient resolved for ${order.fileNumber}`);

  const input = {
    fileNumber: order.fileNumber,
    propertyAddress: order.propertyAddress,
    transactionType: order.transactionType,
    recipientName: recipient.name,
    recipientCompany: recipient.company,
    audience: recipient.audience,
    openedAt: order.openedAt,
    roleLinks: [{ role: 'listing_agent' as const, url: LINK }],
  };

  const html = buildPartyWizardEmail(input);
  const text = buildPartyWizardText(input);

  console.log('='.repeat(78));
  console.log(order.label);
  console.log(`file      ${order.fileNumber}`);
  console.log(`to        ${recipient.email}`);
  console.log(`resolved  ${recipient.role}  audience=${recipient.audience}`);
  console.log(`subject   ${buildPartyWizardSubject(input)}`);
  console.log('='.repeat(78));
  console.log(text);
  console.log();

  writeFileSync(`${OUT}/pw-${recipient.audience}.html`, html, 'utf8');
  writeFileSync(`${OUT}/pw-${recipient.audience}.txt`, text, 'utf8');
}

console.log(`HTML and text written to ${OUT}`);
