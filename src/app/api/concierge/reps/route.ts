import { NextResponse } from 'next/server';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { labelReps } from '@/lib/domain/concierge/rep-options';
import { repTwinFacts, twinLabel } from '@/lib/domain/reports/rep-visibility';

export const dynamic = 'force-dynamic';

/**
 * GET — every sales rep, labelled so no two entries read the same.
 *
 * A DEDICATED ROUTE rather than loosening /api/contacts/search, which requires
 * a two-character query and caps pageSize at 50. There are 54 reps; widening a
 * shared search contract so one dropdown can fetch them all would change what
 * every other caller is allowed to ask for.
 *
 * The whole list in one call is the point of the change: the operator was
 * searching blind against a list small enough to simply read.
 *
 * FREE, and no vendor. Reads contacts.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  // labelReps is what stops two "Kevin Cameron" entries reaching the operator.
  const reps = labelReps(rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    email: r.email ?? null,
    company: r.company ?? null,
  })));

  // The decisive facts, for the rows where a name alone is not enough. Two
  // queries for the whole book regardless of its size, which is why asking for
  // all 54 costs the same as asking for eight.
  //
  // A LABEL SAYS THE ROWS DIFFER; THIS SAYS WHICH ONE IS THE REP. Both Kevin
  // Cameron rows are kcameron@pct.com with no company, so the label falls all
  // the way to "· #8" and "· #22265" — correct, unique, and useless for
  // choosing. "has login · 76 orders" against "NO login · 0 orders" is the
  // thing the operator can actually act on.
  const facts = await repTwinFacts(rows.map((r) => ({
    id: r.id, fullName: r.name, email: r.email,
  })));

  const withFacts = reps.map((r) => {
    const f = facts.get(r.id);
    return { ...r, detail: f ? twinLabel(f) : null, hasLogin: f?.hasLogin ?? true };
  });

  return NextResponse.json({ reps: withFacts });
}
