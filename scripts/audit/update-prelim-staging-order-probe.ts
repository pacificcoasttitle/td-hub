/**
 * Request Updated Prelim — staging probe on FRESH orders. :8081 only.
 *
 * Creates its own orders rather than marking up a file someone cares about.
 * Staging prefixes what it creates with TEST-, so nothing here can collide
 * with a production file number.
 *
 * Two orders, because the answer differs by order type:
 *   - "Title only"      — everything that is not Title & Escrow
 *   - "Title & Escrow"  — the one type documented to nest under
 *                         `1 - Title Documents\3 - Production Documents`
 *
 * ANSWERS
 *   Q1  Does AddNotes accept a Subject field, or is that why legacy commented
 *       it out? Probed OUTSIDE our client — addNotes() has no Subject
 *       parameter, and adding one before the vendor is known to accept it is
 *       how an unproven field ends up in production code.
 *   Q2  Where does a prelim actually land, per order type? This is defect D
 *       from the upload diagnosis, and the five-minute answer the next time
 *       someone reports a document missing.
 *   Q3  Does GetAttachedDocumentsPrelim list the name we sent, and does
 *       GetAttachedDocuments miss it?
 *
 * REFUSES TO RUN unless:
 *   - SOFTPRO_API_URL is on port 8081
 *   - SOFTPRO_USER_ID is set (createOrder cannot be signed without it)
 *   - staging returns ZERO records for a known PRODUCTION order number
 *
 * That last check is the one that matters. A port is a claim about config; an
 * empty result for a production file is evidence the profile is separate.
 *
 * Usage:
 *   npx tsx scripts/audit/update-prelim-staging-order-probe.ts [--send-subject] [--file-url <URL>]
 *
 *   --send-subject  additionally POST AddNotes with a Subject field (Q1).
 *   --file-url      a publicly reachable PDF whose LAST PATH SEGMENT IS A
 *                   LEGAL FILENAME and whose total length is well under 260
 *                   characters. Without it, Q2 cannot be answered here and
 *                   the script prints the two order numbers to run the button
 *                   against instead.
 *
 * Reports what SoftPro returns. It cannot tell you what the note looks like in
 * SoftPro's UI — a human has to open the file and read it, and the script says
 * so rather than implying otherwise.
 */

import { db } from '../../src/lib/db/client';
import {
  createOrder,
  getOrderDetails,
  uploadDocument,
} from '../../src/lib/integrations/softpro/client';

/** A real production order. Staging must know nothing about it. */
const PRODUCTION_CONTROL = '20021378-GLT';

const ORDER_TYPES = ['Title only', 'Title & Escrow'] as const;
type ProbeOrderType = (typeof ORDER_TYPES)[number];

function refuse(message: string): never {
  console.error(`\nREFUSED — ${message}\n`);
  process.exit(1);
}

function payload(orderType: ProbeOrderType): Record<string, unknown> {
  return {
    baseDetails: { OrderType: orderType, ProjectName: 'PCT', IsRushOrder: false },
    sellerDetails: {
      PrimaryOwnerFirstName: '', PrimaryOwnerMiddleName: '', PrimaryOwnerLastName: '',
      SecondaryOwnerFirstName: '', SecondaryOwnerMiddleName: '', SecondaryOwnerLastName: '',
      OrganizationType: '', IsOrganization: 'false',
    },
    personalDetails: {
      CompanyLookupCode: '', ClientLookupCode: '', UserType: 'EscrowCompany',
      CompanyName: 'TEST-PRELIM-PROBE', Email: 'test@example.com',
      FirstName: 'TEST', LastName: 'PRELIM', Telephone: '', Address: '', City: '',
      ZipCode: '', State: 'CA', EmailNotifications: false, SalesRep: '',
    },
    propertyDetails: [{
      Address1: '31195 EMERY CT', Address2: '',
      APNNumberParcelID: '0300-481-01-0000', Country: 'San Bernardino',
      Description: 'TRACT 9962 LOT 1', IsPrimaryResidence: true,
      City: 'REDLANDS', Zip: '92373', State: 'CA',
      EscrowBriefLegalLookupCode: null, EscrowBriefLegal: 'TRACT 9962 LOT 1',
    }],
    transactionDetails: {
      // GLT is in the adapter's CreateOrders suffix switch and rdickerson is
      // its Glendale examiner — the matched pair proven to create cleanly
      // (staging-run.ts P1). A branch outside that switch 400s.
      LookUpCodeTitleOffice: 'GLT', TitleOffice: 'PCT\\rdickerson',
      Product: 'Short Form', EscrowNumber: '', SalesAmount: 0,
      TransactionType: 'Refinance', LoanNumber: '', LoanAmount: 1,
      UnderwriterLookUpCode: 'WC', CoverageAmount: 1,
      PrimaryBorrowerFirstName: 'TEST', PrimaryBorrowerMiddleName: '', PrimaryBorrowerLastName: 'PRELIM',
      SecondaryBorrowerFirstName: '', SecondaryBorrowerMiddleName: '', SecondaryBorrowerLastName: '',
      IsOrganization: false, OrganizationType: '',
      // Null on BOTH, including for Title & Escrow. Sending an address-book
      // code in the wrong namespace is not rejected — staging accepted
      // "AnnBalPaci" and produced TEST-20002217-OCT with no escrow officer at
      // all. An order missing an officer is fixable; one silently filed under
      // a wrong code is not. Folder placement does not depend on this.
      LookUpCodeEscrowOfficer: null, EscrowOfficerName: null,
    },
  };
}

async function proveSeparation(): Promise<void> {
  const raw = process.env.SOFTPRO_API_URL?.trim();
  if (!raw) refuse('SOFTPRO_API_URL is not set. Nothing to prove, nothing to run.');

  let url: URL;
  try {
    url = new URL(raw!);
  } catch {
    refuse(`SOFTPRO_API_URL is not a URL: ${raw}`);
  }

  if (url!.port !== '8081') {
    refuse(
      `SOFTPRO_API_URL points at ${url!.host} (port ${url!.port || 'default'}), not :8081. `
      + 'This script CREATES ORDERS and writes notes, documents and tasks. It will not run off staging.',
    );
  }
  if (!process.env.SOFTPRO_USER_ID) {
    refuse('SOFTPRO_USER_ID is not set; createOrder cannot be signed.');
  }

  console.log(`host ${url!.host}, port ${url!.port} — checking the profile is actually separate`);

  const control = await getOrderDetails({
    dateFrom: '2026-08-24',
    dateTo: '2026-08-26',
    orderNumber: PRODUCTION_CONTROL,
  });
  const found = control.success && Array.isArray(control.data) ? control.data.length : -1;

  if (found !== 0) {
    refuse(
      `staging returned ${found} record(s) for production order ${PRODUCTION_CONTROL}. `
      + 'Either this is not staging or the profiles are shared. Not writing.',
    );
  }

  console.log(`SEPARATION PROVEN — 0 records for production order ${PRODUCTION_CONTROL}\n`);
}

/** Guard the URL we hand SoftPro before the vendor rejects it on MAX_PATH. */
async function checkFileUrl(fileUrl: string): Promise<string> {
  const { cleanSoftProFileUrl } = await import('../../src/lib/domain/documents/softpro-folder');
  if (fileUrl.length > 200) {
    refuse(
      `--file-url is ${fileUrl.length} characters. SoftPro downloads on a Windows host `
      + '(MAX_PATH 260) and rejects long URLs with "The specified path, file name, or both '
      + 'are too long" — that is the real error behind the presigned-S3 failures, not '
      + 'illegal characters. Use a short URL.',
    );
  }
  try {
    return cleanSoftProFileUrl(fileUrl);
  } catch (err) {
    return refuse(
      `--file-url last path segment is not a legal Windows filename (${
        err instanceof Error ? err.message : 'unknown'
      }). SoftPro runs Path.GetFileName on it.`,
    );
  }
}

function describeListing(label: string, result: {
  success: boolean;
  data?: unknown;
  error?: { message?: string };
}): void {
  if (!result.success) {
    console.log(`    ${label}: FAILED — ${result.error?.message ?? 'unknown'}`);
    return;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  console.log(`    ${label}: ${rows.length} row(s)`);
  for (const row of rows) {
    // Folder placement lives in these strings. Print them raw and whole —
    // this is the evidence, and truncating it is how "documents are missing"
    // stays a mystery.
    console.log(`      ${typeof row === 'string' ? row : JSON.stringify(row)}`);
  }
}

async function main(): Promise<void> {
  const sendSubject = process.argv.includes('--send-subject');
  const fileUrlIdx = process.argv.indexOf('--file-url');
  const rawFileUrl = fileUrlIdx > -1 ? process.argv[fileUrlIdx + 1] : undefined;

  await proveSeparation();

  const fileUrl = rawFileUrl ? await checkFileUrl(rawFileUrl) : undefined;
  if (!fileUrl) {
    console.log('No --file-url given. Q1 (Subject) IS answered — that is the one');
    console.log('blocking a design decision, so this run is worth doing without a PDF.');
    console.log('');
    console.log('Q2 (folder placement) and Q3 (which listing sees the prelim) are NOT.');
    console.log('Both need a document actually attached, and the listings below will');
    console.log('read empty for the honest reason that nothing was uploaded — not');
    console.log('because a listing failed to show something. Do not record an empty');
    console.log('listing from this run as evidence about either question.\n');
  }

  const { addNotes, addTask, getAttachedDocuments, getAttachedDocumentsPrelim } =
    await import('../../src/lib/integrations/softpro');
  const { UPDATE_PRELIM_TASK_ID, UPDATE_PRELIM_FOLDER_NAME } =
    await import('../../src/lib/domain/prelim/update-prelim');

  const created: Array<{ orderType: ProbeOrderType; orderNumber: string }> = [];

  for (const orderType of ORDER_TYPES) {
    console.log('='.repeat(78));
    console.log(`CREATE — ${orderType}`);
    console.log('='.repeat(78));

    const result = await createOrder(payload(orderType));
    if (!result.success || !result.data?.orderNumber) {
      console.log(`  FAILED: ${result.error?.message ?? 'no order number returned'}`);
      console.log('  Skipping this order type. The other still runs.\n');
      continue;
    }

    const orderNumber = result.data.orderNumber;
    created.push({ orderType, orderNumber });
    console.log(`  created ${orderNumber}\n`);
  }

  if (created.length === 0) refuse('no orders were created; nothing to probe.');

  for (const { orderType, orderNumber } of created) {
    console.log('='.repeat(78));
    console.log(`PROBE — ${orderNumber}  (${orderType})`);
    console.log('='.repeat(78));

    console.log('  [baseline] before we write anything');
    describeListing('GetAttachedDocumentsPrelim', await getAttachedDocumentsPrelim(orderNumber));
    describeListing('GetAttachedDocuments      ', await getAttachedDocuments(orderNumber));

    // Q1 — deliberately not through our client.
    if (sendSubject) {
      const base = process.env.SOFTPRO_API_URL!.replace(/\/+$/, '');
      console.log('\n  [Q1] AddNotes WITH a Subject field, posted outside our client');
      try {
        const res = await fetch(`${base}/ordercreation/AddNotes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            OrderNumber: orderNumber,
            Text: 'Subject-field probe body — automated, no action required.',
            Subject: 'SUBJECT-FIELD-PROBE',
          }]),
          signal: AbortSignal.timeout(60_000),
        });
        console.log(`    HTTP ${res.status}`);
        console.log(`    body: ${(await res.text()).slice(0, 800)}`);
      } catch (err) {
        console.log(`    threw: ${err instanceof Error ? err.message : 'unknown'}`);
      }
      console.log('    A 200 is a FINDING, NOT a green light. Someone must open the');
      console.log('    note in SoftPro and confirm SUBJECT-FIELD-PROBE renders as a');
      console.log('    subject and not silently dropped. Until then we keep');
      console.log('    prepending the subject into Text.');
    }

    // Q2 — attach, then see where it landed.
    if (fileUrl) {
      const documentName = `TEST Prelim probe ${orderType}`;
      console.log(`\n  [Q2] AddDocuments — FolderName "${UPDATE_PRELIM_FOLDER_NAME}"`);
      const attach = await uploadDocument({
        documentId: 0,
        orderNumber,
        documentName,
        folderName: UPDATE_PRELIM_FOLDER_NAME,
        fileUrl,
      });
      console.log(`    success: ${attach.success}`);
      console.log(`    returned: ${JSON.stringify(attach.data ?? attach.error)}`);
      if (attach.success) {
        console.log('    Remember a 200 here is write-accepted, not attached.');
      }
    }

    console.log('\n  [note] AddNotes through our client, subject prepended into Text');
    const note = await addNotes(
      orderNumber,
      'Request Updated Prelim staging probe\n\nAutomated probe — no action required.',
    );
    console.log(`    success: ${note.success}`);
    if (!note.success) console.log(`    error: ${note.error?.message}`);

    console.log(`\n  [task] AddTask ${UPDATE_PRELIM_TASK_ID}`);
    const task = await addTask(orderNumber, UPDATE_PRELIM_TASK_ID);
    console.log(`    success: ${task.success}`);
    console.log(`    returned: ${JSON.stringify(task.success ? task.data : task.error)}`);

    console.log(fileUrl
      ? '\n  [Q3] listings AFTER the writes'
      : '\n  [listings] AFTER the writes — expected empty, nothing was uploaded');
    describeListing('GetAttachedDocumentsPrelim', await getAttachedDocumentsPrelim(orderNumber));
    describeListing('GetAttachedDocuments      ', await getAttachedDocuments(orderNumber));
    console.log('');
  }

  console.log('='.repeat(78));
  console.log('ORDERS CREATED');
  console.log('='.repeat(78));
  for (const { orderType, orderNumber } of created) {
    console.log(`  ${orderNumber}  ${orderType}`);
  }
  console.log('\nStill needs a human, and the script will not pretend otherwise:');
  console.log('  1. Open each order in SoftPro Select and read the note. Does the');
  console.log('     subject appear? A 200 above proves the request was accepted,');
  console.log('     not that the subject renders.');
  if (fileUrl) {
    console.log('  2. Read the FOLDER PATH on screen for the attached prelim, per');
    console.log('     order type. That is defect D, and the listing strings above');
    console.log('     are evidence for it, not a substitute — what matters is where');
    console.log('     the team will actually find it.');
  } else {
    console.log('  2. Folder placement was NOT probed (no --file-url). It can wait');
    console.log('     for a button run once the feature is enabled.');
  }
  console.log('  3. Record what you saw in docs/tickets/, against these order numbers.');
}

main()
  .catch((err) => {
    console.error(`\nprobe failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.$client.end({ timeout: 5 });
    } catch { /* pool already closed or never opened */ }
    process.stdout.write('', () => process.exit(process.exitCode ?? 0));
  });
