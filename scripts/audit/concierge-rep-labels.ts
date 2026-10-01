/**
 * Do the labels the rep combobox will show actually distinguish every rep?
 *
 * FREE. Reads `contacts` only — no vendor, no credit, one query.
 *
 * WHY THIS EXISTS. labelReps() disambiguates a shared name with the first of
 * email, company, then the contact id. That is only correct if the chosen
 * distinguisher DIFFERS within the group, and rep-visibility.ts states the two
 * Kevin Cameron rows share a name AND an email — in which case email is
 * non-empty, gets chosen, and both rows read the same. indistinguishable() is
 * the assertion for exactly this; nothing had run it against the real book.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-rep-labels.ts
 */
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { contacts } from '../../src/lib/db/schema';
import { labelReps, indistinguishable } from '../../src/lib/domain/concierge/rep-options';

async function main() {
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.fullName,
      email: contacts.email,
      company: contacts.companyName,
    })
    .from(contacts)
    .where(and(
      eq(contacts.isSalesRep, true),
      isNotNull(contacts.fullName),
      ne(contacts.fullName, ''),
    ))
    .orderBy(asc(contacts.fullName));

  console.log(`sales reps with a name: ${rows.length}`);

  const input = rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    email: r.email ?? null,
    company: r.company ?? null,
  }));

  // Groups that share a name — the only rows labelReps touches.
  const byName = new Map<string, typeof input>();
  for (const r of input) {
    const k = r.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const shared = [...byName.entries()].filter(([, g]) => g.length > 1);

  console.log(`\nnames held by more than one row: ${shared.length}`);
  for (const [, g] of shared) {
    console.log(`\n  "${g[0]!.name}" — ${g.length} rows`);
    for (const r of g) {
      console.log(`    #${r.id}  email=${JSON.stringify(r.email)}  company=${JSON.stringify(r.company)}`);
    }
    const emails = new Set(g.map((r) => (r.email ?? '').trim().toLowerCase()));
    const companies = new Set(g.map((r) => (r.company ?? '').trim().toLowerCase()));
    console.log(`    distinct emails: ${emails.size} · distinct companies: ${companies.size}`);
  }

  const labelled = labelReps(input);
  const collisions = indistinguishable(labelled);

  console.log(`\n=== labels that read identically: ${collisions.length} ===`);
  for (const c of collisions) {
    const who = labelled.filter((o) => o.label.trim().toLowerCase() === c);
    console.log(`  ${JSON.stringify(c)} — ids ${who.map((o) => o.id).join(', ')}`);
  }

  if (collisions.length === 0) console.log('  none — every rep reads uniquely.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
