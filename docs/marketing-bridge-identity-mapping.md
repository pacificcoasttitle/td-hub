# Marketing bridge — identity mapping

**Status:** investigation + proposal. No schema changes, no code.
**Date:** Aug 10, 2026 · **Companion:** [marketing-bridge-design.md](./marketing-bridge-design.md)

How a TD Hub sales rep resolves to a Mailchimp audience — and why naive email
matching breaks on exactly the people who matter most.

---

## ⚠️ Read this before trusting the numbers

**I cannot see the pct.com side.** `vcard_employees` and `mailchimp_audience_id`
do not exist in the TD Hub database, and there is no pct.com connection string,
credential, or client anywhere in this codebase — I checked every schema, every
table name matching `vcard|employee|mailchimp|audience|subscriber`, and every
column matching `mailchimp|audience`. All returned nothing.

So this document is built from:

- **Measured, verifiable:** everything on the TD Hub side — rep roster, order
  volume, listing-agent counts, emails, house accounts. All queried from prod.
- **Taken from the ticket, NOT verified by me:** Team Meza → Jorge Mesa's TMG
  audience; Angeline Wu is Angeline Ahn / `awu@pct.com`; Nicholas Watt is
  `nwatt@pct.com`; Kevin Green has no marketing row.
- **Assumed, needs checking:** that the remaining `@pct.com` reps have a
  `vcard_employees` row *with* a populated `mailchimp_audience_id`.

That last assumption is doing real work in the coverage number. §6 lists exactly
what to check to convert it into a fact.

---

## 1. Why naive email matching fails

46 reps opened **6,286 orders** in the last 12 months. Matching
`contacts.email` to `vcard_employees.email` fails or misleads on:

| Rep | TD email | Marketing identity | Orders (12mo) | % of volume |
|---|---|---|---|---|
| **Angeline Wu** | `aahn@angelineahn.com` | Angeline **Ahn** / `awu@pct.com` | **815** | 13.0% |
| **Team Meza** | `teammeza@pct.com` | **Jorge Mesa**'s TMG audience | **750** | 11.9% |
| **Kevin Green** | `kgreen@pct.com` | *no marketing row* | **350** | 5.6% |
| **Ventura House Account** | `ventura1@pct.com` | must map to **nothing** | 229 | 3.6% |
| **Orange County House Account** | *(no email)* | must map to **nothing** | 192 | 3.1% |
| **Glendale House Account** | *(no email)* | must map to **nothing** | 165 | 2.6% |
| **Nicholas Watt** | `nick@joinnickwatt.com` | `nwatt@pct.com` | 138 | 2.2% |

**2,639 orders — 42.0% of all volume — are wrong or absent under email-only
matching.** Not an edge case: the #1 and #2 reps are both in this table.

Two failure shapes, and they are not symmetric:

- **Silent miss** (Angeline, Nicholas): different domain entirely → no match →
  those agents never reach an audience. Quiet, and the highest-volume rep is
  affected.
- **Silent mis-route** (Team Meza): a team alias that *would* match a
  `teammeza@` row if one existed, but belongs to Jorge Mesa's audience. Worse
  than a miss — subscribers land somewhere plausible but wrong.

There is also a name/email tripwire worth flagging: **Dan Culnane** is
`kculnane@pct.com`. A matcher that falls back to first-initial+surname would
match him to a "K. Culnane" that may or may not be the same person.

## 2. Proposed bridge table

On **pct.com**, next to the marketing roster it resolves against.

```sql
marketing_rep_audience (
  id                    serial primary key,
  td_rep_identity       text not null unique,   -- 'contact:22117' — stable, survives email changes
  td_rep_email          text,                   -- recorded for humans, NOT the matcher
  td_rep_name           text,
  mailchimp_audience_id text,                   -- NULL = deliberately no audience
  mapping_kind          text not null,          -- 'explicit' | 'house_account' | 'no_audience'
  note                  text,                   -- why this row exists
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
)
```

`td_rep_identity` is the TD Hub **contact id**, not the email. Angeline is the
argument: her address is a personal domain that could change tomorrow, while her
contact id is stable. Emails are recorded for humans to read, never matched on.

**A NULL `mailchimp_audience_id` with `mapping_kind='house_account'` is a
decision, not a gap.** That distinction is the point of `mapping_kind` — it
separates "we decided this routes nowhere" from "nobody has looked at this yet",
which otherwise look identical and get "fixed" by someone helpful.

### Precedence — strict, and it never guesses

```
1. EXPLICIT   bridge row for td_rep_identity
                 → audience_id, or NULL for house/no-audience (terminal)
2. EMAIL      exact, case-insensitive match on vcard_employees.email
                 → that row's mailchimp_audience_id
3. UNMAPPED   return rep_unmapped. Do not fuzzy-match, do not fall back to
              name similarity, do not pick a default audience.
```

Rule 3 is the load-bearing one. The cost of a miss is one agent not receiving
marketing; the cost of a wrong guess is a client's contact landing in a
competitor-colleague's list. Those are not comparable, so the tie always breaks
toward doing nothing. `rep_unmapped` is designed to be **visible** — it is the
roster-hygiene backlog, not an error to suppress.

## 3. The actual mapping

Ordered by TD volume. "Agents" = distinct listing-agent emails routed through
that rep in 12 months (844 rep-agent pairs total).

### 3a. Needs an EXPLICIT row (email match fails or misleads)

| Rep | Orders | Agents | Maps to | Why |
|---|---|---|---|---|
| Angeline Wu | 815 | 44 | `awu@pct.com`'s audience | personal domain in TD |
| Team Meza | 750 | 120 | **Jorge Mesa / TMG** | team alias → individual |
| Nicholas Watt | 138 | 25 | `nwatt@pct.com`'s audience | personal domain in TD |
| Jorge Mesa | 4 | 1 | **same TMG audience** | must not be a second list |

Note Jorge Mesa exists *separately* in TD with 4 orders. Both he and Team Meza
must resolve to one audience, or TMG's list is split in two.

### 3b. Must map to NOTHING (house accounts)

| Rep | Orders | Agents |
|---|---|---|
| Ventura House Account | 229 | 26 |
| Orange County House Account | 192 | 17 |
| Glendale House Account | 165 | 14 |
| **Total** | **586 (9.3%)** | **57** |

Unassigned-desk buckets, not people. Two have no email at all, so they cannot
match by rule 2 — but they still need explicit `house_account` rows so they read
as *decided* rather than *missed*.

### 3c. No audience exists

| Rep | Orders | Agents | Note |
|---|---|---|---|
| Kevin Green | 350 (5.6%) | 17 | no marketing row (per ticket) |

`skipped_no_audience`, not `rep_unmapped` — we know who he is; he has no list.
Either create one or accept 17 agents going nowhere. **A decision, not a bug.**

### 3d. Shared team mailboxes — DECISION NEEDED

| Rep | Orders | Agents | Question |
|---|---|---|---|
| **Lopez Team** | 515 | **145** | own audience, or an individual's? |
| Title Team | 171 | 34 | is this a marketing entity at all? |
| Title Gals | 12 | 5 | same |

**Lopez Team owns the single largest agent pool in the company — 145 distinct
listing agents, more than Team Meza's 120.** The ticket named Team Meza as the
alias case but not these. They have the same shape: a shared `@pct.com` mailbox
that may or may not correspond to a marketing audience. Left `rep_unmapped` by
default, because guessing here would misroute 184 agents.

### 3e. Excluded — test / non-marketing

| Rep | Orders | Note |
|---|---|---|
| Aashima Narang | 4 | `@yopmail.com` — disposable test domain |
| Gerardo Hernandez | 2 | internal |

### 3f. Expected to resolve by email match (rule 2)

The remaining **34 reps** — Sandra Millar, Sonia Flores, David Gomez, Simon Wu,
Justin Nouri, Corey Velasquez, Linda Ruiz, Michael Nouri, Richard Bohn, Laurie
Briggs, Veronica Sanchez, Mark Neveu, Jane Phan, Neil Torquato, Christy Coffey,
Kevin Cameron, Dan Culnane, Louis Morreale, Tony Baumgartner, Zaccaria Ackad,
Chuck Cota, Nini Kerns, Ronnie Castillo, Maria Basilio, Rouanne Garcia, Janelly
Marquez, Saeed Ghaffari, Nelson Torres, Felicia Pantoja, Jennifer Simms, David
Ortiz, Jesse Lopez, Vito D'Alessandro, Sandra Millar — all `@pct.com`, all
expected to match on email.

**Expected, not verified** — this is the §6 assumption. Dan Culnane
(`kculnane@pct.com`) is the one to check first.

## 4. Coverage

By **rep-agent pairs** (844 total — the thing that actually gets subscribed):

| Bucket | Pairs | % |
|---|---|---|
| ✅ Resolve by email (34 reps, assumed) | 397 | 47.0% |
| ✅ Resolve via explicit row (Angeline, Team Meza, N. Watt, J. Mesa) | 190 | 22.5% |
| **Routable subtotal** | **587** | **69.6%** |
| ⚪ House accounts — deliberately nothing | 57 | 6.8% |
| ⚪ Kevin Green — no audience | 17 | 2.0% |
| 🟡 Team mailboxes — decision pending | 184 | 21.8% |
| ⚪ Test/internal | 2 | 0.2% |

### **Coverage: 69.6% of listing agents route to an audience today.**

- **91.4%** if the three team mailboxes get audiences (§3d) — the single
  highest-leverage decision available.
- **93.4%** if Kevin Green also gets one.
- The remaining 6.6% is house accounts, which is correct behaviour, not a gap.

Without the bridge table — email matching alone — routable drops to **47.0%**,
and 22.5% of pairs would either silently vanish or land in the wrong list.
**The bridge table is worth 22.5 points of coverage and eliminates the
mis-routing class entirely.**

## 5. Reps needing a roster fix

Ranked by what it unlocks:

1. **Lopez Team** (145 agents) — decide entity, then audience or exclusion.
2. **Team Meza / Jorge Mesa** (121 combined) — confirm one shared TMG audience.
3. **Angeline Wu** (44) — confirm `awu@pct.com` is the marketing row.
4. **Title Team** (34) — marketing entity or not?
5. **Nicholas Watt** (25) — confirm `nwatt@pct.com`.
6. **Kevin Green** (17) — create an audience, or accept the skip.
7. **Title Gals** (5) — as Title Team.

## 6. To turn assumptions into facts

Run against pct.com, which I could not reach:

```sql
-- 1. Which of the 34 email-match reps actually have an audience?
SELECT email, mailchimp_audience_id
  FROM vcard_employees
 WHERE lower(email) IN ( … the 34 @pct.com addresses … );
-- Any NULL audience_id = skipped_no_audience, not a match.

-- 2. Do the named identities exist?
SELECT email, mailchimp_audience_id FROM vcard_employees
 WHERE lower(email) IN ('awu@pct.com','nwatt@pct.com','jmesa@pct.com','kgreen@pct.com');

-- 3. Do the team mailboxes exist as marketing entities?
SELECT email, mailchimp_audience_id FROM vcard_employees
 WHERE lower(email) IN ('teamlopez@pct.com','titleteam@pct.com','titlegals@pct.com','teammeza@pct.com');
```

Result 1 is the one that moves the 69.6% number. Every `@pct.com` rep without a
populated `mailchimp_audience_id` shifts pairs out of "routable" and into
`skipped_no_audience` — so the real figure is **at most** 69.6%, and could be
materially lower. I would not quote it externally until that query has run.
