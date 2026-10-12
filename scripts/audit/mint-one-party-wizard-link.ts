/**
 * Mint ONE party-wizard link for a single order+role. No email. No invite job.
 * Does not touch party_wizard_invite_enabled.
 *
 *   npx tsx --env-file=.env.local scripts/audit/mint-one-party-wizard-link.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partyWizardLinks } from '@/lib/db/schema';
import { findLiveLink, mintLinkForOrder } from '@/lib/domain/parties/party-wizard-service';
import { resolveCounterpartName } from '@/lib/domain/parties/party-wizard-context';

const ORDER_ID = 8123;
const ROLE = 'listing_agent' as const;
const PUBLIC_HOST = 'https://hub.pctdesk.com';
const CREATED_BY = 'manual_walkthrough_8123';

async function main() {
  process.env.NEXT_PUBLIC_APP_URL = PUBLIC_HOST;

  const counterpart = resolveCounterpartName(ROLE, 'HERNANDEZ GERARDO J');
  console.log(`preview.counterpart=${counterpart}`);

  const existing = await findLiveLink(ORDER_ID, ROLE);
  if (existing) {
    console.error(`REFUSED: live link already exists id=${existing.id} for order ${ORDER_ID} ${ROLE}`);
    process.exit(2);
  }

  const minted = await mintLinkForOrder(ORDER_ID, ROLE, CREATED_BY);
  if (!minted) {
    console.error('mintLinkForOrder returned null');
    process.exit(1);
  }

  const [row] = await db
    .select({
      id: partyWizardLinks.id,
      orderId: partyWizardLinks.orderId,
      role: partyWizardLinks.role,
      tokenId: partyWizardLinks.tokenId,
      expiresAt: partyWizardLinks.expiresAt,
      revokedAt: partyWizardLinks.revokedAt,
      usedAt: partyWizardLinks.usedAt,
      accessCount: partyWizardLinks.accessCount,
      submissionCount: partyWizardLinks.submissionCount,
      createdAt: partyWizardLinks.createdAt,
      createdBy: partyWizardLinks.createdBy,
    })
    .from(partyWizardLinks)
    .where(eq(partyWizardLinks.id, minted.linkId))
    .limit(1);

  console.log(JSON.stringify({ minted, row }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
