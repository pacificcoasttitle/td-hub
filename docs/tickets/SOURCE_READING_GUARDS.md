# The guards that read source text

**Status:** inventoried 2026-09-23. Helper landed, four guards migrated, the
rest listed.

## First, a correction. Then a correction to the correction.

I said **four**. I had counted the ones I touched that day and reported it as
the population.

I then said **47**, from a grep loose enough to match any `readFileSync` whose
argument ended in something `.ts`-shaped — including fixtures.

The real figure is **25**, from a detector that matches
`readFileSync(…'*.ts'…)` in a test file, which you can run:
`node scripts/audit/detect-source-readers.mjs`. It is the number the ratchet
below is seeded from, so it cannot drift from the claim.

Three numbers for one question, and only the third had a reproducible method
behind it. The first two were a guess and a bad grep, stated the same way as
the third. That is the same error as reporting a sync *rate* as a *total*: a
figure describing what somebody looked at, presented as a figure describing
what is there.

## The failure that matters

A source-reading guard has two failure modes and they are not equal.

**Breaking on a refactor is fine.** It fails, someone looks, one of the two is
wrong. Loud, and dealt with.

**Matching nothing and passing is the one that costs.** A pattern that cannot
match finds no violation, so the guard reports green while checking nothing.
Twice in one day:

- `new RegExp(`${f}:\\s*c\\.${f}`)` written through a bash heredoc, which ate a
  backslash. In a template literal `\s` is just `s`, so the pattern became
  `city:s*c.city` and matched nothing.
- `s.indexOf('\n  }\n')` against a file git checked out as CRLF. `indexOf`
  returned −1, the slice ran to end-of-file, and the guard silently became
  about a different function.

Same disease as a vacuous fixture (EVIDENCE_RULES.md rule 4), different coat.

## The fix, structural rather than by hand

`src/test-support/read-source.ts`. You cannot read a source file through it
without naming something that must be in it; if the anchor is absent it throws,
saying the file moved. `sliceFrom` refuses a slice whose end it cannot find
rather than returning the rest of the file. Line endings are normalised, since
a guard's subject is the code and not the machine that checked it out.

Hand-anchoring 47 files would have been the wrong shape. New guards get this by
construction, and existing ones migrate when touched.

## The inventory

| Guard | Property it protects | Could structure replace it? |
| --- | --- | --- |
| `rerender-parity` · template refusal | A report is not re-rendered onto a template its figures were not computed for | **Yes — done.** Replaced by `rerender-template.test.ts`, which calls the function and watches it refuse. Three source assertions deleted. |
| `rerender-parity` · no `as never` | A jsonb read is checked, not cast | **No.** The failure is `undefined` at render time; only the source shows the cast. Kept, anchored. |
| `render.test` · uses the shared comp mapping | The re-render does not hand-roll a candidate and drop fields | **Partly.** `comp-row.ts` removed the second mapping; this guards against a new one appearing. Achievable only with an opaque row type. Kept, anchored. |
| `render.test` · imports nothing from SiteX | A re-render cannot spend a credit | **No, and it should stay source-read.** "This module cannot reach the vendor" is a statement about imports. Kept, anchored. |
| `no-credit-language` | No operator-facing surface quotes credits | **No.** A content policy over prose. Kept; now also asserts it is reaching the three files the wording came off. |
| `middleware.test` | Every webhook route is reachable without a session | **Already structural.** It imports `isPublic` and walks the route tree — no source text. No change needed. |
| `comp-row` / `subject-facts` round trips | Two paths build one document identically | **Already structural.** One mapping, both directions; there is no second mapping to grep for. **This is the model.** |

## The rule that comes out of it

**A property enforced by there being no other way to do it beats a property
enforced by grepping for the wrong way.** Where that is reachable, take the
guard out — as `comp-row.ts` did. Where it is not, keep the guard and let it be
brittle: brittle-and-loud is an acceptable trade for a real invariant, and
silent-and-green is not.

## The ratchet, which retires the rule

"No new source-reading guard without a conversation" depended on somebody
remembering it. `src/test-support/source-readers.test.ts` does not:

- A test reading source with bare `readFileSync` that is **not** on the
  baseline **fails**. New guards must go through `readSource`.
- A baseline entry that has **stopped** doing it also fails, so the list
  shrinks as files migrate and cannot quietly become a lie.

Mutation-checked both ways: a new bypassing file fails it, and a stale entry
fails it.

Migrating one is two lines — swap `readFileSync(p, 'utf8')` for
`readSource(p, { mustContain: '<the declaration it is about>' })` and delete
its entry. Worth doing whenever one is opened for any other reason. A single
churn commit touching 25 files would be unreviewable, which is the point of
letting them migrate as they are touched.

## The known-failing shape: zero instances

The pattern that actually failed here was a regex built from a template
literal, where `\s` collapses to `s`. Searched deliberately rather than
assumed: **there is no `new RegExp(` in any test in this repo.** The only
`RegExp` token is a type annotation. The subset is empty, and that is a
finding rather than an omission.

## Not done

The 25 baseline guards were not individually assessed. They are **not known to
be broken; they are known not to have been checked** — a distinction worth
keeping, since collapsing it is where most of this session's wrong numbers came
from.
