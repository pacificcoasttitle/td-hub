# Concierge — MyNHD hazard preview (opt-in, like the TitlePoint tax page)

**Gerard, 12 Oct 2026:** add a third-party report to Concierge as a modal opt-in, the way
TitlePoint tax works. Vendor documentation is beside this file:
`MyNHD-Preview-API-integration-guide.html`.

**Three questions must be answered before building.** See the bottom.

---

## What the vendor provides

MyNHD's **Preview API** returns a one-page flood-and-fire hazard **preview** for a
property, as base64 PNG or PDF, plus an `order_link` where the customer can order the
full Natural Hazard Disclosure report.

| | |
|---|---|
| Base URL | `https://api.mynhd.com` |
| Auth | `POST /getAuthorizationHeader`, form field `secretkey` (not JSON) → `{ token }`. **24-hour expiry.** Bearer on every preview call |
| Re-auth signal | `401` with `tryReAuth: true` → get a new token, retry once |
| No permission | `403` — the account needs preview access from MyNHD |
| Image preview | `POST /report/getMultiFloodFirePreview/image` → `{ success, image_data, order_link }` |
| PDF preview | `POST /report/getMultiFloodFirePreview/pdf` → `{ success, pdf_data, order_link }` |
| Search by APN | `{ search: "apn", apn, county: "<5-digit FIPS>", state: "CA" }` |
| Search by address | `{ search: "address", address, city, state, zip }` |
| Server-only | CORS forbids browser calls. Secret stays on the backend |

**The trap, same as SiteX's 300:** a multi-match is **HTTP 200** with
`{ success: false, code: "multi_result" }`. A preview is successful only when the HTTP
status is 2xx **and** `success === true`. Error responses do not always carry `success`
or `code`; read `error`.

The base64 fields are plain base64 — no `data:` prefix.

There is also an older `POST /report/getMultiFloodFirePreview` that returns URLs
(`pdf_url`, `img_url`, `ffprevorderlink`). Do not use it; the `/image` and `/pdf`
endpoints return the bytes with the matching `order_link` in one response.

---

## Design — follows the tax bridge exactly

Read `docs/ui-proofs/v6/CONCIERGE_V6_BUILD_DECISIONS.md` section 3 and `tax-bridge.ts`
first. Everything there applies.

**Runs after the profile exists, by APN + FIPS.** Never inside the paid generate. The
profile's SiteX payload supplies both, and an APN cannot multi-match — so the
`multi_result` case should never fire on this path, but it is still handled, because
"should never" is not a guard.

**PNG, not PDF.** A PNG drops into `profile-document.tsx` as an `<Image>` on its own
page. A PDF would need stitching with another library. Measure the PNG's pixel
dimensions on the first real response before committing to a layout — a preview sized
for a web page may be too soft for print.

**Opt-in control in the cost gate**, beside the tax control, with the same shape:
label, what it adds, what it costs (see question 1), runs after delivery, adds a page
free when it lands.

**Row action** for existing profiles, same as tax — "add hazard preview" on a profile
that has none.

**Idempotency:** `scopedClaimKey(key, 'nhd')`. One profile, one preview, two clicks
must not buy two.

**Durability:** the same sweeper that finishes tax (`fetched` → rendered) finishes
this. No post-response promises.

**Token cache:** one token per 24 hours, stored server-side, refreshed on `401 +
tryReAuth`. Not fetched per request.

**Vendor logging:** `vendor_api_logs`, operation `mynhd_preview`, with the response
`success`/`code`/`error` fields structured — not a clipped body string. The SiteX 300
investigation lost the candidate count to a 400-character truncation.

**Storage:** the PNG goes to S3 under the profile; the `order_link` and the vendor's
own identifiers go on the profile row. Store `success`, `code` and `error` from the
response so a refused preview can be explained months later.

**Page:** a new sheet after the plat map — band, section bar, the image filling the
page, one footnote. Omitted entirely when absent, like page 4 and page 8. The page
numbering already counts real sheets.

**Guards:** the standing ones — fixtures from the first real response, mutate until
red, `Edit` not heredocs, commit the script behind any number. Plus: a test that an
HTTP 200 with `success: false` is not treated as a preview.

**Secret:** `MYNHD_SECRET_KEY` in Vercel env. Never in chat, never in a commit, never
in a log line.

---

## Decisions — Gerard, 12 Oct 2026

**1. No cost to PCT.** So: the control in the cost gate **defaults ON**, labelled as
free. It is not a spender — `routes.test.ts` keeps its two named spenders and this
route is asserted *not* to be one. No charge recording. The claim key still applies
(one preview per profile; a vendor call is a vendor call even when free).

**2. It is labelled a preview.** Page copy, verbatim:

> **Natural hazard preview** — provided by MyNHD.
> This is a preview of flood and fire hazard zones for this property. It is not a
> Natural Hazard Disclosure. A full disclosure report is a separate document.

**3. PCT does not resell NHD reports.** Ordering is entirely the homeowner's own
choice. The `order_link` is therefore included **as a plain footnote line, not a
button and not branded** — *"A full report can be ordered directly from MyNHD at
<link>."* — so the homeowner has it if they want it and PCT is visibly not in the
transaction. If Gerard would rather it not appear at all, that is one line to remove.
