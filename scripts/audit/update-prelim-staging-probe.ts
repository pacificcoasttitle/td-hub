/**
 * Update Prelim staging probe — :8081 only.
 *
 * Proves separation FIRST, then answers the three questions the code cannot:
 *   1. Does AddNotes accept a Subject field, or is that why legacy commented
 *      it out? (Finding only. We keep prepending either way until a human has
 *      read the note in SoftPro's UI and confirmed the subject renders.)
 *   2. Where does a prelim actually land for each order type — under
 *      `1 - Title Documents\3 - Production Documents` for "Title & Escrow",
 *      or the root-level `3 - Production Documents` for everything else?
 *   3. Does GetAttachedDocumentsPrelim list the name we just sent?
 *
 * This writes to a real SoftPro file. It refuses to run unless
 * SOFTPRO_API_URL is on port 8081.
 *
 * Usage:
 *   npx tsx scripts/audit/update-prelim-staging-probe.ts <ORDER_NUMBER> [--send-subject]
 *
 * The shared scriptExit()/closeDb() helpers land with the client-company-create
 * branch; until then this closes the pool inline.
 */

import { db } from '../../src/lib/db/client';

const STAGING_PORT = '8081';

function fail(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function proveSeparation(): string {
  const raw = process.env.SOFTPRO_API_URL?.trim();
  if (!raw) fail('SOFTPRO_API_URL is not set. Nothing to prove, nothing to run.');

  let url: URL;
  try {
    url = new URL(raw!);
  } catch {
    return fail(`SOFTPRO_API_URL is not a URL: ${raw}`);
  }

  if (url.port !== STAGING_PORT) {
    fail(
      `SOFTPRO_API_URL points at ${url.host} (port ${url.port || 'default'}), not :${STAGING_PORT}. ` +
      'This probe writes a note, a document and a task to a real file — it will not run off staging.',
    );
  }

  console.log(`SEPARATION PROVEN — SoftPro host ${url.host}, port ${url.port}`);
  return url.host;
}

async function main(): Promise<void> {
  const orderNumber = process.argv[2];
  const sendSubject = process.argv.includes('--send-subject');

  if (!orderNumber) {
    fail('Pass a staging order number: npx tsx scripts/audit/update-prelim-staging-probe.ts 20021642-OCT');
  }

  proveSeparation();

  const { addNotes, addTask, getAttachedDocuments, getAttachedDocumentsPrelim } =
    await import('../../src/lib/integrations/softpro');
  const { UPDATE_PRELIM_TASK_ID } = await import('../../src/lib/domain/prelim/update-prelim');

  console.log(`\n=== order ${orderNumber} ===`);

  // Baseline: what does each listing see before we touch anything?
  const beforePrelim = await getAttachedDocumentsPrelim(orderNumber);
  const beforeAll = await getAttachedDocuments(orderNumber);
  console.log('\n[baseline]');
  console.log('  GetAttachedDocumentsPrelim:', beforePrelim.success
    ? `${(beforePrelim.data ?? []).length} row(s)`
    : `FAILED ${beforePrelim.error?.message}`);
  console.log('  GetAttachedDocuments     :', beforeAll.success
    ? `${(beforeAll.data ?? []).length} row(s)`
    : `FAILED ${beforeAll.error?.message}`);
  if (beforePrelim.success) {
    console.log('  prelim rows:', JSON.stringify(beforePrelim.data, null, 2));
  }

  // Question 1 — is Subject accepted? Our client cannot send it, so probe the
  // endpoint directly rather than pretending the client supports it.
  if (sendSubject) {
    // Deliberately not routed through our client: addNotes() has no Subject
    // parameter, and adding one before we know the vendor accepts it is how a
    // field we have never proven ends up in production code.
    const base = process.env.SOFTPRO_API_URL!.replace(/\/+$/, '');
    console.log('\n[subject probe] posting AddNotes WITH a Subject field, outside the client');
    const res = await fetch(`${base}/ordercreation/AddNotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        OrderNumber: orderNumber,
        Text: 'Subject-field probe body',
        Subject: 'Subject-field probe subject',
      }]),
      signal: AbortSignal.timeout(60_000),
    });
    console.log('  HTTP:', res.status);
    console.log('  body:', (await res.text()).slice(0, 1000));
    console.log('  NOTE: a 200 here is a FINDING, not a green light. Someone must');
    console.log('        open the note in SoftPro and confirm the subject renders.');
  }

  console.log('\n[note] AddNotes with the subject prepended into Text');
  const noteResult = await addNotes(
    orderNumber,
    'Update Prelim staging probe\n\nAutomated probe — no action required.',
  );
  console.log('  success:', noteResult.success);
  if (!noteResult.success) console.log('  error:', noteResult.error?.message);

  console.log(`\n[task] AddTask ${UPDATE_PRELIM_TASK_ID}`);
  const taskResult = await addTask(orderNumber, UPDATE_PRELIM_TASK_ID);
  console.log('  success:', taskResult.success);
  if (!taskResult.success) console.log('  error:', taskResult.error?.message);
  else console.log('  data:', JSON.stringify(taskResult.data));

  // Question 2 and 3 — after the real upload (run the button on staging, then
  // re-run this), compare both listings and record the folder the file landed in.
  console.log('\n[after] re-read both listings');
  const afterPrelim = await getAttachedDocumentsPrelim(orderNumber);
  const afterAll = await getAttachedDocuments(orderNumber);
  console.log('  GetAttachedDocumentsPrelim:', afterPrelim.success
    ? JSON.stringify(afterPrelim.data, null, 2)
    : `FAILED ${afterPrelim.error?.message}`);
  console.log('  GetAttachedDocuments     :', afterAll.success
    ? JSON.stringify(afterAll.data, null, 2)
    : `FAILED ${afterAll.error?.message}`);

  console.log('\nRecord in the ticket: which listing saw the prelim, and the folder path shown in SoftPro on screen.');
}

main()
  .catch((err) => {
    if (err instanceof Error && !process.exitCode) {
      console.error('probe failed:', err.message);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    try {
      await db.$client.end({ timeout: 5 });
    } catch { /* pool already closed or never opened */ }
    process.stdout.write('', () => process.exit(process.exitCode ?? 0));
  });
