/**
 * Collapse three people created twice on 2026-09-11 onto the records the hub
 * already held. Approved by Gerard 2026-09-11.
 *
 * None of these is Erika's shape. SoftPro was never asked about the original
 * code: for each, allocateLookupCode saw the code already in our table and
 * minted a suffixed copy without asking who held it.
 *
 *   Sandra Ruiz     keep #23076 SanRuiAmer   drop #23077 SanRuiAmer1
 *     Created twice by the hub 46 seconds apart after a "Phone is required"
 *     failure. #23076 already carries both the realtor and mortgage-broker
 *     flags, so nothing is lost. The order failure at 00:33 used SanRuiAmer1.
 *
 *   Chris Newcomer  keep #15511 ChrNewNewc   drop #23080 ChrNewNewc1
 *     Synced from SoftPro as "Christopher", flagged is_escrow_officer only, so
 *     the Parties picker (which searched is_escrow) could not find him.
 *     #15511 gains is_escrow and a link to Newcomer Escrow, Inc.
 *
 *   Ali Darian      keep #17356 AliDarGuar   drop #23079 AliDarGuar1
 *     Synced from SoftPro with no type flag at all, so the mortgage-broker
 *     picker could not find her. The duplicate chose company Guar2304; SoftPro
 *     and #17356 both say Guard2728, and Gerard ruled for SoftPro's value.
 *     #17356 gains is_mortgage_broker and a link to Guard2728. A change of
 *     firm, if real, is an edit to #17356.
 *
 * One transaction. Preflight aborts if any row is not exactly as approved or
 * if anything but a company link references a record being deactivated.
 * Our table only — the suffixed codes still exist in SoftPro.
 *
 * Usage: npx tsx --env-file=.env.local scripts/one-off/collapse-sept11-duplicates.mts [--commit]
 */
import postgres from 'postgres';

const commit = process.argv.includes('--commit');
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

interface Collapse {
  who: string;
  keepId: number;
  keepCode: string;
  dropId: number;
  dropCode: string;
  email: string;
  flag: 'is_escrow' | 'is_mortgage_broker' | null;
  linkCompanyId: number | null;
  linkCompanyCode: string | null;
}

const PLAN: Collapse[] = [
  { who: 'Sandra Ruiz', keepId: 23076, keepCode: 'SanRuiAmer', dropId: 23077, dropCode: 'SanRuiAmer1',
    email: 'sruiz@americanmac.com', flag: null, linkCompanyId: null, linkCompanyCode: null },
  { who: 'Chris Newcomer', keepId: 15511, keepCode: 'ChrNewNewc', dropId: 23080, dropCode: 'ChrNewNewc1',
    email: 'chris@newcomerescrow.com', flag: 'is_escrow', linkCompanyId: 942, linkCompanyCode: 'Newco1773' },
  { who: 'Ali Darian', keepId: 17356, keepCode: 'AliDarGuar', dropId: 23079, dropCode: 'AliDarGuar1',
    email: 'ali@gcloan.com', flag: 'is_mortgage_broker', linkCompanyId: 3769, linkCompanyCode: 'Guard2728' },
];

async function preflight(): Promise<void> {
  for (const c of PLAN) {
    const rows = await sql<{ id: number; code: string; email: string; is_active: boolean }[]>`
      SELECT id, softpro_lookup_code AS code, lower(email) AS email, is_active
      FROM contacts WHERE id IN (${c.keepId}, ${c.dropId})`;
    const keep = rows.find((r) => r.id === c.keepId);
    const drop = rows.find((r) => r.id === c.dropId);
    if (!keep || keep.code !== c.keepCode || keep.email !== c.email || !keep.is_active) {
      throw new Error(`ABORT ${c.who}: keep row #${c.keepId} is not as approved: ${JSON.stringify(keep)}`);
    }
    if (!drop || drop.code !== c.dropCode || drop.email !== c.email || !drop.is_active) {
      throw new Error(`ABORT ${c.who}: drop row #${c.dropId} is not as approved: ${JSON.stringify(drop)}`);
    }
    if (c.linkCompanyId !== null) {
      const [co] = await sql<{ lookup_code: string }[]>`SELECT lookup_code FROM companies WHERE id = ${c.linkCompanyId}`;
      if (co?.lookup_code !== c.linkCompanyCode) {
        throw new Error(`ABORT ${c.who}: company ${c.linkCompanyId} is not ${c.linkCompanyCode}: ${JSON.stringify(co)}`);
      }
    }
  }

  const dropIds = PLAN.map((c) => c.dropId);
  const fks = await sql<{ tbl: string; col: string }[]>`
    SELECT DISTINCT cl.relname AS tbl, a.attname AS col
    FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)
    WHERE k.contype = 'f' AND k.confrelid = 'public.contacts'::regclass`;
  for (const f of fks) {
    if (f.tbl === 'contact_company_links') continue;
    const [r] = await sql.unsafe(`SELECT count(*)::int n FROM "${f.tbl}" WHERE "${f.col}" = ANY($1)`, [dropIds]);
    if (r!.n > 0) throw new Error(`ABORT: ${f.tbl}.${f.col} references a record being deactivated (${r!.n} rows)`);
  }
  console.log('preflight OK: all six rows as approved; nothing but company links references the three being deactivated');
}

await preflight();

if (!commit) {
  for (const c of PLAN) {
    console.log(`DRY RUN ${c.who}: keep #${c.keepId} ${c.keepCode}`
      + (c.flag ? `, set ${c.flag}` : '')
      + (c.linkCompanyId ? `, link to ${c.linkCompanyCode}` : '')
      + `; deactivate #${c.dropId} ${c.dropCode}`);
  }
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  for (const c of PLAN) {
    if (c.flag === 'is_escrow') {
      await tx`UPDATE contacts SET is_escrow = true, updated_at = now() WHERE id = ${c.keepId}`;
    } else if (c.flag === 'is_mortgage_broker') {
      await tx`UPDATE contacts SET is_mortgage_broker = true, updated_at = now() WHERE id = ${c.keepId}`;
    }

    if (c.linkCompanyId !== null) {
      await tx`INSERT INTO contact_company_links (contact_id, company_id, relationship_type)
               SELECT ${c.keepId}, ${c.linkCompanyId}, 'employee'
               WHERE NOT EXISTS (
                 SELECT 1 FROM contact_company_links
                 WHERE contact_id = ${c.keepId} AND company_id = ${c.linkCompanyId}
               )`;
    }

    const dropped = await tx`UPDATE contacts SET is_active = false, updated_at = now()
                             WHERE id = ${c.dropId} AND is_active = true`;
    if (dropped.count !== 1) throw new Error(`${c.who}: expected to deactivate #${c.dropId}, deactivated ${dropped.count}`);

    await tx`INSERT INTO admin_activity_logs (user_id, action, entity_type, entity_id, meta) VALUES (
      'script:collapse-sept11-duplicates', 'contact_duplicates_collapsed', 'contact', ${String(c.keepId)},
      ${tx.json({
        person: c.who,
        kept: { id: c.keepId, code: c.keepCode },
        deactivated: { id: c.dropId, code: c.dropCode },
        flag_added: c.flag,
        company_linked: c.linkCompanyCode,
        approved_by: 'Gerard',
        reason: 'hub minted a suffixed copy of a person it already held',
      })})`;
    console.log(`COMMITTED ${c.who}: kept #${c.keepId}, deactivated #${c.dropId}`);
  }
});

await sql.end();
process.exit(0);
