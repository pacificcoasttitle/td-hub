/**
 * READ-ONLY. Runs the old and new /api/form-options officer queries against the
 * live database, so the dropdown change can be checked by what it returns
 * rather than by reading the SQL.
 *
 *   npx tsx --env-file=.env.local scripts/audit/te-dropdown-proof.ts
 */
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { internalOfficerFilter } from '@/lib/domain/contacts/filters';
import { sql, type SQL } from 'drizzle-orm';

const columns = {
  id: contacts.id,
  officerName: contacts.officerName,
  fullName: contacts.fullName,
  office: contacts.officeLookupCode,
  lookupCode: contacts.lookupCode,
  softproLookupCode: contacts.softproLookupCode,
};

async function run(label: string, where: SQL): Promise<void> {
  const rows = await db.select(columns).from(contacts).where(where)
    .orderBy(contacts.officerName).limit(200);
  console.log(`\n${label} — ${rows.length} row(s)`);
  console.log('  ' + 'id'.padEnd(8) + 'name'.padEnd(24) + 'office'.padEnd(9)
    + 'lookup_code'.padEnd(14) + 'softpro_lookup_code');
  for (const r of rows.slice(0, 12)) {
    console.log('  '
      + String(r.id).padEnd(8)
      + String(r.officerName ?? r.fullName ?? '').slice(0, 23).padEnd(24)
      + String(r.office ?? '(null)').padEnd(9)
      + String(r.lookupCode ?? '(null)').padEnd(14)
      + String(r.softproLookupCode ?? '(null)'));
  }
  if (rows.length > 12) console.log(`  … ${rows.length - 12} more`);
}

(async () => {
  console.log('=== escrow officer dropdown ===');
  await run('BEFORE  is_escrow_officer = true', sql`${contacts.isEscrowOfficer} = true`);
  await run('AFTER   internalOfficerFilter(escrow_officer)', internalOfficerFilter('escrow_officer'));

  console.log('\n=== title officer dropdown ===');
  await run('BEFORE  is_title_officer = true', sql`${contacts.isTitleOfficer} = true`);
  await run('AFTER   internalOfficerFilter(title_officer)', internalOfficerFilter('title_officer'));

  console.log('\n=== offices the pre-send check will accept ===');
  const offices = await db
    .select({ office: contacts.officeLookupCode })
    .from(contacts)
    .where(sql`${contacts.isTitleOfficer} = true`);
  const known = [...new Set(offices.map((r) => (r.office ?? '').trim().toUpperCase()).filter(Boolean))];
  console.log(`  ${known.sort().join(', ')}`);
  console.log(`  PRV accepted? ${known.includes('PRV')}`);
  console.log(`  PCT accepted? ${known.includes('PCT')}`);

  process.exit(0);
})();
