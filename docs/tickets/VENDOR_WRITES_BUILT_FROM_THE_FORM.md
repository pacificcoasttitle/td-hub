# Vendor writes that replace a record, built from request data

**Opened:** 2026-09-12 · **Status:** list only — nothing in "open" below has been fixed

## The class, in one sentence

> A vendor write that **replaces** a record, whose payload is built from the
> incoming request instead of the stored record merged with the request's
> changes — so any field the request doesn't carry goes to the vendor blank.

Found twice before anyone looked for it as a class:

- **Contact edit → SoftPro `UpdateUser`.** Fixed 2026-09-09 (#115). The form
  had no address or zip; every edit would have blanked them.
- **Company edit → SoftPro `UpdateCompany`.** The identical defect, untouched
  until 2026-09-12, when the first company edit ever made sent SoftPro
  `Address1: ""` for Private Money Solutions (`Priv1503`) — log `1316141`,
  answered `200 Company updated`. Fixed 2026-09-12 (#126). Whether SoftPro
  cleared the address on that write was never established; see "Priv1503
  restore" below.

## How the sweep was done

Every vendor operation ever logged in `vendor_api_logs` that looks like a write,
then every call site of each, then the payload builder for each one that
replaces rather than creates or appends. Where the logs carry the payload, the
payloads were diffed call-to-call for fields that went from a value to blank.

## The list

| # | Write | Where | Calls | Payload source | Status |
|---|---|---|---|---|---|
| 1 | SoftPro `UpdateCompany` | `api/companies/[id]` | 2 | Was the form alone | **Fixed** (#126), and `Priv1503` re-saved through the fixed form on 2026-09-12 — SoftPro holds the address — see below |
| 2 | SoftPro `UpdateUser` | `api/contacts/[id]` | 1 | Stored row merged with the form, using `??` | **Safe in practice, structurally weaker than #126.** `??` still sends a blank from an empty input; it holds only because the edit form pre-fills every field it sends. First and last name come straight from the form: 520 active contacts have a first name and no last name, and SoftPro holds a last name for **0** of them (2026-09-09 scan), so nothing is lost today |
| 3 | FNF `EditCPL` | `cpl/fnf/client.ts` | 6 | Lender name/address from the request's overrides, else the order's lender (a name only); attention, assignment clause and loan number from the request only | **Open.** The CPL modal pre-fills all of these from the previous CPL's saved data, so a single regenerate carries them. **The batch CPL route accepts only lender overrides**, so a batch regenerate on an order that already has an FNF letter replaces it without the address, attention, assignment clause or loan number. The logged payload holds only cplId/formName/documentId, so past blanking cannot be measured |
| 4 | Westcor `Order/Update` on an existing tvid | `cpl/westcor/payloads.ts` | 78 reuses of 298 | Property, buyers and sellers from the stored order; lenders from order + request | **Closed 2026-09-14 — null means unchanged, where it can be seen.** Every update sends `search`, `commitment`, `jacket`, `sdn`, `history`, `notes`, `cpl` and `priors` as `null`. Read back with `GET VendorApi/Order/{tvid}` — see "Westcor read-back" below. Lender fields keep the same batch exposure as #3 |

### Checked and not in this class

- **Creates:** SoftPro `CreateUser`, `AddCompany`, `CreateOrder`; TitlePoint
  `create_service`. No stored vendor record to lose. (Placeholder values on
  creates are a different class — `WESTCOR_PLACEHOLDERS_ON_THE_LETTER_FACE.md`.)
- **Appends:** SoftPro `AddNotes`, `upload_document`; S3 upload; SendGrid.
- **`enrich_order_contacts`:** a SoftPro read plus a local write, not a vendor
  write.

### Found on the way — different classes, not fixed

- **Proposed Insured "New Lender" inserts a local company every time.** 12 since
  2026-09-04: no lookup code, not flagged `is_lender`, never sent to SoftPro, and
  duplicated (Arcstone Financial ×2, Insignia Capital ×2, "alomi Sheth" beside
  "Palomi Sheth").
- **The master book answers any logged-in session, including clients** — see
  "Reads of the master book" below. The
  CPL lender search was kept staff-only for that reason (#127).

## Priv1503 restore — done, and what it taught

The restore needed a SoftPro write with `SOFTPRO_USER_ID`, which the local
environment deliberately does not hold, so an admin re-saved the company through
the fixed form. That landed at **2026-09-12 01:53:06Z**, log `1317259`, carrying
`Address1: "15030 Ventura Blvd., #500"`, answered `200 Company updated`.

SoftPro read back afterwards:

```
GetLookuptable?userType=Lender  (found on page 3 at pageSize 500; TotalRows 1,486 that day)
{"LookupCode":"Priv1503","Name":"Private Money Solutions, Inc",
 "Address1":"15030 Ventura Blvd., #500","City":"Sherman Oaks","State":"CA","Zip":"91403", ...}
```

**The first read-back said the opposite, and it was wrong.** The watcher read
`GetCompanies?companyType=Lender`, which returned `Address1: ""` — so did the
three lender companies created (never updated) on 9–11 Sept, and so did all 500
rows on page 1, Rocket Mortgage included. `GetCompanies` does not carry
`Address1` at all. Two consequences:

1. **Reading a company's address requires `GetLookuptable?userType=Lender`.**
   `GetCompanies` is usable for name, type, city, state and zip only. Its
   `LastModifiedAt` is a single bulk stamp shared by every row, the same defect
   as the lookup table's, so it cannot date a write either.
2. **The original blanking was never observed, only sent.** No lender lookup
   read is logged between the bad write (00:20:30Z) and the restore (01:53Z),
   and nothing snapshots vendor state, so whether SoftPro cleared the address
   for that 93 minutes is unknowable. What is established: we sent a blank, and
   the record is correct now.

## Westcor read-back (2026-09-14) — closes #4

`GET VendorApi/Order/{tvid}/{partner}` on `services.ewestcor.com`, read-only,
using the hub's cached token.

**Control first — does this endpoint return the sections at all?** Yes for two
of them, and those two are the ones that matter. On orders created once and
never updated, `cpl` is `array(1)` with the letter's `CPLID`, issue date and
DataVault file id, and `history` is `array(4)`. So an absence in either would
mean something.

**The test.** Every tvid our logs show being updated *after* a CPL already
existed on it, compared with how many CPLs we logged generating:

```
tvids updated after a CPL existed          44   (all read back)
update calls that sent cpl: null over one  54
tvids holding fewer CPLs than we logged     0
tvids with an empty history                 0
```

tvid `3719941` (order 51) was updated 7 times and still holds 4 CPLs from 25
March to 2 September; its history has 28 entries. Null does not erase `cpl` or
`history`.

**What this endpoint cannot show.**

- `search`, `commitment` and `jacket` come back as the same empty structures on
  orders never updated as on orders updated seven times. Nothing in the hub
  populates them, so there was nothing there to erase.
- `sdn`, `notes` and `priors` are `null` on every order read, including ones
  never updated. That means the endpoint shows nothing either way — **not
  provable from here.** The hub never writes them. The SDN results themselves
  are kept inside `history[].raw`, and history is intact.

## Reads of the master book (found 2026-09-14, not fixed)

The class: **a read endpoint that returns our master company or contact book to
any logged-in session, clients included.**

| Endpoint | Guard | Non-staff caller |
|---|---|---|
| `GET /api/companies` | any session | **client portal** party step, company typeahead (`step-add-parties.tsx:171`) |
| `GET /api/contacts` | any session — names, emails, phones | **client portal** party step, name typeahead (`step-add-parties.tsx:165`) |
| `GET /api/companies/[id]` | any session — sequential ids | none found |
| `GET /api/companies/near-match` | any session | none found (admin wizard) |
| `GET /api/contacts/search` | internal-role list | — (already correct) |

Locking only `/api/companies` would leave the larger exposure — people, with
emails and phones — open, and would break the portal's company typeahead
while doing it.
