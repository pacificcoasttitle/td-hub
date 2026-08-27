/**
 * Applies migration 0039 by executing the migration file itself, so that what ran
 * against production and what is in the repository cannot differ.
 *
 *   --dry-run   executes it inside a transaction and rolls back, printing every
 *               NOTICE and WARNING and the resulting catalog state as seen from
 *               inside that transaction. Nothing is committed.
 *   --apply     executes it for real.
 *   --rollback  executes the documented rollback SQL instead (see the migration
 *               header). Present so the undo path is a command, not a paragraph
 *               someone has to retype at 2am.
 *
 * Prints no secret values.
 */
import fs from 'node:fs';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local' });

const MIGRATION = 'src/lib/db/migrations/0039_revoke_anon_write_grants.sql';

const ROLLBACK_SQL = `
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
`;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  onnotice: (n) => console.log(`  [${n.severity}] ${n.message}`),
});

const mode = process.argv[2];

async function catalogState(q: typeof sql) {
  const privCounts = await q<Record<string, unknown>[]>`
    SELECT g.grantee, p.priv, count(*)::int AS tables_granting
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated','service_role']) AS grantee) g
    CROSS JOIN (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS priv) p
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
      AND has_table_privilege(g.grantee, c.oid, p.priv)
    GROUP BY 1,2 ORDER BY 1,2`;
  console.log('  --- public tables granting each privilege ---');
  for (const r of privCounts) console.log(`    ${r.grantee} ${r.priv} -> ${r.tables_granting}`);

  const acl = await q<Record<string, unknown>[]>`
    SELECT pg_get_userbyid(da.defaclrole) AS creator, da.defaclobjtype AS objtype,
           da.defaclacl::text AS acl
    FROM pg_default_acl da JOIN pg_namespace ns ON ns.oid = da.defaclnamespace
    WHERE ns.nspname = 'public' ORDER BY 2, 1`;
  console.log('  --- pg_default_acl for schema public ---');
  for (const r of acl) console.log(`    ${r.creator} ${r.objtype} ${r.acl}`);
}

(async () => {
  if (mode === '--rollback') {
    console.log('=== ROLLBACK: restoring all privileges to anon, authenticated ===');
    await sql.unsafe(ROLLBACK_SQL);
    console.log('restored. state now:');
    await catalogState(sql);
    await sql.end({ timeout: 5 });
    return;
  }

  if (mode !== '--dry-run' && mode !== '--apply') {
    console.error('usage: tsx scripts/audit/apply-migration-0039.ts <--dry-run|--apply|--rollback>');
    process.exit(2);
  }

  const text = fs.readFileSync(MIGRATION, 'utf8');
  console.log(`=== ${mode} of ${MIGRATION} (${text.length} bytes) ===`);
  console.log('state BEFORE:');
  await catalogState(sql);

  if (mode === '--dry-run') {
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        console.log('\nstate INSIDE the transaction:');
        await catalogState(tx as unknown as typeof sql);
        throw new Error('__rollback__');
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== '__rollback__') throw err;
      console.log('\nrolled back — nothing committed');
    }
  } else {
    await sql.unsafe(text);
    console.log('\napplied.');
  }

  console.log('\nstate AFTER:');
  await catalogState(sql);
  await sql.end({ timeout: 5 });
})().catch(async (err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
