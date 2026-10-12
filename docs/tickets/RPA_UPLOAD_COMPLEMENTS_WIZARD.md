# Upload complements the wizard — it does not replace it

**Status: ASSESSMENT.** Opened 2026-08-31. The five feasibility questions
are answered below (measured 2026-08-31, read-only). Nothing in this
ticket is being built. No upload path, no landing-page change, no email
change, invite stays off (`party_wizard_invite_enabled` = false,
`party_wizard_invite_shut_off` = true, 0 `party_wizard.invite` rows, 0
`party_submissions`). TESSA stays off (`tessa_prelim_enabled` = false).
No PR.

Created because no existing RPA (Residential Purchase Agreement)
assessment lived in `docs/tickets/`, playbooks, or this week's
transcripts. The only prior "Upload RPA" mentions are open-order form
labels in `docs/playbook/open-order-form-overhaul.md` and
`docs/playbook/open-order-form-parallel-plan.md` — a different surface.

This is a design frame, not a build order.

**Still blocked** on the parked COO one-vs-separate answer in
`PARTY_WIZARD_ONE_LINK_OR_FOUR.md`, **and** on the other three wizard
forms (`buyer_agent`, `buyer`, `seller`) if we take the picker path.
Listing agent is the only form today. Do not build a landing page that
offers roles with no form behind them. Do not enable invite from here.

Refinance / 1003 is noted below for later. It is not in this scope.

## The frame (Gerard, 2026-08-31)

UPLOAD COMPLEMENTS THE WIZARD, IT DOES NOT REPLACE IT. We cannot compel
an escrow officer to do anything, so the goal is to make every route to
the data as cheap as possible and let them choose.

SHAPE: one email, one link. The landing page offers TWO paths side by
side:

- Upload the purchase agreement (fastest on a purchase — they already
  have it open)
- Forward this to the parties (their current behaviour; works on refis
  and when they don't have the document)

Neither is presented as the fallback. They pick what's cheaper in the
moment.

## The two paths must know about each other

- If an upload yields both agents, we do not then chase those agents
  with a link.
- If a party has already submitted, an upload must not overwrite their
  confirmed value — the latch from #69 (`party_confirmed_at`) applies
  here too. Confirmed values outrank parser **and** outrank RPA extract.
- Whatever the upload can't fill still needs the forward path, so the
  page has to say what's still outstanding after processing.

`protectConfirmedPartyFields` is the latch. A named human's confirmed
value survives SoftPro, SiteX, lookback, enrich, merge — and would have
to survive an RPA extract the same way. Empty confirmed fields may still
be filled. The wizard itself remains the confirmation path.

## What this does to the role picker

Only people arriving via a forward ever see the picker. The escrow
officer who uploads never does.

That may reduce how much the picker's loss of role-scope actually costs
us. It does **not** change the cost, and it does not reopen the COO
question. The verbatim loss sentence stays in
`PARTY_WIZARD_ONE_LINK_OR_FOUR.md`. This ticket does not paraphrase it.

## Refinance, for later — not now

The refinance counterpart is a **1003** (Uniform Residential Loan
Application / URLA). Typical contents, not a scoped field list: borrower
identity, loan amount and purpose, subject property, and often current
employment. Do not add 1003 to the build. Do not design a refi upload
path from this ticket.

## What this is not

- Not a replacement for the party wizard.
- Not an invite enable.
- Not a refinance scope.
- Not a decision on one-link-with-picker vs four-link. That is still
  the COO fact in `PARTY_WIZARD_ONE_LINK_OR_FOUR.md`.

## Feasibility (measured 2026-08-31)

Read-only. Production Postgres. No SoftPro extra query keys, no live
GetAttachedDocuments probe, no TESSA spend, no minted links, no mail.
CPL Seller #2 is not an unfinished change in this workspace — the
uncommitted `order-cpl.tsx` hunk is a SoftPro sync label, not Seller #2.

### Window

**Active Purchase** = `transaction_type = 'Purchase'` AND
`operational_status IN ('open', 'in_process')`. Same status pair as
`loadCandidates` in `party-wizard-invite.ts`. Not the 3–30-day invite
age window (that is a send filter, not “is this a live purchase file”).

| Cut | Orders |
| --- | --- |
| All orders | 8,135 |
| Purchase | 3,872 |
| **Active Purchase** | **2,060** |
| …opened 3–30 days ago | 525 |

Do not collapse these into one number.

### Q3 first — do we already have RPAs?

**No. Active Purchase orders with an RPA-like document we can see: 0
(hub) + 0 (cached SoftPro listings) + 0 (TitlePoint).** Extraction on
data we already hold is not available. For these files, somebody still
has to upload — or SoftPro has to give us a folder-aware listing we do
not have and will not probe.

#### Match definition

A hit is a filename, `original_filename`, SoftPro listing URL, or
TitlePoint `search_type` that looks like the purchase agreement itself:

- `rpa` / `RPA-CA` / `RPA `
- `purchase agree` / `residential purchase`
- `purchase contract`
- `California Residential Purchase Agreement`

Near-misses, **not** counted as RPA: bare `contract`, prelim amendments
(`AMENDED PRELIM…`, `Preliminary Title Report- Amendment`), counter
offers, escrow instructions, trust/death-cert emails, `Documents.pdf`,
Junior Loan Policy, TitlePoint geo/LV/grant-deed/tax products.

#### Hub `documents` table

0 rows match the patterns above, on active Purchase or on the whole
table. Categories on the 2,060 active Purchase files:

| category | rows |
| --- | --- |
| prelim | 1,692 |
| cpl | 6 |
| tax | 5 |
| grant_deed | 5 |
| legal_vesting | 5 |
| general (TitlePoint geo_address PDFs) | 4 |
| proposed_insured | 3 |
| user_upload | 0 |

The hub stores what we fetch or generate (prelims, title docs, CPLs).
It does not store purchase agreements.

#### SoftPro attached docs (DB only — no live probe)

`vendor_api_logs` `get_attached_documents` / `_prelim`: 511,800 rows.
`describeAttachedDocuments` keeps `itemCount` plus a **sample of the
first 3 items**, not the full list. `order_id` is null on these logs;
join is `request_meta.queryParams.orderNumber` → `orders.file_number`.

| | |
| --- | --- |
| Successful listings with `itemCount = 0` | 501,395 |
| Successful listings with items | 553 |
| Distinct files those 553 cover | 482 |
| …of which are current active Purchase | 216 |
| RPA-like names in any sample | **0** |

What the 553 samples actually are: Preliminary Title Report (~794
sample strings), prelim updates/QC/amended prelims, `COPY OF TRUST &
DEATH CERT` (.msg), `Title commentment`, `Update 1` / `Revised 1`, one
`Junior Loan Policy`, one `Documents.pdf`. No purchase agreement, no
CAR form name, no counter offer, no escrow instructions.

Caveat, not a count: GetAttachedDocuments misses Production Documents
subfolders (`SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS.md`) and
returns `[]` on most calls. SoftPro-the-file may still hold an RPA in a
folder we cannot list. We did not POST or add query keys to find out.
The claim is: **we do not hold it, and the listing cache we have does
not show it.**

#### TitlePoint

Never. `title_point_data.search_type` is only `geo_address`,
`legal_vesting`, `grant_deed`, `tax`. No purchase-agreement product.
Code path (`TitlePointSearchType`) has no RPA member.

#### Of the RPA-like set, who still has a hole?

The RPA-like set is empty, so extract-would-fill is **0 / 0**.

The hole extract would be aimed at, on all 2,060 active Purchase
(usable = name or email on the party row, same idea as the invite
job’s listing-agent predicate):

| Field | Have it | Lack it |
| --- | --- | --- |
| usable `listing_agent` | 889 | 1,171 |
| `listing_agent` email | 767 | 1,293 |
| usable `buyer_agent` | 52 | 2,008 |
| `buyer_agent` email | 22 | 2,038 |
| `buyer` email | 0 | 2,060 |
| `seller` email | 0 | 2,060 |

Buyer and seller emails are structurally empty on `order_parties`
(same finding as `PARTY_WIZARD_INVITE_TARGETING.md`). An RPA Brokers
Section would fill **agent** names and emails, not buyer/seller emails
— those are not in that section.

### Q1 — Brokers Section across C.A.R. revisions

**Judgment, grounded.** We have no RPA PDFs in the repo or in hub
storage. Public C.A.R. samples:

| Form | Pages | Brokers block |
| --- | --- | --- |
| RPA-CA Revised 12/18 | 10 | `REAL ESTATE BROKERS:` on page 10. Buyer’s / Seller’s Brokerage Firm, DRE #, Address, Telephone/Fax/**E-mail**. |
| RPA Revised 12/21 | (reorg) | Bay East quick guide: Brokers Section made easier for multiple agents and **email / text**. |
| RPA Revised 12/22 | 16 | `REAL ESTATE BROKERS SECTION:` on pages 15–16. Numbered 1–5. **Email** is its own line. Designated Electronic Delivery Address checkboxes (email / text / alternate). |
| RPA Revised 12/24 (current) | last page | Same last-page Brokers Section. Agent lines still carry address, email, phone. Cooperating-broker compensation paragraph was removed in a 2024 pass — labels for firm / agent / email stayed. |

The **page number moves** with form length (10 → 16). The **section
title and the firm / agent / email labels stay**. Pixel-stable
templates would break. A last-page + heading parse (`REAL ESTATE
BROKERS`) is the tractable approach. ZipForms / digital fills are the
easy case; scanned fax is Q2.

### Q2 — Text vs scanned, OCR cost

Cannot sample an RPA blob — there are none in `documents`, and no PDFs
in the repo. Did not download prelims from S3 to stand in for RPAs
(wrong document, and a spend).

Proxy, TESSA prelims (not RPAs): 3,471 `prelim_analyses` rows, 3,413
`complete`. `pdf_char_count` p50 = 50,000 (the extract cap) — those
are digital text. 3 rows failed with image-based / too-short (TESSA
`extractPdfText` rejects `< 100` chars). The other failures are API
key / pipeline, not scans.

TESSA is **not an OCR vendor**. It runs `pdf-parse` then Claude
(`claude-sonnet-4-20250514`). A scanned RPA would fail at extract
before any LLM call. OCR, if we ever need it, is a new vendor
(not TESSA). No ballpark invoice exists here because we have no OCR
product and did not turn TESSA on.

### Q4 — TESSA per document vs deterministic Brokers parse

`tessa_prelim_enabled` is **false**. Not flipped.

TESSA at current prelim p50, from 3,428 successful `tessa_extract` +
3,422 `tessa_summarize` logs (Anthropic list price Sonnet 4, $3/M
input + $15/M output — not a billed invoice):

| Call | p50 in | p50 out | ~$ at list |
| --- | --- | --- | --- |
| `tessa_extract` | 16,300.5 | 1,513.5 | ~$0.072 |
| `tessa_summarize` | 2,481 | 225 | ~$0.011 |
| **per document** | | | **~$0.08** |

RPA-like population is 0, so TESSA-on-what-we-hold is **$0**. If a
future upload set existed, full TESSA-as-prelim (~$0.08/doc) is the
wrong tool: it is a whole-document title-report extract + summary.
A Brokers Section parse, given a text layer, is deterministic:
anchor on `REAL ESTATE BROKERS`, read Buyer’s / Seller’s Brokerage
Firm, agent `By` line, and Email. That is listing_agent + buyer_agent
names and emails. Do not send the other 15 pages to Claude for that.

### Q5 — Where the upload lives

The approved frame holds against the shipped page.

**Invite landing today** (`/party-wizard/[token]`,
`wizard-page-body.tsx` + `party-wizard-form.tsx`): listing-agent form
only. Three views (form / summary / submitted). No file input, no
second path, no role picker. One email / one link, when invite is on,
lands here. Upload is not on this page.

**Not the invite path:** the hub/client new-order review step
(`step-review.tsx`) is labeled **“Drop curative documents here”**.
The playbook lines “Upload RPA” / “Upload 1003” in
`open-order-form-overhaul.md` were never shipped — that is an
operator (or client) open-order upload, a different surface, and
`user_upload` has 0 rows.

Shape if this is ever built: same one-email one-link landing as the
wizard, two paths side by side. Not a new email. Not the hub
new-order form.

### Still not a build

Questions are closed. Invite off. TESSA off. No RPA upload project.
The COO one-vs-separate fact and the missing three forms still block
any landing-page work.
