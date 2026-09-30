import { describe, expect, it } from 'vitest';
import { indistinguishable, labelReps } from './rep-options';

// The dropdown must never offer two entries a human cannot tell apart. There
// are 54 sales reps and one collision today — "Kevin Cameron" twice — and the
// document carries the chosen rep's phone and email, so picking the wrong one
// sends a customer to a stranger.

const rep = (id: number, name: string, email: string | null = null, company: string | null = null) =>
  ({ id, name, email, company });

describe('reps with unique names are shown plainly', () => {
  it('adds nothing when no name repeats', () => {
    const out = labelReps([rep(1, 'Mark Neveu'), rep(2, 'Angeline Wu')]);
    expect(out.map((o) => o.label)).toEqual(['Mark Neveu', 'Angeline Wu']);
  });
});

describe('a shared name gains the first thing that differs', () => {
  it('uses email when there is one', () => {
    const out = labelReps([
      rep(1, 'Kevin Cameron', 'kcameron@pct.com'),
      rep(2, 'Kevin Cameron', 'kevin.cameron@pct.com'),
    ]);
    expect(out[0]!.label).toBe('Kevin Cameron · kcameron@pct.com');
    expect(out[1]!.label).toBe('Kevin Cameron · kevin.cameron@pct.com');
    expect(indistinguishable(out)).toEqual([]);
  });

  it('falls back to company when the emails are missing', () => {
    const out = labelReps([
      rep(1, 'Kevin Cameron', null, 'Glendale'),
      rep(2, 'Kevin Cameron', null, 'Orange County'),
    ]);
    expect(out.map((o) => o.label)).toEqual([
      'Kevin Cameron · Glendale',
      'Kevin Cameron · Orange County',
    ]);
    expect(indistinguishable(out)).toEqual([]);
  });

  it('falls back to the contact id, which always differs', () => {
    // Deliberately ugly. Two identical rows tell an operator nothing; a
    // visible id tells them the data needs fixing.
    const out = labelReps([rep(8821, 'Kevin Cameron'), rep(9104, 'Kevin Cameron')]);
    expect(out.map((o) => o.label)).toEqual([
      'Kevin Cameron · #8821',
      'Kevin Cameron · #9104',
    ]);
    expect(indistinguishable(out)).toEqual([]);
  });

  it('leaves the recorded name alone — only the label changes', () => {
    // The document prints `name`, not `label`. Disambiguating the dropdown
    // must not put an email address on the cover.
    const out = labelReps([rep(1, 'Kevin Cameron', 'a@pct.com'), rep(2, 'Kevin Cameron', 'b@pct.com')]);
    expect(out.every((o) => o.name === 'Kevin Cameron')).toBe(true);
  });

  it('treats case and padding as the same name', () => {
    const out = labelReps([rep(1, 'Kevin Cameron', 'a@pct.com'), rep(2, '  kevin cameron ', 'b@pct.com')]);
    expect(indistinguishable(out)).toEqual([]);
    expect(out[0]!.label).toContain('·');
  });
});

describe('the guard on the guard', () => {
  it('reports a collision that survived labelling', () => {
    // If a future change blanks the distinguisher for two rows, labelReps
    // would go back to offering twins silently. This is what catches that.
    const twins = [
      { id: 1, name: 'Kevin Cameron', email: null, company: null, label: 'Kevin Cameron' },
      { id: 2, name: 'Kevin Cameron', email: null, company: null, label: 'Kevin Cameron' },
    ];
    expect(indistinguishable(twins)).toEqual(['kevin cameron']);
  });
});
