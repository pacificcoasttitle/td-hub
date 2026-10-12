/**
 * Send Gerard the 6 party-wizard sample variants (3 roles × 2 audiences)
 * so he can click through like the escrow-officer recipient.
 *
 * Recipients ONLY: ghernandez@pct.com + gerardoh@gmail.com.
 * Does not flip party_wizard_invite_enabled. Does not run the invite job.
 * Does not write notification_logs. sendEmail logs vendor_api_logs only.
 *
 * listing_agent: uses the already-minted unused walkthrough URL on 8123.
 * buyer_agent / lender_contact: mint ONE unused link each on 8123.
 *
 *   npx tsx --env-file=.env.local scripts/audit/send-party-wizard-samples-gerard.ts
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partyWizardLinks, settings } from '@/lib/db/schema';
import {
  buildPartyWizardEmail,
  buildPartyWizardSubject,
  buildPartyWizardText,
  type PartyWizardAudience,
} from '@/lib/domain/parties/party-wizard-email';
import { findLiveLink, mintLinkForOrder } from '@/lib/domain/parties/party-wizard-service';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import type { PartyRole } from '@/lib/domain/parties/party-wizard-fields';

const ORDER_ID = 8123;
const PUBLIC_HOST = 'https://hub.pctdesk.com';
const CREATED_BY = 'manual_walkthrough_8123';

const ALLOWED_TO = ['ghernandez@pct.com', 'gerardoh@gmail.com'] as const;

const LISTING_AGENT_URL =
  'https://hub.pctdesk.com/party-wizard/15d9a1dd635833a90353f1f3064b73a6.7VehrBvKHH77mOXxMaVUB1Wr7IAxtgVD.WF5yTRNOXXYKPL2dmKIEow';

const FILE = {
  fileNumber: '20021642-OCT',
  propertyAddress: '1358 5th St, La Verne, CA',
  transactionType: 'Purchase',
  recipientName: 'Jerry Hernandez',
  recipientCompany: 'Newport Financial Associates, Escrow Division',
  openedAt: new Date('2026-08-31T16:00:00.000Z'),
};

const ROLES: PartyRole[] = ['listing_agent', 'buyer_agent', 'lender_contact'];
const AUDIENCES: PartyWizardAudience[] = ['internal', 'external'];

function subjectPrefix(audience: PartyWizardAudience): string {
  return audience === 'internal' ? '[SAMPLE internal]' : '[SAMPLE external — unapproved]';
}

async function readInviteFlag(): Promise<string> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'party_wizard_invite_enabled'))
    .limit(1);
  return row ? JSON.stringify(row.value) : '(no row — default off)';
}

async function listLinks(role: PartyRole) {
  return db
    .select({
      id: partyWizardLinks.id,
      role: partyWizardLinks.role,
      tokenId: partyWizardLinks.tokenId,
      expiresAt: partyWizardLinks.expiresAt,
      revokedAt: partyWizardLinks.revokedAt,
      usedAt: partyWizardLinks.usedAt,
      accessCount: partyWizardLinks.accessCount,
      submissionCount: partyWizardLinks.submissionCount,
      createdBy: partyWizardLinks.createdBy,
      createdAt: partyWizardLinks.createdAt,
    })
    .from(partyWizardLinks)
    .where(and(eq(partyWizardLinks.orderId, ORDER_ID), eq(partyWizardLinks.role, role)));
}

async function mintIfAbsent(role: PartyRole): Promise<{ url: string; minted: boolean; linkId?: number }> {
  const existing = await findLiveLink(ORDER_ID, role);
  if (existing) {
    throw new Error(
      `REFUSED: live ${role} link already exists id=${existing.id} on order ${ORDER_ID}. `
      + `Cannot recover URL; will not mint extras.`,
    );
  }
  const minted = await mintLinkForOrder(ORDER_ID, role, CREATED_BY);
  if (!minted) throw new Error(`mintLinkForOrder returned null for ${role}`);
  return { url: minted.url, minted: true, linkId: minted.linkId };
}

async function main() {
  process.env.NEXT_PUBLIC_APP_URL = PUBLIC_HOST;

  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('Missing SENDGRID_API_KEY — refusing so sendEmail cannot mock.');
  }

  const to = [...ALLOWED_TO];
  const unexpected = to.filter((e) => !ALLOWED_TO.includes(e as (typeof ALLOWED_TO)[number]));
  if (unexpected.length > 0 || to.length !== 2) {
    throw new Error(`REFUSED: recipient list is not exactly Gerard: ${JSON.stringify(to)}`);
  }

  const flag = await readInviteFlag();
  console.log(`party_wizard_invite_enabled=${flag} (read-only; not written)`);

  for (const role of ROLES) {
    const rows = await listLinks(role);
    console.log(`existing ${role} links on ${ORDER_ID}: ${rows.length}`);
    for (const row of rows) console.log(`  ${JSON.stringify(row)}`);
  }

  const urls: Record<PartyRole, string> = {
    listing_agent: LISTING_AGENT_URL,
    buyer_agent: '',
    lender_contact: '',
    buyer: '',
    seller: '',
    lender: '',
    escrow_company: '',
    borrower: '',
    other: '',
  };

  const buyer = await mintIfAbsent('buyer_agent');
  urls.buyer_agent = buyer.url;
  console.log(`minted buyer_agent linkId=${buyer.linkId} url=${buyer.url}`);

  const lender = await mintIfAbsent('lender_contact');
  urls.lender_contact = lender.url;
  console.log(`minted lender_contact linkId=${lender.linkId} url=${lender.url}`);

  const log: Array<{
    role: PartyRole;
    audience: PartyWizardAudience;
    subject: string;
    to: string[];
    url: string;
    messageId?: string;
  }> = [];

  for (const role of ROLES) {
    const url = urls[role];
    if (!url.startsWith('https://hub.pctdesk.com/party-wizard/')) {
      throw new Error(`REFUSED: ${role} URL is not a live hub.pctdesk.com wizard link: ${url}`);
    }

    for (const audience of AUDIENCES) {
      const input = {
        fileNumber: FILE.fileNumber,
        propertyAddress: FILE.propertyAddress,
        transactionType: FILE.transactionType,
        recipientName: FILE.recipientName,
        recipientCompany: audience === 'external' ? FILE.recipientCompany : null,
        audience,
        openedAt: FILE.openedAt,
        roleLinks: [{ role, url }],
      };

      const realSubject = buildPartyWizardSubject(input);
      const subject = `${subjectPrefix(audience)} ${realSubject}`;
      const html = buildPartyWizardEmail(input);
      const text = buildPartyWizardText(input);

      const result = await sendEmail({
        to,
        subject,
        html,
        text,
      });

      if (!result.success || !result.data) {
        console.error(JSON.stringify({ role, audience, subject, error: result.error }, null, 2));
        throw new Error(`sendEmail failed after ${log.length} successful sends`);
      }

      const entry = {
        role,
        audience,
        subject,
        to,
        url,
        messageId: result.data.messageId,
      };
      log.push(entry);
      console.log(JSON.stringify(entry));
    }
  }

  console.log('\n=== SENT ===');
  console.log(JSON.stringify({
    count: log.length,
    to,
    inviteFlag: flag,
    vendorApiLogs: 'sendEmail writes vendor_api_logs (to/cc/subject/from). No notification_logs written.',
    variants: log,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
