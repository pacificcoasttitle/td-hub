export interface RepOption {
  id: number;
  /** What the dropdown shows. Disambiguated when two reps share a name. */
  label: string;
  /** The name as recorded, which is what goes on the document. */
  name: string;
  email: string | null;
  company: string | null;
  /**
   * The facts that separate a duplicate record, from repTwinFacts — "has login
   * · 76 orders" against "NO login · 0 orders". Set by the route, not here:
   * this module stays free of the database so it can be asserted directly.
   *
   * A contact id tells the operator something is wrong. This tells them which
   * of the two rows is the real rep, so it is shown wherever it exists.
   */
  detail?: string | null;
  /** False means a report branded to them never reaches their own list. */
  hasLogin?: boolean;
}

/**
 * Label every rep so no two entries read the same.
 *
 * TWO REPS SHARE A NAME TODAY: "Kevin Cameron" appears twice in contacts, and
 * a dropdown that offers the same string twice asks the operator to pick
 * between two things they cannot tell apart. Whichever they choose, the
 * profile goes out under a name that is right and a contact id that is a coin
 * toss — and the document carries the rep's phone and email, so the wrong one
 * is a customer contacting a stranger.
 *
 * A unique name is shown as-is. A shared one gains the first thing that
 * ACTUALLY DIFFERS WITHIN ITS GROUP: email, then company, then the contact id,
 * which always differs. The id is ugly and is the point — an operator seeing
 * "Kevin Cameron · #8821" knows something is wrong with the data, where two
 * identical rows tell them nothing.
 *
 * "WITHIN ITS GROUP" IS THE WHOLE FUNCTION, and the first version of it got
 * this wrong. It chose `email || company || '#id'`, which only asks whether a
 * field is PRESENT. Both Kevin Cameron rows are `kcameron@pct.com` with no
 * company (scripts/audit/concierge-rep-labels.ts, 54 reps, one shared name):
 * email was present, so email was chosen, so both labels came out as
 * "Kevin Cameron · kcameron@pct.com" and the id fallback never ran. The
 * function failed on the single case it exists for, and indistinguishable()
 * below is what proved it — which is why repLabelsAreUnique in the route test
 * runs it against the real shape rather than leaving it as documentation.
 */
export function labelReps(reps: readonly Omit<RepOption, 'label'>[]): RepOption[] {
  const groups = new Map<string, Omit<RepOption, 'label'>[]>();
  for (const r of reps) {
    const k = r.name.trim().toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  /** Non-empty here, and different from every other row sharing this name. */
  const separates = (
    group: readonly Omit<RepOption, 'label'>[],
    r: Omit<RepOption, 'label'>,
    pick: (x: Omit<RepOption, 'label'>) => string | null,
  ): string | null => {
    const mine = pick(r)?.trim();
    if (!mine) return null;
    const twins = group.filter((x) => x.id !== r.id && pick(x)?.trim().toLowerCase() === mine.toLowerCase());
    return twins.length === 0 ? mine : null;
  };

  return reps.map((r) => {
    const group = groups.get(r.name.trim().toLowerCase()) ?? [r];
    if (group.length < 2) return { ...r, label: r.name };

    const distinguisher = separates(group, r, (x) => x.email)
      ?? separates(group, r, (x) => x.company)
      ?? `#${r.id}`;
    return { ...r, label: `${r.name} · ${distinguisher}` };
  });
}

/**
 * Whether any two options still read identically.
 *
 * The guard for the guard: if a future change makes the distinguisher blank
 * for two rows, labelReps would quietly go back to offering twins. Callers can
 * assert this is empty.
 */
export function indistinguishable(options: readonly RepOption[]): string[] {
  const seen = new Map<string, number>();
  for (const o of options) {
    const k = o.label.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
