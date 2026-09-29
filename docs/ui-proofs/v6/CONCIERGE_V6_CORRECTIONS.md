# Concierge Profile — make the PDF match v6

**Transcribed from `Concierge-v6-BUILD-CORRECTIONS.pdf` (in this folder), 29 Sep 2026,
written against `1358-5th-Street-Current.pdf`.** The PDF is the authority; this file
exists so the spec is greppable and survives worktree moves. Read the PDF for the
visual reference.

**This supersedes `CONCIERGE_V6_BUILD_DECISIONS.md` wherever the two disagree** —
that file was written before the v6 design was available and several of its calls
were wrong. Two exceptions are noted at the bottom.

---

## 1 · Why it doesn't look like v6

1. **It was restyled from v3, not rebuilt from v6.** The file header still reads
   `design: Concierge Property Profile v3`. v3's parts were kept — `Head` title +
   lede sentence, grey-filled `KV` rows, `Tile` grids, `Absent` boxes, a navy footer
   bar — and given v6's fonts. **v6 has none of those parts.**
2. **Pixels were used as points.** v6 is 816 px wide; a letter PDF is 612 pt. **Every
   v6 number must be multiplied by 0.75.** The map was set to 250 pt when it should
   be 187.5 pt, which is why page 6 overflowed and the criteria were moved to page 8.
3. **Code comments overrode settled decisions** — price per sq ft source, the
   disclaimer wording, the "Assessment data only" box, and the sentence ledes. Each
   is reversed in section 4.
4. **v6's own error, already fixed:** v6 page 4 showed PAID badges on the
   installments, which breaks the no-payment-status rule. Removed from v6 and from
   the package copy.

**The fix:** delete `Head`, `KV`, `Tile`, `Absent`, the `s.bar` and `s.footBar`
styles, and the `FILL` row pattern. Rebuild all eight pages from the six parts in
section 2, in the order in section 3. **Keep all the data logic as it is** —
`derive.ts`, `resolveTaxLayer`, `pagesFor`/`pageNo`, the status masking, the
homeowner's-only exemption, and the fonts.

---

## 2 · The six parts, in points

v6 values × 0.75. **H = Montserrat, W = Work Sans. Side margin is 42 pt on every
page** (the code has 40).

**Band** (pages 2–8) — height 93, NAVY, padding 0 42. Behind it, the cover photo in
greyscale at 20% opacity; react-pdf has no CSS filter, so bake it into a PNG asset.
Left: eyebrow `CONCIERGE PROPERTY PROFILE` H700 7.5, ORANGE, letterSpacing 1.2 ·
address H800 18, white, marginTop 7 · city · APN in W 9.4, white at 80%, marginTop 3.
Right: white logo at height 23. **No title or lede under the band.**

**SectionBar** — background `#EDF0F4`, borderLeft 2.25 ORANGE, padding 9. Uppercase
text in H700 9.75, NAVY, letterSpacing 0.8. This is every section heading, e.g.
`OWNER, ADDRESS & LEGAL DESCRIPTION`. **It replaces both `Head` and the eyebrow.**

**Row** — white background, **no fill**. borderBottom 0.75 `#E6E9EE`, padding
3.75 7.5, text W 9.75. **Label in W700 ORANGE**, column width 112.5; value in W500
ink `#1A1F28`. The 4-column variant (112.5 / 1fr / 112.5 / 1fr) has a MUTED W500
second label. A missing value prints `—` in `#8A94A3`.

**NavyStrip** — NAVY, paddingVertical 9 (7 on page 6), 4 equal cells, each with
padding 0 12 and borderLeft 0.75 white at 18%. Label H700 7.5 ORANGE, letterSpacing
1. Value H800 14.25 white, marginTop 4.

**StatBox** — background `#F6F7F9`, borderTop 2.25 in a type colour, padding 9 10.5,
marginRight 7.5 (never gap). Number H800 18 NAVY; label H800 8.6 MUTED. Type
colours: deed NAVY · mortgage `#4A6FA5` · release/assignment `#8A94A3` ·
foreclosure ORANGE.

**Footer** — **not a navy bar.** White, borderTop 0.75 BORDER, padding 10.5 42,
W 7.9 MUTED. Left: *"Data deemed reliable, but not guaranteed. Pacific Coast Title
Company. All rights reserved."* Right: `n of N`. **Remove `SiteX Title Profile_144 ·
Template v3` from the page**; keep the template version in the row metadata only.
Pages 2–8 only; the cover has no footer.

**Body:** paddingTop 19.5 below the band, 15 between sections, **one footnote line
per page** in W 8.25 MUTED (`— means the item was not included in the county record
we received.`).

---

## 3 · Page by page

| Page | Remove | Build |
|---|---|---|
| **1 Cover** | Top bar, 320 pt photo or map with an address band, white panel with a small title, the orange rule, the footer | Full-bleed photo 471 tall (fallback `#2A3A5C`, **never the comp map**). Logo top-right at 22.5/42, height 23. A navy block overlaps the photo by 72: width 560, height 241.5, padding 29 42. Inside it: `CONCIERGE PROPERTY PROFILE` H700 11.25 ORANGE, letterSpacing 2 · address H800 30 white · city H 18.75 white at 82%. Under it, a `#222A48` panel 530 wide that fills to the bottom edge, two columns: `PREPARED FOR` / `PRESENTED BY` (W700 8.25 `#046744`), name W700 14.25 white, line W 10.5 white |
| **2 Thank you** | Three paragraphs written in code, the `DISCLAIMER pending / not for external distribution` box, the signature rule | paddingTop 67.5, max width 420. `Thank you` H800 22.5 NAVY, then an orange rule 36×2.25 (margins 13.5 / 22.5). v6's three paragraphs in W 11.25, lineHeight 1.7, 13.5 apart. Sign-off: *"On behalf of Pacific Coast Title Company,"* MUTED · rep name W700 13.5 NAVY · email · phone |
| **3 Details** | Lede sentence, `THE HOUSE` / `THE LAND` columns, legal tiles, owner tiles, last-sale tiles, "house covers", market value, FIPS | Three sections. **Owner, address & legal:** primary and secondary owner, site address, mailing address · APN / county / tract / lot · census tract / page grid · brief legal. **Beds, baths & sq ft** (4 columns): beds / year built · baths / sq ft · garage / lot size · pool / zoning, then property type. **Most recent transfer:** recording date / document # · sale amount / document type. Then the footnote |
| **4 Tax** | Lede, the grey `Assessment data only` box, assessment tiles, the installment table with a "Late after" column, the "share of assessed value" and "assessed year" tiles | SectionBar `PROPERTY TAX · year`, then a NavyStrip: annual tax · tax year · tax rate · TRA. **Installments:** two StatBoxes, each with label, amount H800 16.5, and `Due date`, **no status and no "late after"**. **Assessed value:** a 9 pt bar split land NAVY / improvements `#4A6FA5`, then rows for land, improvements, total (bold NAVY value) and homeowner's exemption. **Special assessments & bonds:** a table with columns issued for / payable to / matures. The supplemental note goes in a `#F6F7F9` box with a NAVY left rule, then the "as of" footnote. **On the SiteX-only layer, render the same parts, leave out the sections that have no data, and put the reason in the footnote line instead of a box** |
| **5 Transfers** | Lede, a two-column date list, the vesting row in solid navy | SectionBar. A navy card: `CURRENT VESTING` W700 8.25 ORANGE, owners H700 12.75 white · right side `Deed · date` W700 11.25 · `Document # … · held N years`. Four StatBoxes. **One full-width table**, newest first, with columns RECORDED (W700) / DOCUMENT # / TYPE (6 pt dot in the type colour) / flag. The header row is ORANGE W700 8.25 over a 1.5 NAVY rule. Foreclosure rows get a `#FEF3EC` background and `SEE NOTE`; the vesting row gets `#EEF2F8` and a navy `CURRENT OWNERS` chip. Then the note box, then the footnote. For histories over ~16 rows, let the table break to a continuation page with the band repeated |
| **6 Comp summary** | Lede, tiles, the per-comp list with "nearest" and "highest sale" tags, and a 250 pt map | paddingTop 12. SectionBar + **map at 187.5**. SectionBar + NavyStrip: sales · median sale · median $/sq ft · sold. Then a LOW / MEDIAN / HIGH table (the median column filled `#EEF2F8`) for sale price, $/sq ft, living area, beds, baths, year built, lot size. **Criteria of search goes back on this page:** five small StatBoxes (value H800 11.25), then `25 returned → 5 met → 5 shown · Criteria were not loosened to show more` |
| **7 Comps** | A heading sentence and label/value tile stacks for each comp | SectionBar, then one bordered card per comp, 10.5 apart. Row 1 is headers on `#F6F7F9`: No. / Date sold / Sale price / Sq ft / $/sq ft / Beds / Baths / Yr built / Distance (ORANGE W700 8.6). Row 2 is values (W 9.4, the price bold) on the left and land use on the right. Then the footnote |
| **8 Plat** | `Parcel map and sources`, a 300 pt map, the criteria tiles, the sources list | SectionBar `PLAT MAP · APN …`, then the map filling the rest of the page (`flexGrow`, `objectFit: contain`) on `#F3F5F8`. Nothing else. With no map, the footnote line says why |

---

## 4 · Decisions the code overrode — reverse them

**The disclaimer is not missing.** The wording is on v6 page 2, taken from the
Stonybrook customer sample. Set `INSURANCE_DISCLAIMER` to those two paragraphs and
**delete the "not for external distribution" box** — that box is currently printing
on customer PDFs. (Gerard's instruction to remove it and v6 agree.)

**Price per sq ft = sale price ÷ living area**, for the subject and for every comp.
The comment refusing to calculate it goes. The footnote reads *"Price per sq ft is
the sale price divided by living area."* **See the caveat at the bottom of this file
before implementing.**

**No lede sentences.** *"A single-family home built in 1949, assessed at…"* and
*"Four sales, all within…"* are not in v6. Section bars carry the structure.

**Explainer boxes become one footnote line.** This covers "Assessment data only",
"Book and page references…" and the installment-halving note.

**Letterspaced eyebrows are not styled that way in v6.** `T H E   H O U S E` in the
extracted text shows the tracking is too wide. Section bars use 0.8 pt tracking.

---

## 5 · Checklist

Re-render the stored payload through `POST /render` — **no credit** — and compare
page by page against v6.

---

## Carried forward from `CONCIERGE_V6_BUILD_DECISIONS.md`

Two items in that file were not design calls and still stand:

- **Section 3 — the TitlePoint tax pipeline.** Billable, opt-in, default off,
  background, never inside the paid generate; tax-only spend for an existing
  profile; two named spenders in `routes.test.ts`; idempotency on property + tax;
  per-vendor charge recording; timeouts treated as already paid.
- **Section 7 — the standing rules.** `COMP_DOCUMENT_FIELDS` first, Edit tool not
  shell heredocs, mutate every guard until it goes red, commit the script behind any
  number, fixtures from real stored payloads.

## One caveat to raise before implementing

**Price per sq ft.** `concierge_comps.price_per_sqft` carries the annotation
*"SiteX's own figure. Never recomputed from BuildingArea — that was the legacy
bug."* The stored payload also carries **two building areas** (786 and 793), so a
computed figure depends on which one is divided by, and the two sources disagree
(supplied 469 vs computed 469.5 on the subject).

Reverting to computation is what v6 asks for and it is Gerard's document, so build
it — but **pick one building area explicitly, name it in the code, and delete the
stale annotation** rather than leaving two contradictory instructions in the
repository. If the comps case is what the annotation was really guarding, say so
there.
