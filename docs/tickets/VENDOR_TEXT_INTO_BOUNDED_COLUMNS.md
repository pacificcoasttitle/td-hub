# Vendor text written into length-limited columns

**Opened:** 2026-09-14 · **Status:** list only — nothing below is fixed except `order_properties.property_type` (#130)

## The class, in one sentence

> A value from a vendor response is written into a `varchar(n)` column with no
> truncation or length check, so one long value throws `22001` — and wherever
> that write sits after another, the record is left half-written.

Found on `order_properties.property_type` (`varchar(50)`, SiteX
`UseCodeDescription`): 8 half-created hub orders from 2026-09-09 to 2026-09-14,
column made `text` in #130. The same overflow was named on 2026-09-01 and never
fixed — `CREATE_LOCAL_FAILURE_IS_UNDIAGNOSABLE.md`, "Why it came back".

## Confirmed from data

| Column | Evidence | Status |
|---|---|---|
| `order_properties.property_type` (50) | 8 recorded create failures; replayed: `22001`; 54–57 character values | **Fixed** (#130, migration 0047) |
| `contacts.company_name` / `full_name` (200) | Lender `PLML5446`: SoftPro `Name` is **235** characters. `softpro.sync_contacts.lender` has stored a Drizzle-wrapped `insert into "contacts"` failure 11 times, latest 2026-09-12. The stored error never names the reason (wrapper), but the value cannot fit either column. | **Fixed** (migration 0049, 2026-09-14): `contacts.company_name` and `companies.name` to `text`, and the contact syncs now store the Postgres reason instead of the SQL. Closed only when the next lender sync is seen to create PLML5446 |

## Why "no 22001 recorded" means nothing here

Searched 2026-09-14: `jobs.error`, `jobs.payload`, `contact_sync_state`,
`vendor_api_logs`, `admin_activity_logs`, `document_audit` and
`notification_logs` contain **no** `value too long` text. That is not evidence
of absence: most writers store the Drizzle wrapper's message, which is the SQL
and its parameters and never the Postgres reason (the recorder defect fixed in
#130). Stored wrapper failures that are still unexplained:

```
softpro.sync_contacts.lender                 insert into contacts   11   latest 2026-09-12   (PLML5446, above)
softpro.sync_contacts.order_contact_person   insert into contacts    5   latest 2026-09-03   not replayed
softpro.fetch_prelims                        select                 36   latest 2026-05-05   a select cannot overflow; different cause
```

## Traced from code — not measured

Every writer below takes a vendor value into a bounded column with no guard. It
is **not** known which have ever overflowed; several sit behind catches that
would hide it. Ranked by how free-form the vendor field is and what a failure
leaves behind.

**Highest — free text, and a failure leaves something half-written**

| Column (limit) | Writer | Vendor field | On failure |
|---|---|---|---|
| `order_parties.external_name` / `external_company` (200) | `enrich-orders.ts` party upsert; `verify-order-sync.ts` | SoftPro `PrimaryBorrower` / `PrimarySeller` — vesting text for several people | order never enriches; retried every 6 h |
| `contacts.*`, `companies.*` names (200) | `enrich-orders.ts` contact/company upserts | SoftPro `GetOrderContacts` `Person.Name`, `Company.Name` | runs before the order's FK and party writes, so the order never enriches |
| `order_properties.county` / `apn` / `fips` / `address` / `city` / `state` / `unit_number` (100/50/20/500/100/10/30) | `create-order.ts` property insert | SiteX `CountyName`, `APN`, `FIPS`, `SiteAddress`, `Location.UnitNumber` | **half-created order** — the incident's own shape |
| `order_properties.*` (same) | `process-detail.ts` | SoftPro `GetOrderDetails` `Address` / `City` / `Zip` / `Country` | `orders` inserted first, so a new order can half-create |
| `order_status_history.status` (50) | `webhooks/softpro-handler.ts` | milestone webhook `Id`, stored raw when unmapped | **swallowed** by `catch {}`; webhook reports success |
| `concierge_profile_comps.*`, `concierge_profile_transfers.*`, `concierge_profiles.subject_use_description` (60–200) | `concierge/generate.ts` | SiteX `ComparableSales[]`, `TransferHistory[]`, `UseCodeDescription` | credit spent, profile stuck; one bad comp loses all comps |

**Medium — free-ish text, failure recorded or contained**

- `documents.filename` / `storage_key` (500) from SoftPro `FileName` /
  `StoredDocumentName`: the S3 upload happens first, so a failure leaves an
  orphaned file. The `fetch-prelims` path is swallowed.
- `order_external_refs.ref_value` (200) from Westcor `FormName` and FNF ids: a
  lost `fnf_document_id` makes the next CPL a create instead of an edit.
- `cpl_branches.*` (10–200) from the FNF agent API: no catch, and the branch
  list 500s.
- `contacts.*` in `sync-contacts.ts` and `sync-new-users.ts` from the lookup
  tables: errors recorded. `sync-new-users` skips the rest of an entity type
  after one bad row.
- `orders.product_type` / `order_type` / `marketing_source` (100/200) from
  `GetOrderDetails`.

**Low — ids and codes**

`orders.file_number`, `orders.softpro_status`,
`documents.softpro_document_id`, `title_point_data.request_id` / `service_id`,
`notification_logs.provider_id`, `party_submissions.softpro_note_id`,
`concierge_profiles.match_method_code`.

## Not in the class

Operator-entered values with a zod `max` (party wizard `submitted_*`), values
copied between our own columns of equal or smaller size, and every value we
construct ourselves.
