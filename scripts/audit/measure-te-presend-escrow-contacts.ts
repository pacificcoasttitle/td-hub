/**
 * Read-only. Live GetOrderContacts on a Title & Escrow sample, to see whether
 * SoftPro's EscrowCompanies email is empty on in-house files.
 *
 * Pre-send decideRecipient only looks at EscrowCompanies person/company email.
 * If that is empty, a correctly resolved PCT officer would still be held.
 *
 * GET GetOrderContacts only. Raw fetch, not the instrumented client — no
 * vendor_api_logs row. No SendGrid. No hub writes.
 *
 * Rate: one call at a time, 5s pause.
 * Ceiling: 12. Stop on HTML / 403 / a run of fast failures (FortiGuard).
 *
 *   npx tsx --env-file=.env.local scripts/audit/measure-te-presend-escrow-contacts.ts
 */
import { decideRecipient } from '@/lib/domain/notifications/pre-send-refresh';
import { mapOrderContacts } from '@/lib/integrations/softpro/mapper';
import { SOFTPRO_ENDPOINTS, type SoftProOrderContactsData } from '@/lib/integrations/softpro/types';

type Sample = {
  fileNumber: string;
  officerEmail: string | null;
  officerName: string | null;
  hubHadParty: boolean;
};

/** Mix: recent with/without a hub escrow_company party, the two historical sends, one hold. */
const SAMPLE: readonly Sample[] = [
  { fileNumber: '20022514-OCT', officerEmail: 'cquintanar@pct.com', officerName: 'Christine Quintanar', hubHadParty: false },
  { fileNumber: '20022497-GLT', officerEmail: 'lvidaca@pct.com', officerName: 'Lupe Vidaca', hubHadParty: false },
  { fileNumber: '20022443-OCT', officerEmail: 'aballesteros@pct.com', officerName: 'Anna Ballesteros', hubHadParty: true },
  { fileNumber: '20022443-PRV', officerEmail: 'aballesteros@pct.com', officerName: 'Anna Ballesteros', hubHadParty: true },
  { fileNumber: '20022429-ONT', officerEmail: 'kcasco@pct.com', officerName: 'Karla Casco', hubHadParty: false },
  { fileNumber: '20022347-OCT', officerEmail: 'lvidaca@pct.com', officerName: 'Lupe Vidaca', hubHadParty: true },
  { fileNumber: '20022327-OCT', officerEmail: 'cquintanar@pct.com', officerName: 'Christine Quintanar', hubHadParty: false },
  { fileNumber: '20022307-GLT', officerEmail: 'lvidaca@pct.com', officerName: 'Lupe Vidaca', hubHadParty: true },
  { fileNumber: '20020435-OCT', officerEmail: 'cquintanar@pct.com', officerName: 'Christine Quintanar', hubHadParty: false },
  { fileNumber: '20021162-GLT', officerEmail: 'lvidaca@pct.com', officerName: 'Lupe Vidaca', hubHadParty: false },
  { fileNumber: '20021722-OCT', officerEmail: 'kcasco@pct.com', officerName: 'Karla Casco', hubHadParty: false },
  { fileNumber: '20022465-GLT', officerEmail: 'lvidaca@pct.com', officerName: 'Lupe Vidaca', hubHadParty: false },
];

const RATE_PAUSE_MS = 5_000;
const CEILING = 12;
const CALL_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeBlock(res: Response, bodyText: string): string | null {
  const contentType = res.headers.get('content-type') ?? '';
  if (res.status === 403) return `HTTP 403 in ${res.status}`;
  if (contentType.includes('text/html')) return `HTML where JSON was expected (HTTP ${res.status})`;
  const trimmed = bodyText.trimStart();
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    return 'HTML page where JSON was expected';
  }
  return null;
}

function blank(value: string | null | undefined): string {
  return value == null || value.trim() === '' ? '' : value;
}

async function main() {
  if (SAMPLE.length > CEILING) {
    throw new Error(`list is ${SAMPLE.length}; ceiling is ${CEILING}`);
  }

  const base = process.env.SOFTPRO_API_URL;
  if (!base) throw new Error('SOFTPRO_API_URL not set');

  const counts = { agrees: 0, differs: 0, softpro_has_none: 0, unreachable: 0 };
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < SAMPLE.length; i++) {
    const file = SAMPLE[i]!;
    if (i > 0) await sleep(RATE_PAUSE_MS);

    const url = `${base.replace(/\/?$/, '/')}${SOFTPRO_ENDPOINTS.getOrderContacts}`
      + `?${new URLSearchParams({ OrderNumber: file.fileNumber }).toString()}`;

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SOFTPRO_TOKEN ? { 'X-API-KEY': process.env.SOFTPRO_TOKEN } : {}),
        },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`STOP. Fetch failed on ${file.fileNumber}: ${message}`);
      process.exit(2);
    }

    const elapsed = Date.now() - started;
    const bodyText = await res.text();
    const block = looksLikeBlock(res, bodyText);
    if (block) {
      console.error(`STOP. ${block} on ${file.fileNumber} after ${elapsed}ms. Not retrying.`);
      process.exit(2);
    }
    if (elapsed < 800 && !res.ok) {
      console.error(`STOP. Fast failure HTTP ${res.status} on ${file.fileNumber} in ${elapsed}ms.`);
      process.exit(2);
    }

    let status = 'unreachable';
    let personEmail = '';
    let personName = '';
    let personCode = '';
    let companyEmail = '';
    let companyName = '';
    let companyCode = '';
    let rawEscrow: unknown = null;
    try {
      const parsed = JSON.parse(bodyText) as { Status?: number; Message?: string; data?: SoftProOrderContactsData };
      rawEscrow = parsed.data?.EscrowCompanies ?? null;
      if (!parsed.data) {
        counts.unreachable++;
      } else {
        const mapped = mapOrderContacts(parsed.data);
        const party = mapped.parties.escrowCompany;
        personEmail = blank(party?.email);
        personName = blank(party?.name);
        personCode = blank(party?.lookupCode);
        companyEmail = blank(party?.companyEmail);
        companyName = blank(party?.companyName);
        companyCode = blank(party?.companyLookupCode);
        const decision = decideRecipient(
          { role: 'escrow', email: file.officerEmail, name: file.officerName },
          mapped,
        );
        status = decision.status;
        if (status === 'agrees' || status === 'differs' || status === 'softpro_has_none' || status === 'unreachable') {
          counts[status]++;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`STOP. Parse failed on ${file.fileNumber}: ${message}`);
      process.exit(2);
    }

    const row = {
      fileNumber: file.fileNumber,
      officerEmail: file.officerEmail,
      hubHadParty: file.hubHadParty,
      status,
      personName,
      personEmail,
      personCode,
      companyName,
      companyEmail,
      companyCode,
      elapsedMs: elapsed,
      rawEscrow,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  console.log(JSON.stringify({
    ceiling: CEILING,
    ratePauseMs: RATE_PAUSE_MS,
    examined: rows.length,
    agrees: counts.agrees,
    differs: counts.differs,
    softpro_has_none: counts.softpro_has_none,
    unreachable: counts.unreachable,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
