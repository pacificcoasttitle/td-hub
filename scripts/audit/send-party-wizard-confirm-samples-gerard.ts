/**
 * Send Gerard the 2 listing_agent CONFIRM variants (internal + external)
 * so he can read them in his inbox like the collect samples.
 *
 * Recipients ONLY: ghernandez@pct.com + gerardoh@gmail.com.
 * Does not flip party_wizard_invite_enabled. Does not run the invite job.
 * Does not mint. Does not write notification_logs. sendEmail logs vendor_api_logs only.
 *
 * listing_agent: uses the already-minted unused walkthrough URL on 8123.
 *
 *   npx tsx --env-file=.env.local scripts/audit/send-party-wizard-confirm-samples-gerard.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import {
  buildPartyWizardEmail,
  buildPartyWizardSubject,
  buildPartyWizardText,
  type PartyWizardAudience,
} from '@/lib/domain/parties/party-wizard-email';
import { sendEmail } from '@/lib/integrations/sendgrid/client';

const PUBLIC_HOST = 'https://hub.pctdesk.com';

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

  if (!LISTING_AGENT_URL.startsWith('https://hub.pctdesk.com/party-wizard/')) {
    throw new Error(`REFUSED: listing_agent URL is not a live hub.pctdesk.com wizard link: ${LISTING_AGENT_URL}`);
  }

  const flag = await readInviteFlag();
  console.log(`party_wizard_invite_enabled=${flag} (read-only; not written)`);

  const log: Array<{
    role: 'listing_agent';
    audience: PartyWizardAudience;
    axis: 'confirm';
    subject: string;
    to: string[];
    url: string;
    messageId?: string;
  }> = [];

  for (const audience of AUDIENCES) {
    const input = {
      fileNumber: FILE.fileNumber,
      propertyAddress: FILE.propertyAddress,
      transactionType: FILE.transactionType,
      recipientName: FILE.recipientName,
      recipientCompany: audience === 'external' ? FILE.recipientCompany : null,
      audience,
      axis: 'confirm' as const,
      openedAt: FILE.openedAt,
      roleLinks: [{ role: 'listing_agent' as const, url: LISTING_AGENT_URL }],
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
      console.error(JSON.stringify({ audience, subject, error: result.error }, null, 2));
      throw new Error(`sendEmail failed after ${log.length} successful sends`);
    }

    const entry = {
      role: 'listing_agent' as const,
      audience,
      axis: 'confirm' as const,
      subject,
      to,
      url: LISTING_AGENT_URL,
      messageId: result.data.messageId,
    };
    log.push(entry);
    console.log(JSON.stringify(entry));
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
