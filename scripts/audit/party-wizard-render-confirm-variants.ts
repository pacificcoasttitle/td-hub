/**
 * Render the NEW confirm-axis party-wizard emails for Gerard's review.
 *
 * Does not send. Does not mint. Does not touch the invite job. Uses the
 * unused listing_agent walkthrough URL on 8123, labeled as a sample.
 *
 *   npx tsx scripts/audit/party-wizard-render-confirm-variants.ts
 */
import { writeFileSync } from 'node:fs';
import {
  buildPartyWizardEmail, buildPartyWizardSubject, buildPartyWizardText,
} from '../../src/lib/domain/parties/party-wizard-email';

/** Existing unused listing_agent walkthrough URL on order 8123. Sample only. */
const LINK =
  'https://hub.pctdesk.com/party-wizard/15d9a1dd635833a90353f1f3064b73a6.7VehrBvKHH77mOXxMaVUB1Wr7IAxtgVD.WF5yTRNOXXYKPL2dmKIEow';

const OUT = 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/_scratch_untracked';

const FILE = {
  fileNumber: '20021642-OCT',
  propertyAddress: '1358 5th St, La Verne, CA',
  transactionType: 'Purchase',
  openedAt: new Date('2026-08-31T16:00:00.000Z'),
  roleLinks: [{ role: 'listing_agent' as const, url: LINK }],
  axis: 'confirm' as const,
};

const VARIANTS = [
  {
    label: 'INTERNAL confirm — PCT colleague, no Newport block',
    file: 'pw-20021642-listing_agent-confirm-internal',
    input: {
      ...FILE,
      recipientName: 'Jerry Hernandez',
      audience: 'internal' as const,
    },
  },
  {
    label: 'EXTERNAL confirm — Jerry Hernandez / Newport',
    file: 'pw-20021642-listing_agent-confirm-external',
    input: {
      ...FILE,
      recipientName: 'Jerry Hernandez',
      recipientCompany: 'Newport Financial Associates, Escrow Division',
      audience: 'external' as const,
    },
  },
];

for (const variant of VARIANTS) {
  const html = buildPartyWizardEmail(variant.input);
  const text = buildPartyWizardText(variant.input);
  const subject = buildPartyWizardSubject(variant.input);

  console.log('='.repeat(78));
  console.log(variant.label);
  console.log(`subject   ${subject}`);
  console.log('='.repeat(78));
  console.log(text);
  console.log();

  writeFileSync(`${OUT}/${variant.file}.html`, html, 'utf8');
  writeFileSync(`${OUT}/${variant.file}.txt`, text, 'utf8');
}

console.log(`HTML and text written to ${OUT}`);
console.log('SAMPLE link (existing unused listing_agent walkthrough, not newly minted):');
console.log(LINK);
