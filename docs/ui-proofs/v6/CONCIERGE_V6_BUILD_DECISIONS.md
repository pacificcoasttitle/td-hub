# Concierge v6 — build decisions

**Decided by Gerard, 29 Sep 2026.** This supersedes the conflicting instructions
between `Concierge Redesign Spec.dc.html` (23 Sep) and the FINAL BUILD HANDOFF
(28 Sep). Where those two documents disagree, this file wins.

---

## 0 · The v6 picture is not available — build from the written spec

`docs/ui-proofs/v6/` contains the 23 Sep package. Its own spec file names
`Concierge Property Profile v3.dc.html` as its picture, and that is the design we
shipped as `TEMPLATE_VERSION` v2. `Concierge Property Profile v6.dc.html` is not
on this machine; it may be stranded in the worktree the last session was moved off.

**Do not wait for it.** Build from the FINAL BUILD HANDOFF's written page map and
rules, using v3 as the visual base — same palette, same layout language, same
conventions. The deltas from v3 are enumerated and sufficient:

- Page 1 loses the valuation entirely (delete the blocks, do not flag them off)
- New thank-you page at 2, with the Insurance Commissioner disclaimer
- Tax splits out of v3's "Owners and taxes" into its own page 4
- Plat map at 8

**Numbering note.** The design documents count v1–v6; `TEMPLATE_VERSION` counts
v1–v3. The file named "v3" is the design behind template **v2**. A previous
session concluded the redesign was already shipped because it read the label.
Use `TEMPLATE_VERSION` as the only version that matters in code.

---

## 1 · Gerard's rulings

**Fonts — take the new ones.** Montserrat 600/700/800/900 for headings, Work Sans
500/600/700 for body. TTFs committed to the repo, `Font.register` at module load,
no runtime fetch from Google. (A production deploy already died once on a Google
font download.) This overrides the 23 Sep spec's "keep Helvetica".

Confirm the files resolve inside the Vercel function bundle, not just locally.

**Foreclosure records stay on the report.** Do not block them. The reasoning that
makes this defensible, and that the implementation should respect:

- Recorded documents — deeds, mortgages, notices of default, assignments — are
  county public record. Listing them is standard title product.
- **Keep the v3 caveat**, verbatim in spirit: a 2022 recording does not mean a
  proceeding is active today; current status comes from title review. Stale
  foreclosure data read as current is the real exposure, not the disclosure.

**Type scale — the newest document that addresses it wins.** The 28 Sep handoff is
silent, so the 23 Sep spec stands: 9.5pt body, 8.5pt table cells, 7pt floor.

**Open — one line, awaiting Gerard.** The handoff blocks the tax **payment status**
field ("delinquent / paid / current") on the same privacy reasoning that was
applied to foreclosures. Gerard's "report all available details" may cover it.
Until he confirms, leave the handoff's block in place; flipping it is one change.

---

## 2 · Page 4 source — TitlePoint, not SiteX

Confirmed by reading all three stored raw payloads (free — `raw_storage_key`).
Feed 100001 carries **2 of the 7** fields page 4 needs:

| Page 4 needs | Feed 100001 |
|---|---|
| Annual tax | yes |
| Assessed split (land / improvement) | yes |
| Two installments | absent |
| Homeowner's exemption | present, null on all three |
| Special assessments | absent |
| Bonds | absent |
| Supplemental bills | absent |

TitlePoint's tax report carries all of them — see
`docs/titlepoint/TITLEPOINT_TAX_REPORT_ELEMENTS.md` for the full element
inventory and the client-facing classification.

**The bridge mostly exists.** `title_point_data.order_id` is nullable, `orderId` is
optional throughout the TitlePoint client, and `buildPreOrderTaxCreateServiceRequest`
already fires a tax search before any order exists, keyed on `customerRef`. Pass
the profile id as `customerRef`. No migration, no new vendor integration.

**Keep these rows out of order logic.** With `order_id` null they should match
nothing, but any query over `title_point_data` that does not filter on order id
will sweep them up. Mark the row and test it.

---

## 3 · The tax call — money, timing, idempotency

**A TitlePoint tax search bills per call.** That drives everything below.

**Opt-in, default off.** The modal control names the charge — *"Add property tax
detail — one additional search"* — not "include taxes".

**Never inside the paid generate.** TitlePoint tax is create → poll → fetch and can
take minutes. Waiting on it inside the charging request reproduces the
charged-but-incomplete failure that `resume` exists for. Instead: the profile
generates and delivers on SiteX alone, the tax search runs in the background, and
when it lands the profile **re-renders free** and page 4 appears.

**Ticking it on an existing profile spends on tax only.** We have already paid
SiteX for that property; re-running generate would buy it twice. This is also a
**row action**, not only a modal checkbox, so profiles created before this feature
can get page 4.

**Second spending route — change the money rule on purpose.** `routes.test.ts`
currently enforces that `profiles/route.ts` is the only spender. Update it to name
**two** spenders explicitly. Do not loosen the assertion until it passes; a guard
relaxed to accommodate a change stops being a guard.

**Idempotency key on property + tax.** The existing claim guard protects the SiteX
call and is keyed on the property alone. Extend it rather than inventing a second
mechanism — it is the one piece of Concierge already proven in production (409, 0
charged).

**Record the charge per vendor.** `sitex_credits_charged` is SiteX-only and a
TitlePoint charge does not belong in it. Store it separately with the TitlePoint
`requestId` as the reconciliation handle. The admin usage page shows the two side
by side, never blended.

---

## 4 · Fallback — three layers, middle one visible

1. TitlePoint tax report.
2. SiteX `AssessmentTaxInfo` — assessed value, land / improvement split, annual
   amount. **The page must say it is on this layer and give an as-of date.** A
   reader should never have to guess why one profile shows installments and
   another does not.
3. Neither → **no page 4 at all.** Seven pages. No empty shell, no
   "not available" tile.

**Do not hardcode the excluded counties.** Attempt, fall back on denial, record the
denial. A constant goes stale the day someone buys Mono coverage, and worse, we
stop noticing the entitlement gap exists.

**Denied counties are free.** Verified: 61 denials, zero TitlePoint request ids
issued — TitlePoint refuses at `create_service` before doing any work. There is no
unit of work to bill. So the gate copy needs no county caveat.

**Unknown:** whether a search that *runs* and finds no tax record bills. Never
observed — all 837 completed tax searches returned something.

---

## 5 · The timeout finding — independent of this feature

Fifteen searches (5 tax, 10 legal vesting) carry a real TitlePoint `requestId` and
no result. TitlePoint issued the search and did the work; we walked away. If issued
searches bill, we are paying for these and getting nothing — **on orders, not
Concierge.**

Two consequences:

- Worth its own investigation outside this work.
- **The background tax search must treat a timeout as already paid for** and poll
  it out rather than re-firing. That is the one failure mode that bypasses the
  idempotency key by buying something we already own.

**To close the billing question permanently:** match one TitlePoint invoice month
against `title_point_data.request_id`. 1,198 tax request ids are available to
reconcile. Nothing in the system currently records a TitlePoint charge at all.

---

## 6 · Corrections carried forward

**It is 13 counties, not 14.** Mono was counted twice by a query that did not fold
case. The error propagated into the docs and then into the handoff. Marin joined on
23 Sep, which is the argument against a hardcoded list.

**Page 3 price per square foot is supplied, not computed.** SiteX sends
`SaleLoanInfo.PricePerSQFT`. `concierge_comps.price_per_sqft` is already annotated
"SiteX's own figure. Never recomputed from BuildingArea — that was the legacy bug."
The payload carries two building areas (786 and 793); computing walks back into it.

**The plat map is already built.** `platmap.ts` takes SiteX's inline base64 TIFF,
treats `Status` as authoritative, converts to PNG with sharp once at generation,
and returns a typed outcome with a reason for every failure — `not_supplied`,
`not_available`, `no_content`, `decode_failed`. That is the "footnote rather than a
blank frame" behaviour, already done.

**Retiring `/api/orders/[id]/concierge-profile` means deleting its hook too.**
`use-concierge-profile.ts:80` calls it. That hook is imported by nothing, so both
go in the same change.

---

## 7 · Standing rules that apply to this work

- Any comp field the layout reads must be in `COMP_DOCUMENT_FIELDS` **first** —
  that contract exists because the re-render silently dropped comp addresses.
- Source files are edited with the Edit tool, never bash heredocs or Python. Three
  separate silent-guard bugs this month came from mangled escapes and line endings.
- A guard is not a guard until it has been shown to fail. Mutate it and watch.
- If a number shapes a decision, commit the script that produced it.
- Acceptance: re-render Stonybrook's stored 25 Aug payload through `POST /render`
  — no credit — and compare page for page, fonts embedded.
