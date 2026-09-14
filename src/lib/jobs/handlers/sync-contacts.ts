import { db } from '@/lib/db/client';
import { contacts, companies } from '@/lib/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getLookupTable, getSalesReps } from '@/lib/integrations/softpro';
import type { SoftProLookupItem } from '@/lib/integrations/softpro';
import { COMPANY_TYPE_MAP } from '@/lib/domain/contacts/company-constants';
import {
  ESCROW_OFFICER_ROW_FIELDS,
  describeOfficerRowRejection,
  validateOfficerRowShape,
} from '@/lib/domain/contacts/officer-row-shape';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncContactsPayload {
  entityType: string;
}

export interface SyncContactsResult {
  entityType: string;
  totalFetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ lookupCode: string; error: string }>;
  /**
   * Rows declined by the shape guard, as opposed to rows we tried to write and
   * failed. Every entry here also appears in `errors`, so it reaches
   * `jobs.error` and `contact_sync_state.last_error` — this field exists so a
   * deliberate rejection is not mistaken for the systemic breakage that the
   * "0 successes" tripwire in handleSyncContactType is watching for.
   */
  rejected?: Array<{ lookupCode: string; reasons: string[] }>;
}

type SyncRow = SoftProLookupItem;

export const SYNC_CONTACT_ENTITY_TYPES = [
  'Order Contact - Person',
  'Title Officer',
  'Escrow Officer',
  'Sales Rep',
  'Escrow Company',
  'Lender',
  'Mortgage Broker',
  'SellingAgentBroker',
  'Underwriter',
] as const;

export type SyncContactEntityType = typeof SYNC_CONTACT_ENTITY_TYPES[number];

interface SyncContactRowsOptions {
  deactivateExistingSalesReps?: boolean;
}

interface FetchSyncContactRowsOptions {
  modifiedSince?: string | null;
  pageSize?: number;
}

function str(item: SyncRow, key: string): string | null {
  const v = item[key];
  return v && v.trim() ? v.trim() : null;
}

/**
 * SoftPro empty/null → omit from UPDATE so Drizzle leaves existing column values
 * (mapUpdateSet drops undefined keys). Inserts still use the full null-able vals.
 */
export function omitEmptyForUpdate<T extends Record<string, unknown>>(
  vals: T,
): { [K in keyof T]?: Exclude<T[K], null> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vals)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out as { [K in keyof T]?: Exclude<T[K], null> };
}

/**
 * Guard mass sales-rep deactivation. Empty or suspiciously sparse SoftPro
 * responses must not wipe isActive for the current roster.
 */
export async function shouldDeactivateExistingSalesReps(
  responseRowCount: number,
): Promise<{ deactivate: boolean; reason?: string; activeCount: number }> {
  if (responseRowCount <= 0) {
    return { deactivate: false, reason: 'empty SoftPro response', activeCount: 0 };
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.isSalesRep, true), eq(contacts.isActive, true)));

  const activeCount = Number(row?.count ?? 0);
  if (activeCount <= 0) {
    return { deactivate: true, activeCount };
  }

  const minRows = Math.max(1, Math.ceil(activeCount * 0.5));
  if (responseRowCount < minRows) {
    return {
      deactivate: false,
      reason: `sparse SoftPro response (${responseRowCount} rows vs ${activeCount} active; need >= ${minRows})`,
      activeCount,
    };
  }

  return { deactivate: true, activeCount };
}

/**
 * Which contacts row an incoming officer feed row belongs to.
 *
 * `closer_examiner` is the key because production carries a partial unique index
 * on it — `contacts_closer_examiner_uniq`, UNIQUE (closer_examiner) WHERE
 * closer_examiner IS NOT NULL, created out of band and absent from this repo's
 * Drizzle schema. At most one row can hold a given code, so this match is
 * deterministic by construction and not by tie-break.
 *
 * The predicate this replaces was `closer_examiner = X OR softpro_lookup_code = X`,
 * limit 1, no ORDER BY. Four officers exist twice under one `PCT\user` code —
 * Ballesteros, Gomez, Casco, Vidaca — where the feed row carries both columns
 * and the address-book twin carries only `softpro_lookup_code`. Both satisfied
 * that OR, so which row came back was the query plan's choice; when it chose the
 * twin, writing `closer_examiner` onto it collided with the unique index and the
 * error went into the result's `errors` array, where nothing read it. Those four
 * office rows last changed 2026-04-16 as a result.
 *
 * `source_id` looks like the natural vendor-side key and is not usable as one:
 * both rows of every affected pair carry the SAME `PCT\user` source_id, so it
 * cannot tell them apart, and no uniqueness constraint covers it.
 */
async function findOfficerContactId(examiner: string): Promise<number | null> {
  const [byExaminer] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.closerExaminer, examiner))
    .limit(1);
  if (byExaminer) return byExaminer.id;

  // No feed row exists yet. Adopting an existing address-book row is what stops
  // this creating a second one, but the choice must not depend on the plan:
  // prefer a row already shaped like a feed row (it has an office code), then
  // the lowest id.
  const [byLookupCode] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.softproLookupCode, examiner))
    .orderBy(
      sql`(${contacts.officeLookupCode} IS NOT NULL AND ${contacts.officeLookupCode} <> '') DESC`,
      asc(contacts.id),
    )
    .limit(1);

  return byLookupCode?.id ?? null;
}

interface PgErrorish {
  code?: string;
  constraint_name?: string;
  detail?: string;
  cause?: unknown;
  message?: string;
}

/**
 * Names the cause instead of storing the statement.
 *
 * Drizzle wraps a driver failure in an Error whose message is the entire failed
 * query plus its bound parameters, and puts the postgres.js error on `cause`.
 * That is why every entry in the stored `errors` arrays is a two-kilobyte SQL
 * dump with the actual reason nowhere in it — the reason lives on `cause.code`
 * and `cause.constraint_name`.
 */
export function describeSyncError(err: unknown): string {
  const top = err as PgErrorish | null;
  const pg = (top?.cause ?? top) as PgErrorish | null;
  const code = pg?.code ?? top?.code;

  if (code === '23505') {
    const constraint = pg?.constraint_name ?? top?.constraint_name ?? 'a unique index';
    return `unique violation on ${constraint}: this code already belongs to a different contacts row, `
      + 'so the officer was not updated. Two contacts rows share one SoftPro identity.';
  }
  if (code) {
    // pg.message before top.message: for a 22001 Postgres gives no detail, and
    // top.message is the wrapper's SQL dump — the thing this function exists to
    // replace. PLML5446's lender sync failed eleven times stored that way.
    return `postgres ${code}${pg?.constraint_name ? ` on ${pg.constraint_name}` : ''}: `
      + `${pg?.detail ?? (pg !== top ? pg?.message : undefined) ?? top?.message ?? 'no detail'}`;
  }
  return err instanceof Error ? err.message : 'Unknown';
}

function emptyResult(entityType: string, error?: string): SyncContactsResult {
  return {
    entityType, totalFetched: 0, created: 0, updated: 0, skipped: 0,
    errors: error ? [{ lookupCode: '*', error }] : [],
  };
}

export function isSyncContactEntityType(entityType: string): entityType is SyncContactEntityType {
  return (SYNC_CONTACT_ENTITY_TYPES as readonly string[]).includes(entityType);
}

// ─── Sync 1: Open Contacts (userType=Order Contact - Person) ─────────────

/** Fields the sync owns. Compared before writing, so an unchanged row is skipped. */
const OPEN_CONTACT_FIELDS = [
  'flookupCode', 'courtesyTitle', 'firstName', 'middleName', 'lastName', 'email',
  'phone', 'phoneExt', 'suffix', 'title', 'fax', 'cell', 'pager', 'genderId',
  'address1', 'address2', 'city', 'state', 'zip', 'note', 'licenseNo',
] as const;

const INSERT_CHUNK = 500;

/**
 * WHY THIS IS NOT A LOOP OF SINGLE QUERIES
 *
 * It was, until 2026-09-09: a SELECT and then an UPDATE or INSERT per item, two
 * sequential round trips each. That was survivable while the sync only ever read
 * one page, because a page is 1,000 rows. Fixing the pagination bug made it read
 * all sixteen - 15,609 rows, ~31,000 round trips - and the job began exceeding
 * its ten-minute watchdog. It failed roughly 70% of runs for five days.
 *
 * The watchdog was not the defect, and raising it would have hidden this. Three
 * changes, in order of how much they matter:
 *
 *   1. ONE SELECT PER PAGE instead of one per row.
 *   2. SKIP ROWS THAT HAVE NOT CHANGED. This is the big one: on an hourly sync
 *      of a table that barely moves, almost every row is identical to what we
 *      already hold, and the old code wrote all of them anyway.
 *   3. INSERTS IN CHUNKS rather than one at a time.
 *
 * Steady state is now one read and close to zero writes.
 *
 * ONE ROW PER CODE
 *
 * `lookup_code` is NOT unique on our side - 2,232 codes are held by more than
 * one contact row. The old code took `.limit(1)` with no ordering, so which
 * sibling received the update was whatever the planner happened to return. This
 * takes the lowest id: still one arbitrary row of a set that should not exist,
 * but the same one every run, which is strictly better than a different one
 * each time. Measured before changing it - 4,446 of 4,471 rows in shared-code
 * groups carry the same name SoftPro holds for that code, so the choice changes
 * almost nothing today. The duplicates are a separate ticket.
 */
async function syncOpenContacts(items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0, unchanged = 0;
  const errors: SyncContactsResult['errors'] = [];

  // Build every row first; nothing touches the database until they are ready.
  const wanted = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const code = str(item, 'LookupCode');
    if (!code) { skipped++; continue; }
    if (!str(item, 'Email')) { skipped++; continue; }
    wanted.set(code, {
      lookupCode: code,
      flookupCode: str(item, 'Filter: LookupCode') ?? str(item, 'FLookupCode'),
      courtesyTitle: str(item, 'CourtesyTitle'),
      firstName: str(item, 'FirstName'),
      middleName: str(item, 'MiddleName'),
      lastName: str(item, 'LastName'),
      email: str(item, 'Email'),
      phone: str(item, 'Phone'),
      phoneExt: str(item, 'PhoneExt'),
      suffix: str(item, 'Suffix'),
      title: str(item, 'Title'),
      fax: str(item, 'Fax'),
      cell: str(item, 'Cell'),
      pager: str(item, 'Pager'),
      genderId: str(item, 'GenderID'),
      address1: str(item, 'Address1'),
      address2: str(item, 'Address2'),
      city: str(item, 'City'),
      state: str(item, 'State'),
      zip: str(item, 'Zip'),
      note: str(item, 'Note'),
      licenseNo: str(item, 'License No'),
      userType: 'open_contact' as const,
      isActive: true,
    });
  }
  if (wanted.size === 0) return { entityType: 'Order Contact - Person', totalFetched: items.length, created, updated, skipped, errors };

  // ONE read for the whole page.
  const codes = [...wanted.keys()];
  const existingRows = await db
    .select({
      id: contacts.id, lookupCode: contacts.lookupCode,
      flookupCode: contacts.flookupCode, courtesyTitle: contacts.courtesyTitle,
      firstName: contacts.firstName, middleName: contacts.middleName,
      lastName: contacts.lastName, email: contacts.email, phone: contacts.phone,
      phoneExt: contacts.phoneExt, suffix: contacts.suffix, title: contacts.title,
      fax: contacts.fax, cell: contacts.cell, pager: contacts.pager,
      genderId: contacts.genderId, address1: contacts.address1,
      address2: contacts.address2, city: contacts.city, state: contacts.state,
      zip: contacts.zip, note: contacts.note, licenseNo: contacts.licenseNo,
    })
    .from(contacts)
    .where(inArray(contacts.lookupCode, codes));

  // Lowest id wins for a shared code. Sorted here rather than with an ORDER BY
  // so the choice does not depend on the query builder — the point is that the
  // same sibling is picked on every run, not that the database does the work.
  const existingByCode = new Map<string, (typeof existingRows)[number]>();
  for (const row of [...existingRows].sort((a, b) => a.id - b.id)) {
    if (row.lookupCode && !existingByCode.has(row.lookupCode)) {
      existingByCode.set(row.lookupCode, row);
    }
  }

  const toInsert: Array<Record<string, unknown>> = [];
  for (const [code, vals] of wanted) {
    const existing = existingByCode.get(code);
    if (!existing) { toInsert.push({ ...vals, sourceSystem: 'softpro' }); continue; }

    // omitEmptyForUpdate drops null and blank values, so a field we would not
    // write must not count as a difference. Compare exactly what would be sent.
    const patch = omitEmptyForUpdate(vals) as Record<string, unknown>;
    const current = existing as unknown as Record<string, unknown>;
    const differs = OPEN_CONTACT_FIELDS.some((f) => f in patch && patch[f] !== current[f]);
    if (!differs) { unchanged++; continue; }

    try {
      await db.update(contacts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(contacts.id, existing.id));
      updated++;
    } catch (err) {
      errors.push({ lookupCode: code, error: describeSyncError(err) });
    }
  }

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    try {
      await db.insert(contacts).values(chunk as never);
      created += chunk.length;
    } catch {
      // One bad row must not lose the chunk - fall back to one at a time so the
      // rest still land and the failure names the row that caused it.
      for (const row of chunk) {
        try {
          await db.insert(contacts).values(row as never);
          created++;
        } catch (inner) {
          errors.push({
            lookupCode: String(row.lookupCode ?? '?'),
            error: describeSyncError(inner),
          });
        }
      }
    }
  }

  // `unchanged` is not "skipped" - skipped means the vendor row was unusable.
  // Folded into the caller's total, counted separately here so that a run which
  // writes nothing reads as a no-op rather than as a failure.
  skipped += unchanged;

  return { entityType: 'Order Contact - Person', totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Sync 2: Title Officers (userType=Title Officer) ─────────────────────

async function syncTitleOfficers(items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  for (const item of items) {
    const examiner = str(item, 'Title officer/Examiner');
    if (!examiner) { skipped++; continue; }

    try {
      const existingId = await findOfficerContactId(examiner);

      const vals = {
        closerExaminer: examiner,
        softproLookupCode: examiner,
        officeLookupCode: str(item, 'Office LookupCode'),
        lookupCode: str(item, 'Office LookupCode'),
        officerName: str(item, 'Officer Name'),
        email: str(item, 'Email'),
        isTitleOfficer: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existingId !== null) {
        await db.update(contacts)
          .set(omitEmptyForUpdate(vals))
          .where(eq(contacts.id, existingId));
        updated++;
      } else {
        await db.insert(contacts).values({
          ...vals,
          sourceSystem: 'softpro',
          fullName: str(item, 'Officer Name'),
        });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: examiner, error: describeSyncError(err) });
    }
  }
  return { entityType: 'Title Officer', totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Sync 3: Escrow Officers (userType=Escrow Officer) ───────────────────

async function syncEscrowOfficers(items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];
  const rejected: NonNullable<SyncContactsResult['rejected']> = [];

  for (const item of items) {
    const examiner = str(item, 'Escrow officer/Closer');
    if (!examiner) { skipped++; continue; }

    // Shape guard. A column-shifted vendor row has every field in the wrong
    // place, so it is declined whole — no partial import, no shifting values
    // back, because inferring the correct alignment is a guess and a wrong
    // guess writes plausible-looking bad data.
    //
    // It is recorded as an error rather than a `skipped++` so that it reaches
    // jobs.error, jobs.payload and contact_sync_state.last_error. A silently
    // skipped officer row is how PCT\jgomez went 133 days without anyone
    // noticing.
    const shape = validateOfficerRowShape(item, ESCROW_OFFICER_ROW_FIELDS);
    if (!shape.ok) {
      const message = describeOfficerRowRejection(examiner, shape.reasons);
      console.error('[sync-contacts] escrow officer row rejected for shape', {
        lookupCode: examiner,
        reasons: shape.reasons,
      });
      errors.push({ lookupCode: examiner, error: message });
      rejected.push({ lookupCode: examiner, reasons: shape.reasons });
      continue;
    }

    try {
      // Dedupe guard: if this row is a PCT\ login-code entry and a
      // canonical (non-PCT\ source_id) contact already exists with the
      // same email, skip the insert/update entirely to avoid resurrecting
      // the duplicate-officer problem.
      //
      // The prefix test is `left(source_id, 4)`, not `NOT LIKE 'PCT\%'`. In a
      // LIKE pattern Postgres reads `\%` as an escaped literal '%', so that
      // pattern matched only the four-character string 'PCT%' and nothing else —
      // every real `PCT\user` source_id passed NOT LIKE, counted as "canonical",
      // and the guard skipped the officer it exists to protect. Measured against
      // production it skipped five of the six PCT escrow officers, which is why
      // the officer feed reported clean runs while updating nothing.
      const email = str(item, 'Email');
      if (examiner.startsWith('PCT\\') && email) {
        const canonical = await db.select({ id: contacts.id })
          .from(contacts)
          .where(and(
            eq(contacts.email, email),
            sql`(${contacts.sourceId} IS NOT NULL AND left(${contacts.sourceId}, 4) <> ${'PCT\\'})`,
          ))
          .limit(1);

        if (canonical.length > 0) {
          skipped++;
          continue;
        }
      }

      const existingId = await findOfficerContactId(examiner);

      const vals = {
        closerExaminer: examiner,
        softproLookupCode: examiner,
        officeLookupCode: str(item, 'Office LookupCode'),
        lookupCode: str(item, 'Office LookupCode'),
        officerName: str(item, 'Officer Name'),
        email,
        isEscrowOfficer: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existingId !== null) {
        await db.update(contacts)
          .set(omitEmptyForUpdate(vals))
          .where(eq(contacts.id, existingId));
        updated++;
      } else {
        await db.insert(contacts).values({
          ...vals,
          sourceSystem: 'softpro',
          fullName: str(item, 'Officer Name'),
        });
        created++;
      }
    } catch (err) {
      // One officer's failure must not end the run — the remaining officers on
      // the feed still need syncing. It is recorded and surfaced by
      // handleSyncContactType instead.
      errors.push({ lookupCode: examiner, error: describeSyncError(err) });
    }
  }
  return { entityType: 'Escrow Officer', totalFetched: items.length, created, updated, skipped, errors, rejected };
}

// ─── Sync 4: Sales Reps (DIFFERENT ENDPOINT) ────────────────────────────

async function syncSalesRepRows(
  items: SyncRow[],
  options: SyncContactRowsOptions = {}
): Promise<SyncContactsResult> {
  const entityType = 'Sales Rep';

  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  if (options.deactivateExistingSalesReps) {
    const gate = await shouldDeactivateExistingSalesReps(items.length);
    if (!gate.deactivate) {
      console.warn('[sync-contacts] Skipping sales-rep deactivate-all', {
        reason: gate.reason,
        responseRows: items.length,
        activeSalesReps: gate.activeCount,
      });
    } else {
      await db.update(contacts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(contacts.isSalesRep, true));
    }
  }

  for (const item of items) {
    const code = str(item, 'LookUpCode') ?? str(item, 'LookupCode');
    if (!code) { skipped++; continue; }

    try {
      const [existing] = await db.select({ id: contacts.id })
        .from(contacts).where(eq(contacts.lookupCode, code)).limit(1);

      const rawFullName = str(item, 'FullName') ?? '';
      const parts = rawFullName.split(/\s*,\s*/);
      const lastName = parts[0] || null;
      const firstName = parts[1] || null;
      const rawPhone = str(item, 'Phone');
      const phone = rawPhone ? rawPhone.replace(/\D/g, '') : null;

      const vals = {
        lookupCode: code,
        fullName: rawFullName || null,
        firstName,
        lastName,
        email: str(item, 'Email'),
        phone,
        isSalesRep: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(contacts)
          .set(omitEmptyForUpdate(vals))
          .where(eq(contacts.id, existing.id));
        updated++;
      } else {
        await db.insert(contacts).values({ ...vals, sourceSystem: 'softpro' });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: code, error: describeSyncError(err) });
    }
  }

  return { entityType, totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Company sync helpers (Syncs 5-9) ────────────────────────────────────

interface CompanySyncConfig {
  entityType: string;
  userType: string;
  companyType: string;
  contactFlag?: 'isEscrow' | 'isLender' | 'isMortgageBroker' | 'isRealEstateAgent' | 'isUnderwriter';
  companyFlag: 'isEscrowCompany' | 'isLender' | 'isMortgageBroker' | 'isRealEstateCompany' | 'isUnderwriter';
  useSpacedFields: boolean;
  extraCompanyFields?: (item: SyncRow) => Record<string, string | null>;
}

const SPACED = {
  lookupCode: 'Lookup Code',
  name: 'Name',
  payeeName: 'Payee Name',
  address1: 'Address (line 1)',
  address2: 'Address (line 2)',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  phone: 'Phone',
  fax: 'Fax',
  email: 'Email',
  signatureLine: 'Signature Line',
  feeTransferLedger: 'Fee Transfer Ledger',
  stateOfIncorporation: 'State Of Incorporation',
  marketingRep: 'Marketing Rep',
  specialInstructions: 'Special Instructions',
};

const CAMEL = {
  lookupCode: 'LookupCode',
  name: 'Name',
  payeeName: 'PayeeName',
  address1: 'Address1',
  address2: 'Address2',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  phone: 'Phone',
  fax: 'Fax',
  email: 'Email',
  feeTransferLedger: 'FeeTransferLedger',
  stateOfIncorporation: 'StateOfIncorporation',
  marketingRep: 'MarketingRep',
  legalName: 'LegalName',
  fundingAddress1: 'FundingAddress1',
  fundingAddress2: 'FundingAddress2',
  fundingCity: 'FundingCity',
  fundingState: 'FundingState',
  fundingZip: 'FundingZip',
  fundingPhone: 'FundingPhone',
  fundingFax: 'FundingFax',
};

async function syncCompanyType(config: CompanySyncConfig, items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];
  const f = config.useSpacedFields ? SPACED : CAMEL;

  for (const item of items) {
    const code = str(item, f.lookupCode);
    if (!code) { skipped++; continue; }

    try {
      // Table 1: contacts (lightweight, match on flookup_code)
      const [existingContact] = await db.select({ id: contacts.id })
        .from(contacts).where(eq(contacts.flookupCode, code)).limit(1);

      const contactVals: Record<string, unknown> = {
        flookupCode: code,
        companyName: str(item, f.name),
        isActive: true,
        updatedAt: new Date(),
      };
      if (config.contactFlag) {
        contactVals[config.contactFlag] = true;
      }

      if (existingContact) {
        await db.update(contacts)
          .set(omitEmptyForUpdate(contactVals))
          .where(eq(contacts.id, existingContact.id));
      } else {
        await db.insert(contacts).values({
          ...contactVals,
          sourceSystem: 'softpro',
          type: 'company_contact' as const,
        });
      }

      // Table 2: companies (full record, match on lookup_code)
      const [existingCompany] = await db.select({ id: companies.id })
        .from(companies).where(eq(companies.lookupCode, code)).limit(1);

      const companyName = str(item, f.name);
      const companyVals: Record<string, unknown> = {
        lookupCode: code,
        name: companyName,
        payeeName: str(item, f.payeeName),
        companyType: config.companyType,
        address1: str(item, f.address1),
        address2: str(item, f.address2),
        city: str(item, f.city),
        state: str(item, f.state),
        zip: str(item, f.zip),
        phone: str(item, f.phone),
        fax: str(item, f.fax),
        email: str(item, f.email),
        signatureLine: config.useSpacedFields ? str(item, SPACED.signatureLine) : null,
        feeTransferLedger: str(item, f.feeTransferLedger),
        stateOfIncorporation: str(item, f.stateOfIncorporation),
        marketingRep: str(item, f.marketingRep),
        specialInstructions: config.useSpacedFields ? str(item, SPACED.specialInstructions) : null,
        [config.companyFlag]: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (!config.useSpacedFields) {
        companyVals.legalName = str(item, CAMEL.legalName);
        companyVals.fundingAddress1 = str(item, CAMEL.fundingAddress1);
        companyVals.fundingAddress2 = str(item, CAMEL.fundingAddress2);
        companyVals.fundingCity = str(item, CAMEL.fundingCity);
        companyVals.fundingState = str(item, CAMEL.fundingState);
        companyVals.fundingZip = str(item, CAMEL.fundingZip);
        companyVals.fundingPhone = str(item, CAMEL.fundingPhone);
        companyVals.fundingFax = str(item, CAMEL.fundingFax);
      }

      if (config.extraCompanyFields) {
        Object.assign(companyVals, config.extraCompanyFields(item));
      }

      if (existingCompany) {
        await db.update(companies)
          .set(omitEmptyForUpdate(companyVals))
          .where(eq(companies.id, existingCompany.id));
        updated++;
      } else {
        await db.insert(companies).values({
          ...companyVals,
          sourceSystem: 'softpro',
          name: companyName ?? code,
        });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: code, error: describeSyncError(err) });
    }
  }

  return { entityType: config.entityType, totalFetched: items.length, created, updated, skipped, errors };
}

/** Flag contacts assigned on any order as escrow officers (covers external SoftPro persons). Idempotent. */
async function reconcileEscrowOfficerFlagsFromOrders(): Promise<void> {
  await db.execute(sql`
    UPDATE contacts AS c
    SET is_escrow_officer = true
    WHERE EXISTS (
      SELECT 1 FROM orders AS o
      WHERE o.escrow_officer_id = c.id
    )
      AND c.is_escrow_officer = false
  `);
}

// ─── Sync configs ────────────────────────────────────────────────────────

const COMPANY_CONFIGS: Record<string, CompanySyncConfig> = {
  'Escrow Company': {
    entityType: 'Escrow Company',
    userType: 'Escrow Company',
    companyType: 'escrow_company',
    contactFlag: 'isEscrow',
    companyFlag: 'isEscrowCompany',
    useSpacedFields: true,
  },
  'Lender': {
    entityType: 'Lender',
    userType: 'Lender',
    companyType: 'lender',
    contactFlag: 'isLender',
    companyFlag: 'isLender',
    useSpacedFields: false,
  },
  'Mortgage Broker': {
    entityType: 'Mortgage Broker',
    userType: 'Mortgage Broker',
    companyType: 'mortgage_broker',
    contactFlag: 'isMortgageBroker',
    companyFlag: 'isMortgageBroker',
    useSpacedFields: true,
  },
  'SellingAgentBroker': {
    entityType: 'SellingAgentBroker',
    userType: COMPANY_TYPE_MAP.real_estate_company,
    companyType: 'real_estate_company',
    contactFlag: 'isRealEstateAgent',
    companyFlag: 'isRealEstateCompany',
    useSpacedFields: true,
  },
  'Underwriter': {
    entityType: 'Underwriter',
    userType: 'Underwriter',
    companyType: 'underwriter',
    contactFlag: 'isUnderwriter',
    companyFlag: 'isUnderwriter',
    useSpacedFields: true,
  },
};

// ─── Main Handler ────────────────────────────────────────────────────────

export async function fetchSyncContactRows(
  entityType: SyncContactEntityType,
  options: FetchSyncContactRowsOptions = {},
): Promise<{ items: SyncRow[]; error: string | null }> {
  if (entityType === 'Sales Rep') {
    try {
      const result = await getSalesReps();
      if (!result.success || !result.data) {
        return { items: [], error: result.error?.message ?? 'GetOrderMarketingRep returned no data' };
      }
      return { items: result.data, error: null };
    } catch (err) {
      return {
        items: [],
        error: `GetOrderMarketingRep failed: ${err instanceof Error ? err.message : 'timeout/hang'}`,
      };
    }
  }

  const userType = COMPANY_CONFIGS[entityType]?.userType ?? entityType;
  const pageSize = options.pageSize ?? 1000;
  const items: SyncRow[] = [];

  // ─── PAGINATE UNTIL A PAGE COMES BACK EMPTY ───────────────────────────────
  //
  // This loop used to be `while (hasMore)`. `hasMore` was parsed from the top
  // level of the response, SoftPro returns it inside `Pagination`, and so it
  // was `undefined` -> false on every call. The loop ran ONCE. Every contact
  // type has been truncated to its first 1,000 rows since 2026-07-14
  // (`d33c9ac`): 15,609 people in SoftPro, 1,000 read.
  //
  // The parser is fixed, but the loop no longer depends on the flag. A vendor
  // boolean is one field away from silently capping a sync, and nothing about
  // a truncated read looks wrong from the outside — the rows we did get are
  // all valid. So: keep asking until the vendor has nothing left to give.
  //
  // "Empty" means empty AFTER A RETRY. During the investigation `Page=1`
  // returned zero rows once and 1,000 rows on the next call, so treating a
  // single empty response as the end would reintroduce the same silent
  // truncation through a different door.
  const MAX_PAGES = 500;
  let page = 1;

  while (page <= MAX_PAGES) {
    let pageItems: SyncRow[] | null = null;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const adapterResult = await getLookupTable({
        userType,
        Page: page,
        pageSize,
        ...(options.modifiedSince ? { modifiedSince: options.modifiedSince } : {}),
      });

      if (!adapterResult.success || !adapterResult.data) {
        lastError = adapterResult.error?.message ?? 'Failed to fetch lookup table';
        continue;
      }
      lastError = null;
      if (adapterResult.data.items.length > 0) {
        pageItems = adapterResult.data.items;
        break;
      }
      // Empty. Retry the SAME page once before believing it.
    }

    // A hard failure must not be read as the end of the data. Returning the
    // rows collected so far would look exactly like a successful short sync,
    // which is the failure mode this whole comment exists to prevent.
    if (lastError) return { items: [], error: lastError };
    if (!pageItems) break;

    items.push(...pageItems);
    page += 1;
  }

  return { items, error: null };
}

export function getSyncContactLookupCode(
  entityType: SyncContactEntityType,
  item: SyncRow
): string | null {
  switch (entityType) {
    case 'Order Contact - Person':
      return str(item, 'LookupCode');
    case 'Title Officer':
      return str(item, 'Title officer/Examiner');
    case 'Escrow Officer':
      return str(item, 'Escrow officer/Closer');
    case 'Sales Rep':
      return str(item, 'LookUpCode') ?? str(item, 'LookupCode');
    case 'Escrow Company':
    case 'SellingAgentBroker':
    case 'Mortgage Broker':
    case 'Underwriter':
      return str(item, CAMEL.lookupCode) ?? str(item, SPACED.lookupCode);
    case 'Lender':
      return str(item, CAMEL.lookupCode);
  }
}

export function sortSyncContactRows(
  entityType: SyncContactEntityType,
  items: SyncRow[]
): SyncRow[] {
  return [...items].sort((a, b) => {
    const aCode = getSyncContactLookupCode(entityType, a) ?? '';
    const bCode = getSyncContactLookupCode(entityType, b) ?? '';
    return aCode.localeCompare(bCode);
  });
}

export async function syncContactRows(
  entityType: SyncContactEntityType,
  items: SyncRow[],
  options: SyncContactRowsOptions = {}
): Promise<SyncContactsResult> {
  switch (entityType) {
    case 'Order Contact - Person':
      return syncOpenContacts(items);
    case 'Title Officer':
      return syncTitleOfficers(items);
    case 'Escrow Officer':
      return syncEscrowOfficers(items);
    case 'Sales Rep':
      return syncSalesRepRows(items, options);
    default: {
      const config = COMPANY_CONFIGS[entityType];
      if (config) {
        return syncCompanyType(config, items);
      }
      return emptyResult(entityType, `No handler for: ${entityType}`);
    }
  }
}

export async function handleSyncContacts(
  payload: SyncContactsPayload
): Promise<SyncContactsResult> {
  const { entityType } = payload;

  if (!isSyncContactEntityType(entityType)) {
    return emptyResult(entityType, `Invalid entity type: ${entityType}`);
  }

  const fetched = await fetchSyncContactRows(entityType);
  if (fetched.error) {
    return emptyResult(entityType, fetched.error);
  }

  const result = await syncContactRows(entityType, fetched.items, {
    deactivateExistingSalesReps: entityType === 'Sales Rep',
  });

  await reconcileEscrowOfficerFlagsFromOrders();
  return result;
}
