/**
 * Send a [SAMPLE] of every system notification email to one inbox.
 *
 * Usage (from repo root):
 *   npx tsx --env-file=.env.local scripts/send-all-notification-samples.ts
 *   npx tsx --env-file=.env.local scripts/send-all-notification-samples.ts --to=you@pct.com
 *   npx tsx --env-file=.env.local scripts/send-all-notification-samples.ts --dry-run
 *
 * Covers: order confirmation, order closed, recording, disbursement,
 * document-ready (prelim + policy), prelim PDF delivery, party wizard invite,
 * user invite, ops daily report.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

const DEFAULT_TO = 'ghernandez@pct.com';

function parseArgs(argv: string[]) {
  let to = DEFAULT_TO;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--to=')) to = arg.slice('--to='.length).trim() || DEFAULT_TO;
  }
  return { to, dryRun };
}

async function main() {
  const { to, dryRun } = parseArgs(process.argv.slice(2));

  if (!process.env.SENDGRID_API_KEY && !dryRun) {
    console.error('Missing SENDGRID_API_KEY (load via --env-file=.env.local)');
    process.exit(1);
  }

  const { buildAllSampleEmails } = await import(
    '../src/lib/domain/notifications/sample-templates'
  );
  const { sendEmail } = await import('../src/lib/integrations/sendgrid/client');

  const samples = buildAllSampleEmails();
  console.log(`Preparing ${samples.length} sample emails → ${to}${dryRun ? ' (dry-run)' : ''}\n`);

  const sent: { key: string; subject: string; messageId?: string }[] = [];

  for (const sample of samples) {
    const subject = `[SAMPLE] ${sample.subject}`;
    console.log(`• ${sample.key} — ${sample.label}`);
    console.log(`  Subject: ${subject}`);

    if (dryRun) {
      sent.push({ key: sample.key, subject });
      continue;
    }

    const result = await sendEmail({
      to,
      subject,
      html: sample.html,
      text: sample.text,
    });

    if (!result.success || !result.data) {
      console.error(`  FAILED: ${result.error?.message ?? 'unknown error'}`);
      console.error(`Sent ${sent.length} before failure.`);
      process.exit(1);
    }

    console.log(`  OK messageId=${result.data.messageId}`);
    sent.push({ key: sample.key, subject, messageId: result.data.messageId });
  }

  console.log(`\nDone. ${dryRun ? 'Would send' : 'Sent'} ${sent.length}/${samples.length} to ${to}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
