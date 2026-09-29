# Looking at the document costs a credit, and it should not

**Status:** open. Found 2026-09-29 while counting profiles before the v3 merge.

## What happened

Four Concierge profiles exist. All four are **1358 5th St, La Verne**. All four
charged a SiteX credit, each with its own `sitex_search_id` and so its own
invoice line.

| id | template | opened | credit |
| --- | --- | --- | --- |
| 3 | v1 | 2026-09-18 | 1 |
| 4 | v2 | 2026-09-24 | 1 |
| 5 | v2 | 2026-09-24 | 1 |
| 6 | v2 | 2026-09-30 | 1 |

They are test runs. Somebody wanted to see what the document looks like, and
generating one was the way they knew to do it.

**The guard was not broken.** `claim.ts` normalises `[^a-z0-9]+` to a space, so
"1358 5th St" and "1358 5th st." collapse to one key — it saw every repeat. The
lasting check, `GET /for-property`, said "we already hold this" and offered
`AlreadyHavePanel` each time. Four people-decisions, not four defects.

## The part that is actually wrong

**Generating a new profile does not get you a newer document.** It gets you
newer *data* rendered by whatever template is deployed. Profile 6 was bought on
30 September to look at the redesign, and came out on **v2** — the old layout —
because v3 had not merged yet.

So the credit bought nothing that was not already on file. That is not a
misuse; it is the only affordance anyone was offered. Nothing in the UI
distinguishes:

- **fresh data** — a new SiteX pull, which costs a credit and is the only
  reason to generate again, and
- **a fresh document** — a re-render on the current template, which is free,
  reads the stored payload, and calls no vendor.

Those are different things and the interface presents one button.

## What already exists and nobody reached for

Three free paths, all live, none of them saying they are free:

| Route | What it does |
| --- | --- |
| `POST /api/concierge/profiles/[id]/render` | re-render on the current template with stored criteria |
| `PATCH /api/concierge/profiles/[id]/criteria` | re-filter stored comps and re-render |
| `POST /api/reports/concierge_profile/[id]/retry` | "Try again" — resume or re-render |

All return `creditsCharged: 0`. `renderProfile()` cannot spend: it imports
nothing from `integrations/sitex`, and a test asserts that. The design is right;
the discoverability is the gap.

## Two changes

**1 · Say that re-rendering is free, where the operator is deciding.**
The row action is there. It does not say it costs nothing, and next to a
"Generate" button that plainly does cost something, silence reads as "probably
also costs". One label — "Re-render (free)" — and a line on the row menu.

Note this only helps when the template has *already* changed under an existing
profile. It would not have saved profile 6, because on 30 September the new
template was not deployed anywhere Jerry could reach.

**2 · A way to see what the current template produces, without buying anything.**
This is the one that would have prevented it. Options, cheapest first:

- **Re-render an existing profile after each template bump.** Free, and it is
  what we are doing now for all four. Makes the newest layout always visible on
  a real file. Costs nothing but a habit.
- **A "preview current template" action** on any profile with a stored payload,
  rendering to a throwaway PDF without updating the row. Essentially
  `scripts/audit/concierge-render-preview.mts`, which already does exactly this
  from the command line: stored payload, real mappings, writes nothing.
- **A sample profile pinned to a fixed stored payload**, re-rendered on every
  deploy, so "what does the document look like now" has a permanent answer that
  is never a purchase.

**Recommendation: the first, immediately, plus the second when someone is next
in this code.** The third is the real fix but needs somebody to own a fixture
profile.

## Worth saying plainly

The instinct that produced four charges was a good one — look at the thing
before trusting it. It cost money only because the free way to look at it was
not visible. **Four SiteX lines on one parcel will read as a billing error to
whoever reconciles the invoice**, so they need to be recognised as test runs
before that happens.
