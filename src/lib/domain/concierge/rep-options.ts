export interface RepOption {
  id: number;
  /** What the dropdown shows. Disambiguated when two reps share a name. */
  label: string;
  /** The name as recorded, which is what goes on the document. */
  name: string;
  email: string | null;
  company: string | null;
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
 * actually differs: email, then company, then the contact id, which always
 * differs. The id is ugly and is the point — an operator seeing "Kevin Cameron
 * (#8821)" knows something is wrong with the data, where two identical rows
 * tell them nothing.
 */
export function labelReps(reps: readonly Omit<RepOption, 'label'>[]): RepOption[] {
  const byName = new Map<string, number>();
  for (const r of reps) {
    const k = r.name.trim().toLowerCase();
    byName.set(k, (byName.get(k) ?? 0) + 1);
  }

  return reps.map((r) => {
    const shared = (byName.get(r.name.trim().toLowerCase()) ?? 0) > 1;
    if (!shared) return { ...r, label: r.name };

    const distinguisher = r.email?.trim() || r.company?.trim() || `#${r.id}`;
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
