# 1,101 orders resolve to a null prelim recipient — most are a data gap

**Status:** diagnosis only, nothing implemented. Read-only measurement of
`resolvePrelimRecipients` against production on 27 Aug 2026. Do not build. Do
not change recipient resolution. Do not send email. Do not run jobs.

**Split this number before anyone acts on it.** Gerard confirmed 2026-08-28
that SoftPro file-copies produce permanent shells (no property, no officers,
no parties). Re-measured the no-path bucket the same day (no escrow officer
and no `escrow_company` party — 1,084 orders): **263 are shells** (no street
and no city), **821 have an address**. Live: 104 shells, 596 with an address.
A shell will never have a prelim recipient because there is nothing on the
file. Acting on 1,093 as one population mixes copies with real orders that
are missing an officer. See `SOFTPRO_ADDDOCUMENTS_REQUIRED_FIELDS.md` §2.

**The headline:** of 8,044 orders, **1,101 (13.7%) resolve `to: null`**. 1,086
have no escrow officer and no `escrow_company` party (no delivery path at all);
15 have a company party with a name and no email; **0** have an officer FK
pointing at a missing or invalid contact. The owner's 1,093 / 8,036 (1,078 +
15) is the same split, eight orders earlier — the eight new rows all landed in
the no-path bucket.

The data can tell gap from legitimate. **647 live Purchase / Refinance files
(59% of the 1,101) are a data gap** — they are the product that already
receives a prelim on 82% of live Title-only files, so the 18% that don't are
missing an officer or an outside escrow company, not a population that never
gets one. **159 Trustee Sale Guarantee files (14%) are the legitimate
never-gets-one population** — 100% miss, every one a `99xxxxxxx` file with no
branch suffix. The remaining ~300 are canceled, duplicate, null-type closed
files, and old terminal Purchase / Refinance.

That is the answer to the question that was asked. Nothing below licenses a
resolver change.

---

## 1. The resolver, as coded on `origin/main`

`src/lib/domain/notifications/prelim-recipient-resolution.ts` at
`ea6fb9bbb90a165c41da1a4162cf7c0c4d5f2b96`. TO is a single address, in this
order, and the company fallback is **not** tried when an officer FK is set:

```139:178:src/lib/domain/notifications/prelim-recipient-resolution.ts
  if (order.escrowOfficerId) {
    const escrowOfficer = await getContactRecipient(order.escrowOfficerId);
    if (isValidEmail(escrowOfficer?.email)) {
      to = {
        email: normalizeEmail(escrowOfficer.email),
        name: escrowOfficer.fullName,
        role: 'escrow_officer',
      };
    } else {
      warnings.push(invalidEmailWarning('escrow_officer', escrowOfficer?.email, 'primary'));
    }
  } else {
    const escrowParty = await getEscrowCompanyParty(orderId);
    // external_email if valid, else joined contacts.email
    // ...
  }

  if (!to) {
    return {
      to: null,
      cc: [],
      warnings,
      blocked: true,
      blockReason: 'No valid primary prelim recipient resolved',
    };
  }
```

Validity is `email.trim()` against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. SQL below
uses the POSIX equivalent on `btrim(email)`. Zero orders have more than one
`escrow_company` row, so "first party" is unambiguous.

This measurement classifies every row in `orders`. It does not call the
TypeScript function per order. A CC-only address (sales rep, ad-hoc) never
saves a blocked send — `to` is what auto-delivery requires.

---

## 2. The three-way split

| Bucket | Orders | Share of book |
| --- | --- | --- |
| Resolved via `escrow_officer_id` → valid `contacts.email` | 3,894 | 48.4% |
| Resolved via `escrow_company.external_email` | 3,049 | 37.9% |
| Resolved via `escrow_company` joined `contacts.email` | 0 | — |
| **`to: null` — no officer AND no `escrow_company` party** | **1,086** | **13.5%** |
| **`to: null` — company party, no valid email** | **15** | **0.2%** |
| `to: null` — officer set, contact missing or email invalid | 0 | — |
| Book | 8,044 | 100% |

The 15 are not malformed addresses. Every one has an `external_company` name
(Craft Escrow, First Priority Escrow, …) and **both** `external_email` and
joined `contacts.email` are NULL. Five of the 15 are still `in_process`.

---

## 3. Order type

`orders.transaction_type`, with `orders.order_type` underneath where it splits
the question.

| `transaction_type` | Book | Null TO | Null rate | No-path |
| --- | --- | --- | --- | --- |
| Refinance | 3,828 | 201 | 5.3% | 196 |
| Purchase | 3,813 | 572 | 15.0% | 563 |
| *(null)* | 238 | 167 | 70.2% | 167 |
| Other | 165 | 161 | 97.6% | 160 |

| `order_type` | Book | Null TO | Live | Live null | Live Purchase/Refinance null |
| --- | --- | --- | --- | --- | --- |
| Title only | 6,812 | 688 | 3,537 | 622 | **621 / 3,535 (17.6%)** |
| Title & Escrow | 798 | 73 | 530 | 15 | **15 / 528 (2.8%)** |
| *(null)* | 248 | 177 | 27 | 20 | 10 / 10 |
| Trustee Sale Guarantee | 159 | **159** | 53 | **53** | — |
| Escrow only | 26 | 4 | 15 | 1 | 1 / 15 |
| Limited Coverage Product | 1 | 0 | 0 | 0 | — |

**Title-only is not a never-gets-one product.** Of 3,535 live Title-only
Purchase / Refinance files, 923 resolve via officer, 1,991 via company, 621
via nobody. 82% of the same product already have a delivery path. The 18%
that don't are a fill-rate gap on outside escrow, not a product that
legitimately has no recipient.

**Trustee Sale Guarantee is.** 159 / 159. Every file number is `99xxxxxxx`
with no `-GLT` / `-OCT` suffix. SoftPro never attached an officer or an
escrow company, and the numbering system is a different book.

Title & Escrow at 2.8% live-null is the cleanest data-gap residual: we are
the escrow and 15 live files still have no officer.

---

## 4. Age and operational status

`opened_at` is `timestamp without time zone` (SoftPro `ReceivedDate`). Months
below are `to_char(opened_at, 'YYYY-MM')` of that stored value, not a
timezone conversion. Weekly bins around April were checked; the step is
month-level and then flat, so the tables stay monthly.

**Live** = `in_process` + `open` + `hold` (4,162). **Terminal** =
`completed` + `closed` + `canceled` + `duplicate` (3,882).

| `operational_status` | Book | Null TO | Null rate | No-path |
| --- | --- | --- | --- | --- |
| in_process | 4,147 | 707 | 17.0% | 702 |
| completed | 2,338 | 23 | 1.0% | 18 |
| closed | 1,371 | 327 | 23.9% | 324 |
| canceled | 151 | 29 | 19.2% | 28 |
| duplicate | 22 | 11 | 50.0% | 11 |
| hold | 13 | 4 | 30.8% | 3 |
| open | 2 | 0 | 0% | 0 |
| **Live** | **4,162** | **711** | **17.1%** | 705 |
| **Terminal** | **3,882** | **390** | **10.0%** | 381 |

This is not "old closed files we never enriched." 711 of 1,101 nulls are
live. Completed files almost always resolve (1.0%); `closed` is high because
it is where the 292 unsuffixed TSG / null-type files sit (239 of those 292
are `closed`).

| Opened month | Book | Null TO | No-path |
| --- | --- | --- | --- |
| *(null `opened_at`)* | 84 | 37 | 37 |
| 2025-03 … 2026-03 (13 months) | 2,174 | 106 | 100 |
| 2026-04 | 1,261 | 173 | 172 |
| 2026-05 | 1,103 | 167 | 164 |
| 2026-06 | 1,212 | 201 | 200 |
| 2026-07 | 1,131 | 215 | 212 |
| 2026-08 | 1,079 | 202 | 201 |

The April step is real on the population that should get a prelim. Live
Purchase / Refinance with a normal branch suffix:

| Era | Live P/R suffixed | Null TO | Rate |
| --- | --- | --- | --- |
| Opened before 2026-04 | 469 | 14 | 3.0% |
| Opened 2026-04 onward | 3,619 | 633 | **17.5%** |

Title-only live Purchase / Refinance, same cut, by month. April files have
had four months to grow an escrow party and still match August:

| Month | Title-only live P/R | Null | Rate | Title & Escrow live P/R | Null |
| --- | --- | --- | --- | --- | --- |
| 2026-03 | 122 | 6 | 4.9% | 73 | 0 |
| 2026-04 | 539 | 94 | 17.4% | 78 | 5 |
| 2026-05 | 474 | 102 | 21.5% | 62 | 2 |
| 2026-06 | 582 | 118 | 20.3% | 70 | 2 |
| 2026-07 | 751 | 152 | 20.2% | 75 | 3 |
| 2026-08 | 854 | 141 | 16.5% | 111 | 3 |

Not enrichment lag. A ~1-in-5 miss on Title-only files opened from April
onward, stable across five months.

---

## 5. Branch

**Discriminator used: file-number suffix**,
`COALESCE(substring(file_number from '-([A-Za-z]+)$'), '(none)')` — the same
cut as `SOFTPRO_MISSING_BUYER.md`. `orders.branch_id` → `branches.code` exists
but is NULL on 367 of the 1,086 no-path rows, including every unsuffixed
file. `contacts.office_lookup_code` is on the officer, not the order, so it
cannot classify a row that has no officer.

| Suffix | Book | Null TO | Null rate | No-path |
| --- | --- | --- | --- | --- |
| GLT | 4,172 | 336 | 8.1% | 326 |
| OCT | 3,419 | 454 | 13.3% | 449 |
| *(none)* — `99xxxxxxx` | 292 | **292** | **100%** | 292 |
| ONT | 82 | 9 | 11.0% | 9 |
| PRV | 62 | 0 | 0% | 0 |
| CSS | 16 | 9 | 56% | 9 |
| CDF | 1 | 1 | 100% | 1 |

The 292 unsuffixed files are the entire TSG book plus 133 null-type files.
They are not missing a `-OCT` because of a parse error; they were never
numbered that way. OCT's 13.3% vs GLT's 8.1% is a real concentration on
suffixed files, not an artefact of the 99-series.

`branch_id` vs suffix on the 1,086 no-path rows, for anyone who wants the
other column:

| Suffix | `branches.code` | No-path |
| --- | --- | --- |
| OCT | OCT | 416 |
| GLT | GLT | 300 |
| *(none)* | *(null `branch_id`)* | 292 |
| OCT | *(null `branch_id`)* | 33 |
| GLT | *(null `branch_id`)* | 26 |
| CSS | *(null `branch_id`)* | 9 |
| ONT | *(null `branch_id`)* | 6 |
| ONT | ONT | 3 |
| CDF | *(null `branch_id`)* | 1 |

---

## 6. Synced vs hub-created

`orders.source`.

| Source | Book | Null TO | No-path |
| --- | --- | --- | --- |
| `softpro_sync` | 8,036 | 1,095 | 1,080 |
| `manual_entry` | 8 | 6 | 6 |

There is no `web_form` row. The six hub-created misses are all Title-only
Refinances opened on the hub form
(`20018616-GLT`, `20018618-GLT`, `20020403-GLT`, `20020404-GLT`,
`20021376-OCT`, `20021378-GLT`). The two hub-created hits
(`20015757-GLT`, `20015761-GLT`) have an officer FK. This is the same
`escrow_officer_id` drop already ticketed in `CREATE_ORDER_DROPPED_FIELDS.md`;
it is 6 rows and does not move the 1,101.

---

## 7. Mutually exclusive populations

Every one of the 1,101, assigned in this order:

| Population | Orders | Live | Verdict |
| --- | --- | --- | --- |
| A. Trustee Sale Guarantee | 159 | 53 | **Legitimate never-gets-one** |
| B. Other, not TSG | 2 | 1 | too small to care |
| C. Null `transaction_type`, canceled / duplicate | 14 | 0 | **Legitimate** |
| D. Null `transaction_type`, otherwise | 153 | 10 | mostly closed 99-series / CSS; treat as never-gets-one until proven otherwise |
| F. Canceled / duplicate Purchase / Refinance | 26 | 0 | **Legitimate** |
| G. Terminal (`completed` / `closed`) Purchase / Refinance | 100 | 0 | old; 8 of these are the company-no-email 15 |
| **H. Live Purchase / Refinance** | **647** | **647** | **Data gap** |

647 = 642 no-path + 5 company-no-email. All 647 carry a normal
`-GLT` / `-OCT` / `-ONT` / `-PRV` suffix. 616 of the 642 no-path are
`order_type = 'Title only'`; 15 are Title & Escrow; 1 is Escrow only; 10 have
no `order_type`.

Of those 642:

| Signal | Count |
| --- | --- |
| Has any `order_parties` row | 542 |
| Has a `seller` | 282 |
| Has a `buyer` | 61 |
| Has `title_officer_id` | 537 |
| Has `sales_rep_id` | 539 |
| `contacts_empty_confirmed` (latched empty) | 93 |
| OCT / GLT / ONT / PRV | 360 / 279 / 3 / 0 |

Party roles on those 642, when any exist: `other` 439 orders, `listing_agent`
436, `seller` 282, `buyer` 61, `lender_contact` 66, `lender` 30. SoftPro
returned contacts. It did not return an escrow company. Same pattern as the
missing-buyer ticket: the vendor is empty on the field we need, and other
fields on the same file are filled.

---

## 8. What this does not license

**Do not build. Do not change `resolvePrelimRecipients`. Do not send email.
Do not run jobs.**

A looser resolver (fall through from a bad officer FK to the company party,
or promote the sales rep / client to TO) would not recover the 1,086: they
have no company party to fall through to. The 15 would still fail — the
company row has no address. The 159 TSGs would still fail.

The latch on 93 of the live Purchase / Refinance no-path rows is the same
one-way `contacts_empty_confirmed` already described in
`SOFTPRO_MISSING_BUYER.md`. Re-reading those 93 is a cheap read-only check
and is not done here.

---

## 9. Reproducing this

Read-only. Timestamps cast to text. Production as of 27 Aug 2026.

```sql
-- Validity matches isValidEmail: trim, then /^[^\s@]+@[^\s@]+\.[^\s@]+$/.
-- Headline split.
WITH valid AS (
  SELECT o.id,
    (o.escrow_officer_id IS NOT NULL) AS has_officer,
    (c.email IS NOT NULL AND btrim(c.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') AS officer_email_valid,
    EXISTS (
      SELECT 1 FROM order_parties p
      WHERE p.order_id = o.id AND p.role = 'escrow_company'
    ) AS has_company_party
  FROM orders o
  LEFT JOIN contacts c ON c.id = o.escrow_officer_id
),
company AS (
  SELECT DISTINCT ON (p.order_id)
    p.order_id,
    (p.external_email IS NOT NULL AND btrim(p.external_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') AS ext_valid,
    (ct.email IS NOT NULL AND btrim(ct.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') AS contact_valid
  FROM order_parties p
  LEFT JOIN contacts ct ON ct.id = p.contact_id
  WHERE p.role = 'escrow_company'
  ORDER BY p.order_id, p.id
),
classed AS (
  SELECT
    CASE
      WHEN v.has_officer AND v.officer_email_valid THEN 'resolved_officer'
      WHEN v.has_officer THEN 'null_officer_invalid'
      WHEN NOT v.has_officer AND NOT v.has_company_party THEN 'null_no_officer_no_company'
      WHEN NOT v.has_officer AND COALESCE(co.ext_valid, false) THEN 'resolved_company_external'
      WHEN NOT v.has_officer AND COALESCE(co.contact_valid, false) THEN 'resolved_company_contact'
      WHEN NOT v.has_officer THEN 'null_company_no_valid_email'
      ELSE 'other'
    END AS bucket
  FROM valid v
  LEFT JOIN company co ON co.order_id = v.id
)
SELECT bucket, count(*)::int AS orders
FROM classed
GROUP BY 1
ORDER BY 2 DESC;
```

```sql
-- Live Title-only Purchase / Refinance: 82% resolve, 18% do not.
SELECT COALESCE(o.order_type, '(null)') AS order_type,
       count(*)::int AS live_pr,
       count(*) FILTER (WHERE o.escrow_officer_id IS NOT NULL)::int AS has_officer,
       count(*) FILTER (
         WHERE o.escrow_officer_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM order_parties p
             WHERE p.order_id = o.id AND p.role = 'escrow_company'
           )
       )::int AS no_path
FROM orders o
WHERE o.transaction_type IN ('Purchase', 'Refinance')
  AND o.operational_status IN ('in_process', 'open', 'hold')
GROUP BY 1
ORDER BY 2 DESC;
```

```sql
-- File-number suffix, the branch discriminator used above.
SELECT COALESCE(substring(o.file_number from '-([A-Za-z]+)$'), '(none)') AS suffix,
       count(*)::int AS book,
       count(*) FILTER (
         WHERE o.escrow_officer_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM order_parties p
             WHERE p.order_id = o.id AND p.role = 'escrow_company'
           )
       )::int AS no_path
FROM orders o
GROUP BY 1
ORDER BY 2 DESC;
```

Counts move. New orders arrive; enrichment writes `escrow_company` rows.
Re-running later will not reproduce these exact integers. The direction will.

---

## 10. What the owner has to decide

Nothing here is implemented.

1. **Operational, and the only thing that recovers the 621 live Title-only
   files.** Outside escrow is not being typed on ~1 in 5 Title-only Purchase /
   Refinance files opened since April. 82% of the same product already carry
   an officer or a company email, so this is a SoftPro fill-rate problem, not
   a product that never gets a prelim. Same class as the missing buyer.
2. **Leave the 159 TSGs alone.** They have no delivery path by construction.
   If a prelim ever needs to leave those files, that is a new recipient rule,
   not a backfill.
3. **The 15 named companies with no email** are a narrower capture gap —
   SoftPro (or we) stored the firm and dropped the address. Five are live.
4. **The 15 live Title & Escrow files with no officer** are ours, unambiguously.
5. **Do not loosen the resolver** to invent a TO. The 1,086 have nobody to
   invent one from.

Related: `SOFTPRO_MISSING_BUYER.md` (vendor-empty on a field other files
already hold), `DELIVERABLE_EMAILS.md` (this resolver),
`CREATE_ORDER_DROPPED_FIELDS.md` (the 6 hub-created misses),
`PARTY_WIZARD_INVITE_TARGETING.md` (same two-step recipient, same empty
officer + empty company miss).
