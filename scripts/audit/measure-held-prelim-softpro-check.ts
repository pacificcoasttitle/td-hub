/**
 * Read-only. Live GetOrderContacts for the 15 blocked_no_recipient prelims
 * that later gained a hub escrow party AND sit inside the three-day age
 * window (opened_at on/after 2026-09-15 Pacific). The 36 older of the 51
 * never reach the pre-send SoftPro check — age holds them first — so they
 * are not in this list.
 *
 * Answers: of those 15, how many would pass decideRecipient (SoftPro has a
 * person or company escrow email) vs land on softpro_has_none.
 *
 * GET GetOrderContacts only. Raw fetch, not the instrumented client — no
 * vendor_api_logs row. No SendGrid. No hub writes.
 *
 * Rate: one call at a time, 5s pause between calls.
 * Ceiling: 15. Stop on HTML / 403 / a run of fast failures (FortiGuard).
 *
 *   npx tsx --env-file=.env.local scripts/audit/measure-held-prelim-softpro-check.ts
 */
import { decideRecipient } from '@/lib/domain/notifications/pre-send-refresh';
import { mapOrderContacts } from '@/lib/integrations/softpro/mapper';
import { SOFTPRO_ENDPOINTS, type SoftProOrderContactsData } from '@/lib/integrations/softpro/types';

/** In-window gained-recipient files as of 2026-09-18. Hub email is the enrich-written party. */
const IN_WINDOW: ReadonlyArray<{ fileNumber: string; hubEmail: string; hubName: string }> = [
  { fileNumber: '20022219-OCT', hubEmail: 'TeamSteph@ProminentEscrow.com', hubName: 'Prominent Escrow' },
  { fileNumber: '20022241-OCT', hubEmail: 'Diana@nexumescrow.com', hubName: 'Nexum Escrow' },
  { fileNumber: '20022246-GLT', hubEmail: 'jonathan@805title.com', hubName: '805 Title' },
  { fileNumber: '20022249-GLT', hubEmail: 'joyce@us-escrow.com', hubName: 'US Escrow' },
  { fileNumber: '20022252-GLT', hubEmail: 'rose@powerhouseescrow.com', hubName: 'Powerhouse Escrow' },
  { fileNumber: '20022253-GLT', hubEmail: 'nbishaw@trustoneescrow.com', hubName: 'Trust One Escrow' },
  { fileNumber: '20022254-OCT', hubEmail: 'stephanie@downtownescrow.net', hubName: 'Downtown Escrow' },
  { fileNumber: '20022261-GLT', hubEmail: 'melkon@liveescrow.us', hubName: 'Live Escrow' },
  { fileNumber: '20022263-GLT', hubEmail: 'jonathan@805title.com', hubName: '805 Title' },
  { fileNumber: '20022264-GLT', hubEmail: 'ana@anescrow.com', hubName: 'AN Escrow' },
  { fileNumber: '20022265-GLT', hubEmail: 'Cailyn.Emery@escrowoptions.com', hubName: 'Escrow Options' },
  { fileNumber: '20022286-GLT', hubEmail: 'ty@choice1escrow.com', hubName: 'Choice 1 Escrow' },
  { fileNumber: '20022300-GLT', hubEmail: 'jonathan@805title.com', hubName: '805 Title' },
  { fileNumber: '20022301-OCT', hubEmail: 'jenny@successescrow.net', hubName: 'Success Escrow' },
  { fileNumber: '20022304-OCT', hubEmail: 'anna.stiner@escrowoptions.com', hubName: 'Escrow Options' },
];

const RATE_PAUSE_MS = 5_000;
const CEILING = 15;
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

async function main() {
  if (IN_WINDOW.length > CEILING) {
    throw new Error(`list is ${IN_WINDOW.length}; ceiling is ${CEILING}`);
  }

  const base = process.env.SOFTPRO_API_URL;
  if (!base) throw new Error('SOFTPRO_API_URL not set');

  const counts = { agrees: 0, differs: 0, softpro_has_none: 0, unreachable: 0 };
  const rows: Array<Record<string, string | null>> = [];

  for (let i = 0; i < IN_WINDOW.length; i++) {
    const file = IN_WINDOW[i]!;
    if (i > 0) await sleep(RATE_PAUSE_MS);

    const url = `${base}${SOFTPRO_ENDPOINTS.getOrderContacts}`
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

    let status: string;
    let personEmail: string | null = null;
    let companyEmail: string | null = null;
    try {
      const parsed = JSON.parse(bodyText) as { Status?: number; Message?: string; data?: SoftProOrderContactsData };
      if (!parsed.data) {
        status = 'unreachable';
        counts.unreachable++;
      } else {
        const mapped = mapOrderContacts(parsed.data);
        personEmail = mapped.parties.escrowCompany?.email ?? null;
        companyEmail = mapped.parties.escrowCompany?.companyEmail ?? null;
        const decision = decideRecipient(
          { role: 'escrow', email: file.hubEmail, name: file.hubName },
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

    rows.push({
      fileNumber: file.fileNumber,
      hubEmail: file.hubEmail,
      personEmail,
      companyEmail,
      status,
      elapsedMs: String(elapsed),
    });
    console.log(`${file.fileNumber}\t${status}\tperson=${personEmail ?? ''}\tcompany=${companyEmail ?? ''}\thub=${file.hubEmail}`);
  }

  const wouldPass = counts.agrees + counts.differs;
  console.log(JSON.stringify({
    ceiling: CEILING,
    ratePauseMs: RATE_PAUSE_MS,
    examined: rows.length,
    would_pass_softpro: wouldPass,
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
