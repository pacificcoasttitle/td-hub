# Marketing bridge — identity mapping

**Status:** measured against the confirmed pct.com roster (Aug 10). No code, no schema.
**Companion:** [marketing-bridge-design.md](./marketing-bridge-design.md)

How a TD Hub sales rep resolves to a Mailchimp audience.

---

## 1. Headline

| | Rep-agent pairs | Order volume |
|---|---|---|
| **Routable (nominal)** | **741 / 844 = 87.8%** | **5,134 / 6,286 = 81.7%** |
| **Realistic band** | **50.4% – 85.8%** | see §5 |

**The 87.8% is an upper bound that cannot be reached.** 372 of those pairs rest
on reps *assumed* to match by email, and the roster arithmetic in §5 proves at
least 12 of them have no marketing record at all. The honest number is a band,
and every point of it is below the headline.

## 2. Confirmed roster (Aug 10)

34 active sales records — **23 with a Mailchimp audience, 11 without**.

> **Readiness query correction, worth keeping.** `COUNT(mailchimp_audience_id)`
> counts empty strings as present, so it overstates readiness. Use:
> ```sql
> COUNT(*) FILTER (WHERE NULLIF(TRIM(mailchimp_audience_id), '') IS NOT NULL)
> ```
> Any future roster-health check should use this form. The same trap applies to
> our side — `contacts.email` has the same empty-string-vs-NULL ambiguity.

## 3. Classification of all 46 active TD reps

Measured over 12 months: 6,286 orders, 844 rep-agent pairs.

| Bucket | Reps | Orders | % vol | Pairs | % pairs |
|---|---|---|---|---|---|
| ✅ `routable_explicit` | 6 | 2,393 | 38.1% | 369 | 43.7% |
| ⚠️ `routable_email_assumed` | 30 | 2,741 | 43.6% | 372 | 44.1% |
| ⚪ `skipped_no_audience` | 5 | 503 | 8.0% | 41 | 4.9% |
| 🔴 `blocked` | 1 | 12 | 0.2% | 5 | 0.6% |
| ⚪ `rep_unmapped` | 1 | 51 | 0.8% | 0 | 0.0% |
| ⛔ `denylisted` | 3 | 586 | 9.3% | 57 | 6.8% |

### 3a. Explicit bridge rows — confirmed audiences

| TD rep | Marketing identity | Audience | Orders | Pairs |
|---|---|---|---|---|
| Angeline Wu | Angeline Ahn (`awu@pct.com`) | `51b5235061` | 815 | 44 |
| Team Meza | Jorge Mesa (TMG) | `545f3afd67` | 750 | 120 |
| **Lopez Team** | **Hugo Lopez** (`teamlopez@pct.com`) | `cea2911e34` | 515 | **145** |
| Title Team | Nicole Ahn (`titleteam@pct.com`) | `ce54190039` | 171 | 34 |
| Nicholas Watt | Nick Watt (`nwatt@pct.com`) | `2cc3f87657` | 138 | 25 |
| Jorge Mesa | Jorge Mesa (TMG) | `545f3afd67` | 4 | 1 |

**Alias convergence:** Team Meza and Jorge Mesa resolve to the *same*
`545f3afd67`. Two bridge rows, one audience. The audience id must never be
copied onto members as an attribute — it is the destination, not a property of
the subscriber, or the convergence turns into a duplicate list on the next edit.

The team mailboxes were the open question in the previous revision and they all
resolved — **Lopez Team alone is 145 pairs, the largest single pool in the
company.** That is the bulk of the jump from 69.6% to 87.8%.

### 3b. Blocked — distinct from unmapped

| TD rep | Audience | Orders | Pairs |
|---|---|---|---|
| Title Gals | `0cae582d6c` — owner **Janelly Marquez, INACTIVE** | 12 | 5 |

An audience exists, so this is not `rep_unmapped`; but its owner is inactive, so
ingesting would file subscribers under someone who has left. **`blocked` is its
own terminal result** — it must not be silently retried, and it must not be
"helpfully" resolved by matching to the nearest active person.

### 3c. `skipped_no_audience` — active record, no audience

Of the 11 named, only **5 have any TD order volume**:

| Rep | Orders | Pairs |
|---|---|---|
| Kevin Green | 350 | 17 |
| Laurie Briggs | 92 | 14 |
| Jane Phan | 58 | 9 |
| Jesse Lopez | 1 | 1 |
| Gerardo Hernandez *(= "Jerry Hernandez"?)* | 2 | 0 |
| **Total** | **503** | **41** |

The other six — Al Alfonso, Anthony Zamora, Edgar Rivas, Izzy Lopez, Justin
Dominguez, Michael Caballero — have **zero TD orders in 12 months**. Giving them
audiences unlocks nothing today. That materially shrinks the "11 reps need
audiences" ask; see §6.

⚠️ **`Jerry Hernandez` vs TD's `Gerardo Hernandez`** is a probable same-person
match I have *not* confirmed. It is worth 0 pairs, so it changes no number —
but it is the same class of trap as Culnane and should be settled by a human,
not inferred.

**These must never count as success.** `skipped_no_audience` means "we know who
this is, they have no list" — a roster fact, not a delivery.

### 3d. `rep_unmapped` — and the case that proves the rule

**Dan Culnane** (51 orders) has **no vcard record**. HR confirms his address is
`dculnane@pct.com`.

> **`kculnane@pct.com` is KATIE Culnane — a different person.**

TD Hub stores Dan's contact email as `kculnane@pct.com`. So a matcher with *any*
fuzzy or first-initial fallback would have matched Dan Culnane to Katie
Culnane's record and **subscribed Dan's listing agents into Katie's audience** —
silently, with a plausible-looking match and no error anywhere.

This is the concrete justification for precedence terminating at
`rep_unmapped`. The cost of stopping is 0 pairs unrouted. The cost of guessing
is a rep's client relationships appearing in a colleague's marketing list.
**Never fuzzy-match. Never fall back to initials. Never pick a default
audience.**

### 3e. `denylisted` — house accounts

| Account | Orders | Pairs |
|---|---|---|
| Ventura House Account | 229 | 26 |
| Orange County House Account | 192 | 17 |
| Glendale House Account | 165 | 14 |
| **Total** | **586 (9.3%)** | **57 (6.8%)** |

**Explicitly denylisted, not left to fail roster matching.** Two have no email
at all, so they would fail to match anyway — but "fails to match" and "must
never be ingested" are different states, and relying on the accident of a
missing email is not a control. A denylist entry survives someone helpfully
adding `ventura1@pct.com` to the roster.

## 4. Bridge table — seed rows

```sql
-- mapping_kind: explicit | blocked | house_account | no_audience
INSERT INTO marketing_rep_audience
  (td_rep_identity, td_rep_email, td_rep_name, mailchimp_audience_id, mapping_kind, note) VALUES
 ('contact:22117','aahn@angelineahn.com','Angeline Wu','51b5235061','explicit','Angeline Ahn; TD holds a personal domain'),
 ('contact:<meza>','teammeza@pct.com','Team Meza','545f3afd67','explicit','Jorge Mesa / TMG — converges with Jorge Mesa row'),
 ('contact:<jmesa>','jmesa@pct.com','Jorge Mesa','545f3afd67','explicit','same TMG audience as Team Meza — do NOT split'),
 ('contact:<lopez>','teamlopez@pct.com','Lopez Team','cea2911e34','explicit','Hugo Lopez'),
 ('contact:<ttm>','titleteam@pct.com','Title Team','ce54190039','explicit','Nicole Ahn'),
 ('contact:<nwatt>','nick@joinnickwatt.com','Nicholas Watt','2cc3f87657','explicit','Nick Watt; TD holds a personal domain'),
 ('contact:<tgals>','titlegals@pct.com','Title Gals',NULL,'blocked','audience 0cae582d6c owned by INACTIVE Janelly Marquez'),
 ('contact:<ventura>','ventura1@pct.com','Ventura House Account',NULL,'house_account','unassigned desk — never ingest'),
 ('contact:<oc>',NULL,'Orange County House Account',NULL,'house_account','unassigned desk — never ingest'),
 ('contact:<glendale>',NULL,'Glendale House Account',NULL,'house_account','unassigned desk — never ingest');
```

Keyed on TD **contact id**, never email — Angeline and Nicholas both hold
personal domains that can change, and Dan Culnane's email points at a different
human entirely.

`mapping_kind` distinguishes *decided* from *unexamined*: a NULL audience with
`house_account` is a policy, a NULL with no row is a backlog item. Without that
column they are indistinguishable and someone eventually "fixes" the policy.

## 5. Why the headline is a band, not a number

The 372 assumed pairs are bounded by roster arithmetic:

```
  34  active pct.com records
-  5  consumed by the explicit mappings
       (Angeline Ahn, Jorge Mesa, Hugo Lopez, Nicole Ahn, Nick Watt)
- 11  active records with NO audience
= 18  records left to cover 30 assumed-routable TD reps
```

**At least 12 of the 30 have no marketing record and will return
`rep_unmapped`.** Dan Culnane already proves the pattern exists.

Which 12 decides the answer, and the spread is enormous:

| If the 12 unrecorded reps are… | Pairs lost | Coverage |
|---|---|---|
| the smallest | 17 | **85.8%** |
| the largest | 316 | **50.4%** |

Most exposed, by pairs: **Simon Wu (57), Richard Bohn (43), David Gomez (42),
Sonia Flores (35), Corey Velasquez (34)**, then Christy Coffey (21), Michael
Nouri (19), Veronica Sanchez (15), Rouanne Garcia (15), Linda Ruiz (13), Mark
Neveu (12), Justin Nouri (10).

**One query settles it** — for the 30 names, return `email, mailchimp_audience_id`
from `vcard_employees`, using the `NULLIF(TRIM(...))` form from §2. Every miss
is a `rep_unmapped` row; every present-but-empty is `skipped_no_audience`.

## 6. Roster-hygiene upside — the business ask

**Assigning audiences to the 11 no-audience reps: +4.9 points of pairs
(41), +8.0 points of order volume (503). Coverage 87.8% → 92.7%.**

Dominated by three people — Kevin Green (17), Laurie Briggs (14), Jane Phan (9)
— which is 40 of the 41 pairs. **Six of the eleven have zero TD volume**, so the
ask is really "give audiences to Kevin Green, Laurie Briggs and Jane Phan".

Unblocking Title Gals (an active owner for `0cae582d6c`) adds 5 more → **93.2%**.

### But the bigger prize is the missing records

| Fix | Pairs unlocked | Points |
|---|---|---|
| Audiences for the 11 no-audience reps | 41 | +4.9 |
| **Records + audiences for the ≥12 unrecorded reps** | **up to 316** | **up to +37.4** |

**The missing-record gap is worth up to 7× the named ask.** 46 active TD reps
against 34 active marketing records is the headline hygiene problem; the 11
without audiences is the smaller, more visible one.

Recommended order:
1. **Run the §5 query** — converts the 50.4–85.8% band into a number and names
   the missing records. Costs one query and is a precondition for the rest.
2. **Create records + audiences for whichever of Simon Wu, Richard Bohn, David
   Gomez, Sonia Flores, Corey Velasquez are missing** — the top five are 211
   pairs on their own.
3. **Audiences for Kevin Green, Laurie Briggs, Jane Phan** — +40 pairs.
4. **Resolve Title Gals ownership** — +5, and clears a blocked state.
5. **Confirm Jerry Hernandez = Gerardo Hernandez, and Dan Culnane's record** —
   0 pairs today, but both are identity traps that will bite later.
