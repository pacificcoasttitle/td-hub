# Spike: can transaction data support a "referral-source book"?

**Aug 3, 2026 · read-only investigation against production · no schema, no code, no writes**

**Question:** for a given sales rep, can we group the non-client parties on their orders — escrow officer, lender, other-side parties — into statements like *"escrow officer X sent you N orders across M distinct clients"*, cleanly enough to show a rep without eroding trust?

**Short answer:** the escrow framing is **not supportable** — not because of data quality, but because the escrow party *is* the client 98.7% of the time, so the statement is circular. The **lender** framing **is** supportable and produces genuinely useful output, after a normalization pass. And the order→rep attribution that the wider observation set depends on is **clean — 95.4%**, which is the strongest finding here.

---

## 1. Population / coverage

`orders` total: **6,601**

### Normalized FK columns on `orders`
| Column | Populated | % |
|---|---:|---:|
| `sales_rep_id` | 6,401 | **97.0%** |
| `title_officer_id` | 6,344 | 96.1% |
| `client_contact_id` | 5,711 | 86.5% |
| `escrow_officer_id` | 3,745 | 56.7% |
| `listing_agent_id` | 1,034 | 15.7% |
| `lender_id` | 491 | **7.4%** |

```sql
select count(*) filter (where sales_rep_id is not null), … from orders;
```

### `order_parties` by role — FK vs free-text
| Role | Rows | With `contact_id` | Free-text only | Neither | Orders covered |
|---|---:|---:|---:|---:|---:|
| `other` | 11,090 | **0** | 5,501 | 5,589 | 5,562 (84.3%) |
| `escrow_company` | 5,280 | 5,047 (95.6%) | 216 | 17 | 5,280 (80.0%) |
| `buyer` | 4,954 | 0 | 4,954 | 0 | 3,505 (53.1%) |
| `lender` | 3,016 | 482 (16%) | 89 | 2,445* | 3,016 (45.7%) |
| `seller` | 3,076 | 0 | 3,076 | 0 | 2,067 (31.3%) |
| `listing_agent` | 1,799 | 1,021 (57%) | 646 | 132 | 1,799 (27.3%) |
| `lender_contact` | 1,370 | 714 (52%) | 304 | 352 | 1,367 (20.7%) |

\* **Not actually empty.** 3,012 of 3,016 lender rows carry `external_company` — lenders are captured as a **company**, not a person. Only 571 have a person name.

### Two roles are traps
- **`other` (84% coverage) is PCT's own internal staff.** Top values: *Clive Virata / Pacific Coast Title Company* (760), *Eddie LasMarias* (759), *Rachel Barcena* (684), *Team Meza* (278), *Lopez Team* (170). This is internal routing, not referral sources. The highest-coverage role on the table is useless for this feature.
- **`buyer` / `seller` are 100% free-text consumers** — one-time parties, correctly excluded.

---

## 2. Normalization / dedupe quality

### Escrow (the apparent strong candidate)
5,047 party rows resolve to **909 distinct `contact_id`s**. On the surface that's excellent — 95.6% FK'd, no free-text problem. Underneath:

| Property | Count | % of 909 |
|---|---:|---:|
| Has a company name | 424 | 46.6% |
| Has a person name | **12** | **1.3%** |
| Has **neither** (email only) | **483** | **53.1%** |
| Has an email | 908 | 99.9% |
| Flagged `is_escrow_officer` | 686 | 75.5% |

**Over half of these contacts have no displayable name.** Weighted by volume it is barely better: **52.5% of rep/source pairs have no name, covering 47.4% of attributed orders.** A rep would be shown *"teambohe@greenforestescrow.net sent you 81 orders"*.

**Duplicate entities.** Among the 426 that do have a name, 909 ids collapse to ~327 normalized entities. Worst cases:

| Contact ids | Orders | Spellings |
|---:|---:|---|
| 7 | 80 | Escrow Options Group |
| 3 | 106 | Corner Escrow |
| 3 | 72 | Power House Escrow \| Powerhouse Escrow |
| 2 | 53 | Victoria Financial Corp. \| Victoria Financial Corp.. |
| 6 | 47 | Central Escrow Group, Inc |
| 5 | — | Glen Oaks Escrow \| Glenoaks Escrow |
| 3 | — | Foundation Escrow \| FOUNDATION ESCROW |

**A live failure, caught in a worked example** — Sandra Millar's list shows Shalimar twice:

| id | Orders | Company | Email |
|---|---:|---|---|
| 8366 | 66 | Shalimar Escrow | Melanie.Rountree@shalimar-escrow.com |
| 8365 | 7 | *(blank)* | **Melanie.Rountree@shalimar-escrow.com** |
| 12482 | 1 | *(blank)* | jason.sherrill@shalimar-escrow.com |

Two contact ids with a **byte-identical email**, splitting one relationship 66/7. Email alone would merge these — this is not a hard dedupe problem, it is an unaddressed one.

### Lender (free-text company)
1,037 distinct raw values → **809 normalized** (22% redundant). Visible variance is mild and mechanical: `OCMBC, Inc.` (64) vs `OCMBC, Inc` (27); trailing punctuation; casing. A trim + punctuation-strip + case-fold pass handles most of it. No evidence of the "J. Smith / Smith, Jane" person-name chaos that would kill the feature — because these are **company** names, which are far more stable.

---

## 3. Worked examples

### 3a. Escrow framing — circular, do not ship

```
Angeline Wu (824 orders)          orders  clients
  (no name — paul@escrowforum.com)    96        1
  Escrow Options Group                57        3
  (no name — ae@annexescrow.com)      57        1
  The Escrow Forum                    53        1

Team Meza (780 orders)            orders  clients
  (no name — teambohe@greenforestescrow.net)  81   2
  (no name — Ada@visionescrowgroup.com)       47   1
  (no name — AChacon@premescrow.com)          34   1
  (no name — ginaj@marinaescrow.com)          25   1

Sandra Millar (517 orders)        orders  clients
  Corner Escrow                       90        1
  Shalimar Escrow                     66        1
  (no name — angela@lighthouseescrow.com)     42   1
  ...
  (no name — Melanie.Rountree@shalimar-escrow.com)  7   1   ← same firm as row 2
```

Two things are visibly wrong. Five of Team Meza's top six render as an **email address**. And the client count is almost always **1**, which led to the decisive check:

> **The escrow party is the same contact as `client_contact_id` on 4,980 of 5,047 rows — 98.7%.**

For a title company the escrow company *is* the customer. So *"escrow officer X sent you 96 orders across 1 distinct client"* is really *"your client sent you 96 orders, and that client is themselves."* The "across M clients" dimension carries no information. This is not a data-quality problem that cleanup fixes — **the relationship being described does not exist in this direction.**

(`listing_agent` is partially circular too: 464 of 1,021 FK rows equal the client.)

### 3b. Lender framing — this one works

```
Angeline Wu (824 orders)                orders  clients
  United Wholesale Mortgage, LLC            24       13
  Victoria Financial Corp                   21        4
  Coast 2 Coast Funding Group, Inc          18        4
  NMSI, Inc                                 15        2
  Bank of Hope                              12        1

Team Meza (780 orders)                  orders  clients
  United Wholesale Mortgage, LLC            24       18
  OCMBC, Inc                                16        9
  Kings Mortgage Services, Inc              15       11
  Royal Pacific Funding Corp                 9        8
  Rocket Mortgage, LLC                       9        8

Lopez Team (548 orders)                 orders  clients
  United Wholesale Mortgage, LLC            15       13
  Rocket Mortgage, LLC                      10        9
  Kings Mortgage Services, Inc               8        7
  OCMBC, Inc                                 7        4
  SchoolsFirst Federal Credit Union          6        5
```

*"United Wholesale Mortgage appeared on 24 of your orders, across 18 different clients"* is a true, non-circular, useful statement. Coverage: **46.8% of attributed orders carry a named lender company** (2,995 of 6,401).

Caveat: on the small FK path (482 rows) 193 are circular with the client. The free-text company path — which is 3,012 rows — is the one to use.

---

## 4. Order → rep attribution (the data-trust gate)

**This is clean.**

| State | Orders | % |
|---|---:|---:|
| Attributed to an **active** sales rep | 6,296 | **95.4%** |
| Attributed to an **inactive** rep | 105 | 1.6% |
| Blank | 200 | 3.0% |
| Dangling FK (points at nothing) | **0** | 0.0% |
| Points at a contact not flagged as a rep | **0** | 0.0% |

Stable over time: 3.0% blank in 2026, 3.5% in 2025. 45 distinct reps carry orders; 41 active, 4 stale.

**Verdict for the wider observation set: green.** Statements of the form *"you have N orders"*, *"12 orders but only 4 attributed to you"*, and period-over-period comparisons rest on a field that is populated 97% of the time, never dangling, and never mis-typed. The 1.6% attributed to departed reps is the only nuance — worth a decision about whether their orders roll to a successor, but it does not undermine the numbers.

---

## 5. Verdict

### Safe to ship on this data as-is
- **Order counts and recency per client** — attribution is 95.4% clean, `opened_at`/`closedAt` are reliable. This is what the shipped My Clients "business" section already uses.
- **Attribution-share observations** ("N orders, M attributed to you") — the field supports it.
- **Lender-company referral counts**, *if* presented as companies: *"UWM appeared on 24 of your orders across 18 clients."* Needs the light normalization in §2 first.

### Needs a normalization / identity layer first
- **Lender aggregation** — trim, strip trailing punctuation, case-fold. 1,037 → ~809. A few hours, mechanical, low risk.
- **Escrow entity dedupe** — merge on email first (the Shalimar case is exact-match), then normalized name. Worth doing regardless of this feature, because it also affects the CRM's contact suggestions and any future reporting.
- **Escrow display names** — 53% of these contacts have no name at all. Backfilling from the email local-part/domain, or from SoftPro, is a prerequisite for showing them to anyone.

### Not supportable
- **"Escrow officer X sent you N orders across M clients."** The escrow party is the client 98.7% of the time. No amount of cleanup fixes a circular statement. If the intent is *"which escrow firms give me the most business"*, that is already answered by the existing client list — it is the same question.
- **"Loan officer sent you…"** at the person level. Only 571 of 3,016 lender rows carry a person name, and `lender_contact` covers 20.7% of orders. Company level works; person level does not.
- **Anything built on the `other` role** — it is PCT's own staff.

### Recommendation
Do not build the referral-source book as scoped. **Build the lender-company variant instead** — it is the one genuinely third-party relationship in this data, it produces true multi-client statements, and it needs only a mechanical normalization pass. Ship the escrow dedupe separately as data hygiene, not as a feature.

---

## Appendix — raw queries
All queries were read-only `SELECT`s against production. The load-bearing ones:

```sql
-- coverage
select count(*) filter (where escrow_officer_id is not null), … from orders;
select role, count(*), count(*) filter (where contact_id is not null) from order_parties group by role;

-- circularity (the decisive check)
select count(*), count(*) filter (where o.client_contact_id = p.contact_id)
from orders o join order_parties p
  on p.order_id = o.id and p.role = 'escrow_company' and p.contact_id is not null;

-- naming gap
select count(*) filter (where nullif(trim(coalesce(c.company_name, c.full_name)),'') is null)
from (select distinct contact_id id from order_parties
      where role='escrow_company' and contact_id is not null) u
join contacts c on c.id = u.id;

-- attribution
select count(*) filter (where o.sales_rep_id is null),
       count(*) filter (where c.is_sales_rep and c.is_active),
       count(*) filter (where c.is_sales_rep and not c.is_active)
from orders o left join contacts c on c.id = o.sales_rep_id;
```
