# Concierge v6 — round two, plus the functionality and reports-page work

**30 Sep 2026.** Two sources, both from Gerard.

- **Design:** `Concierge-v6-BUILD-CORRECTIONS-round2.pdf` in this folder — section 6,
  written against the deployed `1358-5th-Street.pdf`. **The PDF is the authority**;
  section 1 below transcribes it so it is greppable.
- **Functionality and reports page:** sections 2 and 3, from Gerard directly.

Round one (`CONCIERGE_V6_CORRECTIONS.md`) still governs everything it covered. Round
two says *"the rebuild is on the right parts"* — what remains is the cover, page 4,
and one row on page 3.

---

## 1 · Design — round two

### Cover

**White logo, not the dark one.** The code swaps to `PCT_LOGO_DARK` when a photo is
present, because the white mark disappears against bright sky. **v6 solves it by
fading the photo instead:** a navy overlay on the top **90 pt**, `rgba(27,42,74,.7)`
at the top edge to transparent at 90. react-pdf has no CSS gradient — draw it with
an `<Svg>` containing a `<LinearGradient>`, positioned absolute over the photo. Then
restore the white logo and **delete `PCT_LOGO_DARK`.**

> This reverses the dark-mark decision of 29 Sep. That call was made without the
> gradient on the table; this is the better answer and Gerard has endorsed it.

**Centre the navy block's text.** v6 centres eyebrow / address / city vertically
inside the 241.5 pt block (`justifyContent: 'center'`). Build top-pads 29; address
`marginTop 12` (build 14), city `marginTop 7.5` (build 8), address
`letterSpacing -0.45`, `lineHeight 1.08`.

**Prepared / Presented panel.** Two columns centred vertically in the 530 ×
remaining-height panel, **30 pt column gap**, padding 0 42. Under each name, **one
line** in full white W 10.5: date for `Prepared for`; `email · phone` joined with
`" · "` for `Presented by`. **No 75% opacity.** Company, when present, sits between
name and date.

### Page 4 · Tax

| Built today | Change to |
|---|---|
| `PROPERTY TAX · 2025` | Fiscal year: **`PROPERTY TAX · 2025–2026`** (en dash, `${y} ${y + 1}`). Same in the NavyStrip `TAX YEAR` cell |
| `INSTALMENTS` · `instalment` in the footnote | **`INSTALLMENTS`** · `instalment` → **US spelling throughout** |
| NavyStrip with four cells; `TAX RATE` and `TRA` print `—` on the SiteX layer | **Drop cells with no data** — a two-cell strip (`ANNUAL TAX` · `TAX YEAR`) is right. Label the fourth cell **`TAX RATE AREA`**, not `TRA`. Half a navy strip of dashes is the empty-shell rule hit from inside |
| StatBox: amount on top, `First · due Nov 1, 2025` beneath | **Order inverted.** Each box `#F6F7F9`, borderTop 2.25 NAVY, padding 10.5 12: label **`1ST INSTALLMENT`** in W700 8.25 ORANGE letterSpacing 0.6 · amount H800 16.5 NAVY marginTop 4.5 · **`Due 11/01/2025`** in W 9.4 MUTED marginTop 3. Boxes 7.6 apart. **Not a StatBox — make it its own part** |
| Assessed bar full width; Land / Improvements rows have no swatches; `Total assessed` plain on the SiteX layer | Bar inset **9 pt** each side (`marginHorizontal 9`). A **6 × 6 pt square** before "Land" (NAVY) and "Improvements" (`#4A6FA5`), not TBA. Row reads **`Total assessed value`**, value **W700 NAVY on both layers** |
| Footnote: "instalment amounts, exemptions, special assessments and bonds were not available" — printed under two installment boxes | **Contradicts the page.** SiteX-layer footnote is: the annual amount split per California statute. Exemptions, special assessments and bonds were not in the record we received, as of `DATE` (`· COUNTY County`). `—` means the item was not included in the county record we received |

### Page 3 · Details

**"Most recent transfer" has a third row** — `Price per sq ft` / `Living area` — that
isn't in v6 and repeats the square footage from the section above. **v6 is two
rows:** recording date / document #, sale amount / document type. Put price per sq ft
on the sale-amount cell as **`$369,000 · $469/sq ft`** and drop the row.

### Check before re-submitting

Re-render 1358 5th St, **rasterise page 1 and page 4 at 816 px**, and place each
beside v6 pages 1 and 4 printed to PDF. One line under each panel name;
`2025–2026`; `INSTALLMENTS`; label-amount-due order; swatches; **no `—` in the navy
strip**. Logo white on a faded photo; text centred in the navy block.

### Done when

- The Stonybrook payload is re-rendered through `POST /render`. Each page, rasterised
  at 816 px wide, is placed beside v6 printed to PDF and matches it: same sections,
  same order, same sizes within a point.
- 1358 5th St re-renders on the same parts, eight pages, **criteria on page 6**.
- No page contains `PAID`, `delinquent`, `Late after`, `pending`, `Template v3`, or a
  value estimate.
- `routes.test.ts` and the tax-masking tests are unchanged and pass.

---

## 2 · Functionality — from Gerard

**A · The create modal is too small.** Make it larger.

**B · Sales rep should be a dropdown of the full list**, so the operator selects
rather than searches blind.

**C · The comparable criteria control does nothing.** Nothing the operator presses
changes anything. `PATCH /profiles/[id]/criteria` exists and re-filters stored comps
for free — **find out whether the UI never calls it, or it calls it and the result
isn't rendered.** Do not assume which; this is a live defect on a shipped control
that claims to work.

**D · Store prepared-for name and company on every generate**, so the field can
autocomplete as the operator types — the same behaviour as the sales-rep search.
**Check first whether these people already exist as contacts**; a second store of
client names, when `contacts` already has 15,625 rows and a known duplicate problem,
is a cost rather than a feature.

**E · Remove the "I have checked the property above" acknowledgement.** Unnecessary
step.

> Note for whoever builds it: that checkbox is what makes the spend deliberate, and
> five near-duplicate profiles exist on one parcel. Its protective work now sits with
> `GET /for-property` ("we already hold this") and the free-refresh affordance, which
> removes the reason most of those duplicates were bought. Keep both prominent.

**F · TitlePoint is not being called, and page 4 shows less than v6 does.**
Correct — the document is rendering the SiteX layer, which has the annual amount and
the assessed split and nothing else. Installments, the homeowner's exemption, special
assessments, bonds and supplementals exist only in TitlePoint's tax report.

**Build the bridge.** `CONCIERGE_V6_BUILD_DECISIONS.md` section 3 has the design and
it stands: `title_point_data.order_id` is nullable, `orderId` is optional throughout
the client, and `buildPreOrderTaxCreateServiceRequest` already fires a tax search
with no order, keyed on `customerRef` — pass the profile id. Billable, opt-in,
default off, runs in the background, never inside the paid generate, tax-only spend
for an existing profile, idempotency on property + tax, two named spenders in
`routes.test.ts`, per-vendor charge recording, timeouts treated as already paid.

Denied counties cost nothing — TitlePoint refuses before doing any work, verified
across 61 denials. Whether a search that *runs* and finds no record bills is still
unknown and has never been observed in 837 completed searches. **Gerard has decided
to proceed without waiting on the invoice.**

---

## 3 · Reports page layout — from Gerard's design review

The Actions column is a row of text links, and "Refresh document (free)" carries a
five-line explanatory paragraph **inside the table cell**. That alone forces
horizontal scroll and triples row height.

In priority order:

1. **Collapse Actions into a kebab menu.** Download, Refresh, Comparables, Notify rep
   go in a dropdown. ~350 px → ~40 px, horizontal scroll gone.
2. **Move the "older layout (v2)" explanation out of the cell** — a tooltip on the
   Refresh item, or at most a small `v2` badge on the row. **Never body copy in a
   table.**
3. **Merge Report + Subject into one column**, stacked. Frees ~200 px.
4. **Drop or de-emphasise Settings.** `1 mi · 12 mo · ±30% size` is identical on every
   row and useless for scanning — hover, or the detail view.
5. **Make the row clickable** to open the report.

1 and 2 remove the scroll. 3 and 4 take rows to a single line — roughly 15 reports per
screen instead of 6.

**And the five near-duplicate `1358 5th St` profiles make the table look broken.**
They are not a bug: the claim key normalises punctuation so all five collapse to one
key, `GET /for-property` warned each time, and an operator proceeded. **Show the
re-run relationship** — group them under the property rather than listing five
sibling rows. Do not dedupe by hiding rows; each one was paid for and appears on an
invoice.

---

## Standing rules that apply

`COMP_DOCUMENT_FIELDS` before the layout reads a comp field · Edit tool, not shell
heredocs · mutate every guard until it goes red · commit the script behind any number
· fixtures from real stored payloads · a local render is evidence about the renderer
· `npm run verify` does not bundle, so read a Vercel failure as signal.
