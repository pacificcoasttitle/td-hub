/**
 * READ-ONLY. Does moving a comparable-criteria slider change anything?
 *
 * The operator report is "the comparable criteria control does nothing".
 * Reading the chain — panel, PATCH route, renderProfile — every link looks
 * correct, so this stops reading and measures: load a profile's STORED
 * comparables and run selectComps against several criteria sets, including
 * absurdly tight ones. If the selection never changes, the filter is the
 * defect; if it changes here, the defect is downstream of it.
 *
 * NO WRITES AND NO VENDOR CALLS — renderProfile is never called, only the pure
 * filter it delegates to.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-criteria-responds.mts 4
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { conciergeProfiles, conciergeProfileComps } from '../../src/lib/db/schema/concierge';
import { DEFAULT_CRITERIA, selectComps, type CompCriteria } from '../../src/lib/domain/concierge/comp-filter';
import { compFromRow } from '../../src/lib/domain/concierge/comp-row';
import { subjectFactsFromRow } from '../../src/lib/domain/concierge/subject-facts';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

(async () => {
  const id = Number(process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '4');
  const [profile] = await db.select().from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  if (!profile) throw new Error(`no profile ${id}`);

  const storedComps = await db.select().from(conciergeProfileComps)
    .where(eq(conciergeProfileComps.profileId, id))
    .orderBy(conciergeProfileComps.sourcePosition);
  const candidates = storedComps.map(compFromRow);
  const facts = subjectFactsFromRow(profile);
  const now = new Date();

  const stored: CompCriteria = {
    sameUseCode: profile.criteriaSameUseCode,
    livingAreaPct: profile.criteriaLivingAreaPct,
    bedDelta: profile.criteriaBedDelta,
    bathDelta: profile.criteriaBathDelta,
    radiusMiles: num(profile.criteriaRadiusMiles),
    months: profile.criteriaMonths,
    maxComps: profile.criteriaMaxComps ?? DEFAULT_CRITERIA.maxComps,
  };

  console.log(`\nProfile ${id} · ${profile.requestedAddress}`);
  console.log(`  stored comparables: ${candidates.length}`);
  console.log(`  subject facts: ${JSON.stringify(facts)}`);
  console.log(`  stored criteria: ${JSON.stringify(stored)}\n`);

  const cases: { name: string; c: CompCriteria }[] = [
    { name: 'stored (as the profile has it)', c: stored },
    { name: 'maxComps 1', c: { ...stored, maxComps: 1 } },
    { name: 'radius 0.1 mi', c: { ...stored, radiusMiles: 0.1 } },
    { name: 'months 1', c: { ...stored, months: 1 } },
    { name: 'livingAreaPct 1', c: { ...stored, livingAreaPct: 1 } },
    { name: 'bedDelta 0', c: { ...stored, bedDelta: 0 } },
    { name: 'everything off, maxComps 30', c: { sameUseCode: false, livingAreaPct: null, bedDelta: null, bathDelta: null, radiusMiles: null, months: null, maxComps: 30 } },
  ];

  console.log(`  ${'criteria'.padEnd(34)} ${'returned'.padEnd(9)} ${'qualified'.padEnd(10)} ${'shown'.padEnd(6)} selected positions`);
  const shown: number[] = [];
  for (const { name, c } of cases) {
    const r = selectComps(candidates, facts, c, now);
    const positions = r.selected.map((s) => s.sourcePosition).join(',');
    shown.push(r.counts.shown);
    console.log(`  ${name.padEnd(34)} ${String(r.counts.returned).padEnd(9)} ${String(r.counts.qualified).padEnd(10)} ${String(r.counts.shown).padEnd(6)} ${positions || '(none)'}`);
  }

  const allSame = shown.every((n) => n === shown[0]);
  console.log();
  if (allSame) {
    console.log('  EVERY CRITERIA SET SELECTED THE SAME NUMBER. The filter is not');
    console.log('  responding — the defect is in selectComps or in what it is given,');
    console.log('  not in the UI or the route.');
  } else {
    console.log('  The filter responds. Selections differ across criteria, so the');
    console.log('  defect is downstream: the render, the stored row, or the list.');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exit(1); });
