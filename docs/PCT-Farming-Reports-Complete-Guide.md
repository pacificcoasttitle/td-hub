# Farming Reports Complete Specification

**Pacific Coast Title Company**

Internal playbook. Every page, field, formula, input file, name collision, delivery path, and known limitation for the three sales-farming PDFs generated from Transaction Desk.

Prepared 17 September 2026. Audience: sales leadership, marketing, and engineering.

| Report | What it is |
| --- | --- |
| **01 — Sales Activity Report** | Area snapshot, 3 / 6 / 12 month |
| **02 — Carrier Route Analysis Report** | Farm Area Analysis / EDDM |
| **03 — County Sales Report** | County home-sale activity by city |

Companion files: [HTML](PCT-Farming-Reports-Complete-Guide.html) · [PDF](PCT-Farming-Reports-Complete-Guide.pdf)

---

## Contents

1. [Name map, access, and shared production pipeline](#contents-and-name-map)
2. [01 — Sales Activity Report (Sales Snapshot)](#01--sales-activity-report)
3. [02 — Carrier Route Analysis Report (Farm Area Analysis)](#02--carrier-route-analysis-report)
4. [03 — County Sales Report (County Home Sale Activity)](#03--county-sales-report)
5. [Delivery, storage, sales-rep dashboard, and contacts](#delivery-storage-and-the-sales-dashboard)
6. [Appendix A — CSV contracts and file names](#appendix-a--csv-contracts--copy-these-headers-exactly)
7. [Appendix B — Implementation notes](#appendix-b--implementation-notes--do-not-spare-these-either)
8. [Appendix C — Side-by-side](#appendix-c--side-by-side--what-each-report-will-and-will-not-answer)

---

## Contents and name map

The product does not use one name per report. The listing on a sales representative’s Farming Reports page, the admin screen title, the PDF masthead, and the email subject all disagree. Use this map first or the rest of the document will look contradictory.

### Canonical name map

| This document | Farming Reports listing | Admin screen | PDF masthead | Route |
| --- | --- | --- | --- | --- |
| Sales Activity Report | `Sales Activity` | Sales Snap Shot | SALES SNAPSHOT — 3 / 6 / 12 MONTH OVERVIEW | `/sales-snap-shot` |
| Carrier Route Analysis Report | `FAR Report` | Farm Analysis · Create F.A.R | FARM AREA ANALYSIS — EDDM CARRIER ROUTES | `/reports` |
| County Sales Report | `County Report` | County Activity | `{County} County Home Sale Activity` | `/sales-activity-report` |

> **Name collision.** The class named `SalesActivityReport` generates the **County Sales Report**, not the Sales Activity Report. The listing label `Sales Activity` is applied to snapshot rows in `SalesReport_model::getSalesAllReportData()`. Email subjects reverse the same confusion: snapshot send uses “Sales Snapshot Ready!”; county send uses “Sales Activity Report Ready!”.

### Who can create them

All three generators sit behind the same gate. The session user must exist and `is_master` must equal `1`. Anyone else is redirected to `/dashboard`. Only active sales representatives (`is_sales_rep = 1` and `status = 1` on `pct_softpro_lookup_table`) can be branded onto a PDF.

### Shared production pipeline

1. Master user uploads a CSV and fills the screen-specific options.
2. CodeIgniter validates required posts and required column headers (exact names, case-sensitive).
3. A parent row is inserted. For carrier-route reports, child rows are inserted, then deleted after the PDF is built.
4. HTML is rendered from a dedicated view and converted with Snappy / wkhtmltopdf.
5. The PDF is uploaded to S3, the local file is deleted, and `report_url` is stored.
6. The PDF can be downloaded from the generator screen, emailed to the branded sales representative, and appears on that representative’s Farming Reports list.

---

## 01 — Sales Activity Report

A one-page leave-behind that compresses a farm or city into six headline averages plus a month-by-month price table. Internally this is the Sales Snapshot. On the representative’s Farming Reports list it is typed **Sales Activity**.

| | |
| --- | --- |
| **Purpose** | Show an agent what sold, at what price, and how price per foot moved over the last 3, 6, or 12 calendar months. |
| **Audience** | Listing and buyer agents. Handed over in person or emailed from the snapshot screen. |
| **Page count** | Always one Letter page. The 3 / 6 / 12 variants change the header line and the number of month rows, not the layout grammar. |

### What the PDF actually says

**Letter page anatomy**

1. **Masthead.** *SALES SNAPSHOT*, then *3 MONTH OVERVIEW* / *6 MONTH OVERVIEW* / *12 MONTH OVERVIEW*, then the free-text Area Name exactly as typed (example: Santa Monica).
2. **Six metric tiles** in two rows of three, each with an icon.
3. **Month-by-month table** — one row per month in the lookback, newest month first.
4. **Footer.** Circular sales-rep photo (if `sales_rep_report_image` is set), full name, title, phone, email. No PCT customer-service block on this report.

### Headline metrics — every number on the page

| Tile | Label on PDF | Source fields | Exact formula | Display |
| --- | --- | --- | --- | --- |
| 1 | Total {Property Type} Sales | Count of kept CSV rows | `count(records)` | Integer |
| 2 | Avg. Sales Price | Purchase Price | `sum(price) / count(records)` | $ with thousands separators, no cents |
| 3 | Avg. Price Per Sqft | Purchase Price, Building Size | `sum(price) / sum(building_size)` | $ integer |
| 4 | Avg. Beds | Bedrooms | `sum(beds) / count(records)` | One decimal |
| 5 | Avg. Baths | Baths | `sum(baths) / count(records)` | One decimal |
| 6 | Absentee % | Owner Occupied | `100 × count(owner_occupied == 'n') / count(records)` | Two decimals + % |

> Property Type (SFR, Condo, 2-4 Units, 5 Units & Up) is written into the first tile as *Total SFR Sales* and stored on the parent row. **It is not used to filter the CSV.** Whatever rows survive the month filter are averaged, regardless of type.

### Month-by-month columns

| Column | How it is built |
| --- | --- |
| MONTH BY MONTH | Full month name and year for each month in the lookback, e.g. *August - 2026*. The array is reversed so the most recent month is the first table row. |
| AVG. SALES PRICE | Mean purchase price of rows whose purchase-date month number equals that lookback month. $ integer. Zero if no rows. |
| AVG. $ SQFT | Sum of purchase price ÷ sum of building size for that month. $ integer. Zero if no rows. |
| PRICE % CHANGE | Percent change of that month’s avg $/sqft versus the *previous lookback month* (older month), not versus the same month last year. Oldest lookback month is hard-coded to `0.00`. Displayed to three decimal places. |

```
price_change[k] = 100 * (avg_psf[k] - avg_psf[k-1]) / avg_psf[k-1]
oldest month in the lookback: price_change = 0.00
then monthly_data is reversed for the table
```

### How the lookback is selected

The form posts `month_option` as `3`, `6`, or `12`. The engine walks backward that many months from “now” and collects the month numbers (01–12). A CSV row is kept only when `date('m', strtotime(Purchase Date))` is in that set.

| Option | PDF header | Template | Stylesheet | Rows in table |
| --- | --- | --- | --- | --- |
| 3 | 3 MONTH OVERVIEW | `three_month_pdf.php` | `sales-snap-shot/style.css` | 3 |
| 6 | 6 MONTH OVERVIEW | `six_month_pdf.php` | `sales-snap-shot/style_6.css` | 6 |
| 12 | 12 MONTH OVERVIEW | `twelve_month_pdf.php` | `sales-snap-shot/style_12.css` | 12 |

> **Year is not part of the keep-rule.** A 3-month run in September keeps month numbers for June, July, and August from *any year* present in the CSV. A 12-month run keeps every month number, so the year on the Purchase Date is ignored entirely. The template picker compares against `'03'` / `'06'` / `'12'` with loose equality, so the form values `3` and `6` still match in PHP. Do not change those comparisons to `===` without also changing the form values.

### Worked example

Three kept sales in the current lookback: $1,200,000 / 1,600 sqft / 3 bed / 2 bath / Owner Occupied Y; $980,000 / 1,200 / 2 / 2 / N; $1,150,000 / 1,450 / 3 / 2.5 / Y.

| Metric | Value |
| --- | --- |
| Total sales | 3 |
| Avg sales price | $1,110,000 |
| Avg $ / sqft | $783 (3,330,000 ÷ 4,250) |
| Avg beds | 2.7 |
| Avg baths | 2.2 |
| Absentee | 33.33% (1 of 3 is N) |

If June $/sqft is $760 and July is $783, July PRICE % CHANGE is `100 × (783 − 760) / 760 = 3.026%`.

### Screen and required inputs

| Field | Required | Values | What it does |
| --- | --- | --- | --- |
| CSV file | Yes | `.csv` | Source of every numeric tile |
| Area Name | Yes | Free text | Printed under the overview line; used in the S3 file name |
| Sales Representative | Yes | Active reps | Photo, name, title, phone, email on the footer; recipient of Send |
| Month Option | Yes | 3 / 6 / 12 | Lookback length and which HTML template is intended |
| Property Type | Posted, not validated empty | SFR · Condo · 2-4 Units · 5 Units & Up | Label only: “Total SFR Sales” |

### Required CSV columns — exact headers

| Header (must match exactly) | Used? | Treatment |
| --- | --- | --- |
| APN / Parcel Number | Validated only | Must exist on row 1 or import is rejected. Never printed. |
| Bedrooms | Yes | Summed into Avg. Beds |
| Baths | Yes | Summed into Avg. Baths |
| Building Size | Yes | Denominator for $/sqft |
| Owner Occupied | Yes | Lowercased. Only the single character/word `n` counts as absentee / rental. |
| Purchase Price | Yes | Must be numeric after CSV parse. Used in every dollar metric. |
| Purchase Date | Yes | `strtotime` then month number. Unparseable dates become empty months and drop out of the keep-set. |

Any extra columns are ignored. Extra rows with a missing required header on the first data row fail the whole file: *Column not found : …*

### Owner Occupied rules in full

- Value is forced to lowercase before compare.
- Absentee tile = share of rows equal to `n`.
- `N`, `n`, and ` n ` after typical CSV trim all count. `No`, `NO`, `false`, `0`, blank, and `Y` do *not* count as absentee.

### Empty-set risk

If the CSV has rows but none fall in the lookback month numbers, `count($records)` is 0 and the average formulas divide by zero. The parent row may already have been inserted. Do not upload a file whose purchase dates sit outside the selected window.

### Create, store, send

| Step | Detail |
| --- | --- |
| Success flash | Sales Snap shot Created. |
| Local path then delete | `uploads/sales-snap-shot/{filename}` |
| S3 key | `sales-snap-shot/{filename}` |
| File name | `{area_name}_{unixTime}_{reportId}.pdf` |
| PDF options | Letter page size. No extra zoom. |
| Listing columns | Date · Sales Rep · Area Name · Download + Send |
| Send endpoint | `POST /send-sales-snap-shot-email` with `key=snapshot-email` |
| Email subject | Sales Snapshot Ready! |
| Email body | Header image · “Snap Shot! Details Below” · “Attached you will find copies of the snapshot documents” · orange Download Document button |
| From | Pacific Coast Title Company / `FROM_EMAIL` |

### Database — `pct_sales_snap_shot_report`

| Column | Type / notes |
| --- | --- |
| id | Primary key, used in the PDF file name |
| sales_rep | FK-style integer to `pct_softpro_lookup_table.id` |
| month_option | String, max 10. Stores 3, 6, or 12 |
| property_type | String, max 100, nullable. SFR / Condo / 2-4 Units / 5 Units & Up |
| area_name | String, max 100 |
| report_url | S3 object name only, max 100, filled after upload |
| added_by | Master user who ran the import. Listing is filtered to this user |
| created_at / updated_at | Timestamps |

No child table. Individual sales are not retained after PDF generation. The listing type on Farming Reports is hard-coded `"Sales Activity"`; the “Input Options” cell shows `{month_option} & {area_name}`.

### Code map

| Role | Path |
| --- | --- |
| Controller | `application/modules/frontend/controllers/SalesSnapShot.php` |
| Model | `application/modules/frontend/models/SalesSnapShot_model.php` |
| Create UI | `application/modules/frontend/views/salesSnapShot/list.php` |
| PDF 3 / 6 / 12 | `views/salesSnapShot/three_month_pdf.php`, `six_month_pdf.php`, `twelve_month_pdf.php` |
| Email | `views/salesSnapShot/snapshot_email_template.php` |
| CSS | `assets/frontend/css/sales-snap-shot/style.css`, `style_6.css`, `style_12.css` |
| Icons | `assets/sales_snap_shot/report.png`, `Price.png`, `home.png`, `Bed.png`, `Bath.png`, `Rent.png` |
| Routes | `sales-snap-shot`, `sales-snap-shot/(.+)`, `send-sales-snap-shot-email` |
| Migrations | `20240514060929_add_property_type_snap_shot_report.php`, `20240715042953_optimize_sales_snap_shot_report.php` |

### How a representative should use the page with an agent

- Lead with Total Sales and Avg. Sales Price — that is the market-size sentence.
- Use Avg. Price Per Sqft when the agent’s listing is smaller or larger than the average home in the farm.
- Use Avg. Beds / Baths to sanity-check pricing against the typical floor plan, not against the whole county.
- Absentee % is the investor / non-owner conversation. Pair it with the carrier-route NOO tile when both reports are run on the same farm.
- Walk the PRICE % CHANGE column from the bottom (oldest, always 0%) upward. That is the only momentum story this report tells.
- Do not call the first tile a type-filtered count unless the CSV was already filtered before upload.

### What this report does not do

- No median, no min, no max, no price bands, no DOM, no list-to-sale ratio.
- No map, no street list, no APN list (APN is required in the file and then discarded).
- No year-over-year comparison. Change is sequential month-to-month inside the lookback only.
- No county selector. Geography is whatever the CSV and the Area Name claim it is.

---

## 02 — Carrier Route Analysis Report

A one-page EDDM farm sheet. The admin screen is Farm Analysis. The button elsewhere says Create F.A.R. The Farming Reports list types it **FAR Report**. The PDF says **FARM AREA ANALYSIS / EDDM CARRIER ROUTES**.

| | |
| --- | --- |
| **Purpose** | Rank USPS carrier routes in one named area and spotlight the single best route on each of six farming metrics. |
| **Audience** | Agents choosing Every Door Direct Mail routes or deciding which streets to walk. |
| **Page count** | One Letter page. Exactly ten table rows. Highlight tiles use the maximum among those ten, not the whole file. |

### What the PDF actually says

**Letter page anatomy**

1. **Hero.** Photo wash (Santa Barbara coastline asset) with *FARM AREA ANALYSIS*, orange rule, *EDDM CARRIER ROUTES*, and the PCT wordmark + large-flat postal symbol.
2. **Area line.** `AREA: | {area_name}`.
3. **Six highlight tiles** in a 3×2 grid. Each tile is the winning route for one metric among the top 10.
4. **Table.** *TOP 10 CARRIER ROUTES | BY {SORT LABEL}*.
5. **Footer.** Rep photo, name, title, phone, email, plus Customer Service (866) 724-1050 \| cs@pct.com.

### Highlight tiles — every number

| Tile | Color class | Metric | Winner rule | Route printed |
| --- | --- | --- | --- | --- |
| HIGHEST TURNOVER RATIO | green | `turnover_rate` + % | Max T.O.% in the top 10 | That route |
| HIGHEST NON-OWNER | purple | `NOO_ratio` + % | Max NOO % in the top 10 | See warning — currently prints the turnover-rate route |
| LONG AVG YR OWNED | aqua | `avg_yr_owned` | Max years owned | That route |
| MOST UNITS | red | `total_units` | Max unit count | That route |
| MOST SALES | blue | `total_sales` | Max sale count | That route |
| AVG. SALES PRICE ALL | gold | `avg_price` | Max average price, then compacted to K / M / B / T | That route |

> In `report_pdf.php` the HIGHEST NON-OWNER tile prints `$box_data['turnover_rate']['route']`, not `$box_data['NOO_ratio']['route']`. The purple number is the correct NOO percentage; the route under it can be the wrong route. Treat the table, not that tile caption, as the source of truth for which route is highest NOO.

### Average-price compaction

```
while value >= 1000: value = value / 1000, bump unit
units = ['', 'K', 'M', 'B', 'T']
display = round(value, 1) + unit
example: 1,250,000 → 1.3M
```

### Top 10 table — every column

| PDF column | CSV / DB field | Sort-form label | Display |
| --- | --- | --- | --- |
| Route | `carrier_route` + `sa_site_zip` | Route | See hyphenation rules below |
| Avg. $ | `avg_price` | Avg. $ | $ + `number_format`, no cents |
| #Of Sales | `total_sales` | #of Sales | Raw number |
| NOO % | `NOO_ratio` | NOO % | Raw number, no extra % sign in the cell |
| Avg. Y.O. | `avg_yr_owned` | Avg. Y.O. | Raw number |
| # of Units | `total_units` | # of Units | Raw number |
| T.O.% | `turnover_rate` | T.O.% | Raw number |

### Sort order

The user picks one sort key. The engine orders matching child rows `ORDER BY {sort_by} DESC` and keeps `LIMIT 10`. The table title restates the choice in uppercase using the labels above: *TOP 10 CARRIER ROUTES | BY AVG. $*.

Allowed `sort_by` keys: `carrier_route`, `avg_price`, `total_sales`, `NOO_ratio`, `avg_yr_owned`, `total_units`, `turnover_rate`.

> Highlight tiles are computed *after* the top-10 cut. A route that is #14 on sales but #1 on turnover never appears in HIGHEST TURNOVER RATIO if the sort was “#of Sales”. If you need the true area champion for a metric, sort by that metric.

### How a route ID is printed — `separateZipRoute()`

Carrier-route extracts often glue ZIP and route together (`904031C001`). The helper inserts a hyphen.

1. Trim both the mixed value and the ZIP.
2. If the ZIP string occurs inside the mixed value, insert `-` immediately after the ZIP: `904031C001` + ZIP `90403` → `90403-1C001`.
3. If the ZIP is not found and the mixed value is longer than 5 characters, insert `-` four characters from the end: `904031C001` → `90403-1C001`.
4. Otherwise print the mixed value unchanged.

### Worked example

Ten routes sorted by turnover. Route `90403-C001` has T.O.% 8.4, NOO 41, avg years 11.2, 420 units, 19 sales, avg price $1,840,000. If those are the maxima in the top 10:

- Green tile: 8.4% · ROUTE: 90403-C001 · HIGHEST TURNOVER RATIO
- Gold tile: 1.8M · ROUTE: 90403-C001 · AVG. SALES PRICE ALL
- Table first row: 90403-C001 · $1,840,000 · 19 · 41 · 11.2 · 420 · 8.4

### What the metrics mean in the field

| Metric | Farming read |
| --- | --- |
| T.O.% | How fast the route turns. High turnover is listing inventory and expired-listing conversation. |
| NOO % | Non-owner occupancy. High NOO is investor / absentee outreach, not just owner-occupant farming. |
| Avg. Y.O. | Long tenure. Equity and “have you thought about selling” conversation. |
| # of Units | Mailing cost and door-knock size. This is the EDDM volume number. |
| #Of Sales | Recent liquidity. Pair with the snapshot’s Total Sales for the same streets. |
| Avg. $ | Price band for the route. Compacts on the tile; full dollars in the table. |

### Screen and required inputs

| Field | Required | What it does |
| --- | --- | --- |
| CSV file | Yes | One row per carrier route |
| Area Name | Yes | Printed after AREA:. Placeholder on the form: “What Area?” |
| Sales Representative | Yes | Footer identity. Photo is omitted if the remote image check fails |
| Sorting Order | Yes | Which metric defines “top 10” |

### Required CSV columns — exact headers

| Header | Stored | Printed | Notes |
| --- | --- | --- | --- |
| carrier_route | Yes | After hyphenation | Often ZIP+route concatenated |
| avg_price | Yes | Yes | Double |
| turnover_rate | Yes | Yes | T.O.% |
| total_sales | Yes | Yes | Double in schema, used as a count |
| NOO_ratio | Yes | Yes | Header is case-sensitive. `noo_ratio` fails import |
| avg_yr_owned | Yes | Yes | |
| total_units | Yes | Yes | EDDM piece count |
| sa_site_zip | Yes | Used to hyphenate Route | First data row’s ZIP is also copied onto the parent as `zip_code` |
| sa_site_city | Yes | No | Required, stored on the child, never appears on the PDF |

### Create, store, discard

1. Insert parent `pct_sales_rep_report`.
2. Insert every CSV row into `pct_sales_rep_report_records`.
3. Select top 10 by sort key descending.
4. **Delete all child rows for that report_id.** After this point the system cannot rebuild the PDF from the database.
5. Render `report/report_pdf.php`, write `uploads/sales-rep/pdf/{time}_{id}.pdf`, upload to S3 prefix `sales-rep/pdf`, delete local file, save `report_url`.

| Item | Value |
| --- | --- |
| Success flash | Report Created. |
| File name | `{unixTime}_{reportId}.pdf` |
| Listing on generator | Date · Sales Rep · Zipcode · Download. No Send button on this screen |
| Farming Reports type | FAR Report · options cell is `{sort_by} & {area_name}` |
| S3 URL pattern | `{AWS_PATH}sales-rep/pdf/{report_url}` |

### Sales-rep profile used on the footer

First name, last name, title, email, phone, and `sales_rep_report_image`. The image is shown only when `checkRemoteFile(AWS_PATH + image)` returns true (HTTP HEAD succeeds). The same photo is edited under `/reports/sales_rep/{id}` — JPG/PNG/JPEG, 12 MB max, stored under S3 prefix `sales-rep/`.

### Database — `pct_sales_rep_report`

| Column | Notes |
| --- | --- |
| sales_rep | Originally FK to `customer_basic_details`; runtime join is `pct_softpro_lookup_table` |
| zip_code | Copied from the first CSV row’s `sa_site_zip` only. Later rows in other ZIPs are still eligible for the top 10 |
| sort_by | One of the seven keys |
| area_name | Added in migration 2021-06-03 |
| report_url | Added in migration 2021-05-11 |
| added_by | Master user; generator listing is scoped to this user |

### Database — `pct_sales_rep_report_records` (transient)

| Column | Type |
| --- | --- |
| report_id | Integer, ON DELETE CASCADE |
| carrier_route, sa_site_zip, sa_site_city | String |
| avg_price, turnover_rate, total_sales, NOO_ratio, avg_yr_owned, total_units | Double |

Expect this table to be empty for completed reports. It exists as a scratch pad during import.

### Code map

| Role | Path |
| --- | --- |
| Controller | `application/modules/frontend/controllers/Report.php` |
| Model | `application/modules/frontend/models/Report_model.php` |
| Create UI | `application/modules/frontend/views/report/list.php` · title Farm Analysis |
| PDF | `application/modules/frontend/views/report/report_pdf.php` |
| CSS | `assets/frontend/css/report/style.css` |
| Hero art | `assets/media/reports/Santa-Barbara-USA-taken-in-2015.jpg`, `Large-Flat-Symbol.png` |
| Helper | `separateZipRoute()`, `checkRemoteFile()` in `application/helpers/common_helper.php` |
| Routes | `reports`, `reports/(.+)` |
| Migrations | `20210510054303_create_table_sales_rep_report.php`, `20210510061001_create_table_sales_rep_report_records.php`, `20210511132138_add_report_url_to_sales_rep_report.php`, `20210603100742_add_area_name_to_sales_rep_report.php`, `20240715043031_optimize_sales_rep_report.php` |

### What this report does not do

- No map of routes, no street list, no unit-level mailing file. Labels are a separate tool (`/labels`).
- No city printed even though `sa_site_city` is required.
- No email Send on the Farm Analysis listing (unlike snapshot and county).
- No computation of T.O.%, NOO, or averages — those arrive pre-computed in the CSV. Transaction Desk only ranks and formats.

---

## 03 — County Sales Report

A multi-page city grid of last-month SFR and condo volume and price for one county. The admin screen is County Activity. The class is `SalesActivityReport`. The Farming Reports list types it **County Report**. The PDF title is **{County} County Home Sale Activity**.

| | |
| --- | --- |
| **Purpose** | Give an agent a county-wide scoreboard: how many SFRs and condos sold in each city, and at what average price. |
| **Audience** | Agents who work a whole county, plus branch conversations about where volume sits this month. |
| **Page count** | One Letter page per 30 cities, alphabetical, with a page break between chunks. A 67-city county is 3 pages. |

### What each PDF page actually says

**Letter page anatomy — repeated on every page**

1. **Left rail (33%).** Building photograph, then a full-height orange bar with vertical type: *RECENT SALES / {MONTH} / {YEAR}*. Month is the selected report month. Year is `date('Y')` at generation time, not a year from the CSV.
2. **Logo.** PCT sales-activity wordmark, right-aligned.
3. **Title.** *{County} County Home Sale Activity*.
4. **Subtitle, fixed copy.** “This report includes resale of single family residences, condos, and new homes.”
5. **Grid.** Header row SFR’s | Condos (grey), then City | # Sold | Median $ | # Sold | Median $ (navy).
6. **Footer.** Rep photo, name, title, phone, email · Customer Service (866) 724-1050 \| cs@pct.com · Open Orders openorders@pct.com.

### Grid columns — every number

| Column | Source | Actual math | Display |
| --- | --- | --- | --- |
| City | CSV `Site City` | Group key, left-aligned | Exact city string from the file |
| SFR’s # Sold | Rows whose Property Type, trimmed and lowercased, is `rsfr` | Count | Integer, 0 if none |
| SFR’s Median $ | Those rows’ Purchase Price | **Arithmetic mean**, rounded to 2 decimals then displayed as $ integer | $1,234,567 |
| Condos # Sold | Property Type `rcon` | Count | Integer |
| Condos Median $ | Those rows’ Purchase Price | **Arithmetic mean**, same rounding | $ integer |

> The PDF says Median $. The code computes the mean: `array_sum(prices) / count(prices)`, then `round(..., 2)`. A city with sales at $800k, $900k, and $2.1M prints $1,266,667, not the true median $900k. Do not brief an agent that these are medians until the label or the math is changed.

### How rows become a city line

```
records[Site City][strtolower(trim(Property Type))][] = { property_type, purchase_price }

if key == 'rsfr': SFR count = n, SFR $ = mean(prices)
if key == 'rcon': Condo count = n, Condo $ = mean(prices)
any other type (rnew, r2-4, vacant, …): stored then discarded
cities sorted with ksort() — A to Z, case-sensitive PHP key order
chunked array_chunk(..., 30, true) — 30 cities per page, keys preserved
```

### Property Type contract — this is the whole filter

| CSV value after trim + lowercase | Lands in |
| --- | --- |
| `rsfr` | SFR’s columns |
| `rcon` | Condos columns |
| `sfr`, `SFR`, `Single Family`, `condo`, `Condo`, `RCON` without becoming `rcon` | Dropped. `RCON` → `rcon` works. `Condo` → `condo` does not. |

The subtitle promises “resale of single family residences, condos, and new homes.” New-home rows are not recognized unless they are coded `rsfr` or `rcon`. There is no third column for new construction.

### Supported counties

| Form value | PDF title | File-name code `COUNTRY_CODE` |
| --- | --- | --- |
| Los Angeles | Los Angeles County Home Sale Activity | LA |
| Orange | Orange County Home Sale Activity | OC |
| Riverside | Riverside County Home Sale Activity | RV |
| San Bernardino | San Bernardino County Home Sale Activity | SB |
| San Diego | San Diego County Home Sale Activity | SD |
| Ventura | Ventura County Home Sale Activity | VC |

County is a form selector, not a CSV column. The file is trusted to already be that county. There is no county-field validation against the rows.

### Paging example

Orange County file with 52 distinct Site City values: page 1 cities 1–30, page 2 cities 31–52. Each page reprints the orange Recent Sales rail, the logo, the county title, the full five-column header, and the footer. The last page does not carry an extra blank break.

### Worked example — one city

Irvine rows: three `rsfr` at $1,100,000, $1,250,000, $1,400,000; two `rcon` at $720,000 and $780,000; one `RNEW` at $1,900,000.

- SFR # Sold = 3 · SFR $ = $1,250,000
- Condo # Sold = 2 · Condo $ = $750,000
- The new-home row never appears and does not move either average.

### Screen and required inputs

| Field | Required | Values |
| --- | --- | --- |
| CSV file | Yes | Must include Site City, Purchase Price, Property Type |
| Month | Yes | January–December, stored as 1–12. Printed as the word on the orange rail. *Not* used to filter CSV dates. There is no purchase-date column at all. |
| Sales Representative | Yes | Footer + Send recipient |
| County | Yes | The six Southern California counties above |

> Month is a label. If you upload March closings and select February, the rail will say February and the year will be this year. Filter the extract before upload.

### Required CSV columns — exact headers

| Header | Used as |
| --- | --- |
| Site City | Grouping key and left column. Spelling variants become separate cities (“La Habra” vs “LA HABRA”). |
| Purchase Price | Must be numeric. Currency symbols or commas depend on the CSV reader; send clean numbers. |
| Property Type | Must collapse to `rsfr` or `rcon` to count. |

### Create, store, send

| Item | Value |
| --- | --- |
| Success flash | Sales Activity Recorded. |
| PDF options | Letter, Snappy zoom 1.24 |
| Local then delete | `uploads/sales-activity/{filename}` |
| S3 prefix | `sales-activity/` |
| File name | `{LA\|OC\|RV\|SB\|SD\|VC}_{FirstName}_{Month}_{Year}_{id}.pdf` — example: `OC_Maria_August_2026_1842.pdf` |
| Listing columns | Date · Sales Rep · Month · County · Download + Send |
| Send | Same endpoint as snapshot: `POST /send-sales-snap-shot-email` with `key=activity-email` |
| Email subject | Sales Activity Report Ready! |
| Email body | “Sales Activity!” · Download Document button · `activity_email_template.php` |

### How a representative should use the page with an agent

- Start at the agent’s city. # Sold is the liquidity sentence; $ is the price-band sentence.
- Compare SFR vs Condo in the same city when the agent is choosing a product type to farm.
- Scan neighboring cities for leakage — buyers who will not stay inside one city line.
- Do not add the SFR and Condo counts and call it “all sales.” Other property types were dropped.
- Pair with the Sales Activity (snapshot) report when the agent wants beds, baths, $/ft, and absentee mix for one city rather than the whole county grid.
- Pair with Carrier Route Analysis when the next question is “which USPS route inside that city.”

### Database — `pct_sales_activity_report`

| Column | Notes |
| --- | --- |
| sales_rep | Integer to lookup table |
| month | String 1–12, max 10 after optimize migration |
| county | Added 2024-04-22, max 50 |
| report_url | S3 object name, max 100 |
| added_by | Master user; generator listing scoped here |
| created_at / updated_at | Timestamps. Farming Reports date column uses this |

No child table. City lines are not recoverable from the database after the PDF is built. Farming Reports type is hard-coded `"County Report"`. The options cell shows the month word and the county name.

### Code map

| Role | Path |
| --- | --- |
| Controller | `application/modules/frontend/controllers/SalesActivityReport.php` |
| Model | `application/modules/frontend/models/SalesReport_model.php` |
| Create UI | `application/modules/frontend/views/salesReport/list.php` · title County Activity |
| PDF | `application/modules/frontend/views/salesReport/sales_activity_report.php` |
| Email | `application/modules/frontend/views/salesReport/activity_email_template.php` |
| Art | `assets/frontend/images/sales_activity_building.png`, `sales_activity_logo.png` |
| County codes | `COUNTRY_CODE` in `application/config/constants.php` |
| Routes | `sales-activity-report`, `sales-activity-report/(.+)` |
| Migrations | `20240405074056_create_table_sales_activity_report.php`, `20240422053343_add_county_in_sales_activity.php`, `20240715043240_optimize_sales_activity_report.php` |

### What this report does not do

- No date filter, no year selector, no comparison to prior month.
- No median despite the column title.
- No beds, baths, sqft, owner-occupancy, or carrier route.
- No unincorporated / “Unknown” rollup unless the CSV already coded it as a Site City.
- No county total row and no grand-total page.

### Recommended run order for a farm package

1. County Sales Report for the agent’s county and month — “here is the whole board.”
2. Sales Activity Report for the agent’s city or farm and property type — “here is the product mix and momentum.”
3. Carrier Route Analysis for the ZIPs inside that city, sorted by the metric the agent cares about (turnover for listings, NOO for investors, units for EDDM budget) — “here is where to mail.”

---

## Delivery, storage, and the sales dashboard

### How a sales representative sees finished work

Route `/sales-reports/{sales_user_id}` loads `SalesRep::salesReports()` (also mirrored on `EscrowProduction::salesReports()`). It calls `getSalesAllReportData()`, which unions the three tables, stamps the listing types, and sorts by `created_at` descending.

| Listing type | S3 folder | Options cell |
| --- | --- | --- |
| County Report | sales-activity/ | `{January…December} & {county}` |
| Sales Activity | sales-snap-shot/ | `{3\|6\|12} & {area_name}` |
| FAR Report | sales-rep/pdf/ | `{sort_by key} & {area_name}` |

Generator screens themselves only list reports `added_by` the current master user. A snapshot created by one master does not appear on another master’s Sales Snap Shot page, but it will appear on the branded representative’s Farming Reports page if the query is by `sales_rep`.

### Email path — both send buttons

| | Snapshot Send | County Send |
| --- | --- | --- |
| URL | `/send-sales-snap-shot-email` | `/send-sales-snap-shot-email` |
| key | snapshot-email | activity-email |
| To | The branded rep’s `email_address` | The branded rep’s `email_address` |
| Subject | Sales Snapshot Ready! | Sales Activity Report Ready! |
| Attachment | The public S3 URL is passed into `send_email()` as the file list | Same |
| CC | Hard-coded `piyush-crest@yopmail.com` | Same |
| Failure JSON | `Details missing` if email, url, or key is empty; otherwise `Email not sent, Try again later` | Same |

There is no Send control on Farm Analysis. FAR PDFs are download-only unless someone forwards the S3 link by hand.

### Shared chrome across the three generator screens

- Left rail: “Total List Ran” = sum of that report type’s counts for the current master user.
- Representatives list: first 10 by first name, with avatar or initials, email, phone, and that user’s count for this report type. “View All” goes to `/reports/sales_rep`.
- Jump links between County Activity, Sales Snap Shot, Create F.A.R, Create Concierge, Create Labels.
- Submit / Reset on every form. Flash error returns the previous POST via `_previous_data`.

### Contacts printed on PDFs

| Block | Where it appears | Copy |
| --- | --- | --- |
| Sales representative | All three | Name, title, phone, email, optional circular photo |
| Customer Service | Carrier Route + County | (866) 724-1050 \| cs@pct.com |
| Open Orders | County only | openorders@pct.com |

---

## Appendix A — CSV contracts — copy these headers exactly

### Sales Activity Report (snapshot)

```csv
APN / Parcel Number,Bedrooms,Baths,Building Size,Owner Occupied,Purchase Price,Purchase Date
123-456-789,3,2,1600,Y,1200000,2026-08-04
123-456-790,2,2,1180,n,980000,2026-07-19
```

Also collect, even though unused: any columns you need for your own QA. The importer will ignore them. Do not rename “APN / Parcel Number” — the slashes and spaces are part of the contract.

### Carrier Route Analysis Report

```csv
carrier_route,avg_price,turnover_rate,total_sales,NOO_ratio,avg_yr_owned,total_units,sa_site_zip,sa_site_city
904031C001,1840000,8.4,19,41,11.2,420,90403,Santa Monica
904032C004,1625000,6.1,11,28,14.0,310,90403,Santa Monica
```

### County Sales Report

```csv
Site City,Purchase Price,Property Type
Irvine,1250000,rsfr
Irvine,720000,rcon
Newport Beach,2100000,RSFR
```

`RSFR` survives because it lowercases to `rsfr`. `SFR` does not.

### File-name patterns at a glance

| Report | Pattern | Example |
| --- | --- | --- |
| Sales Activity | `{area}_{time}_{id}.pdf` | Santa Monica_1726588800_88.pdf |
| Carrier Route | `{time}_{id}.pdf` | 1726588901_44.pdf |
| County Sales | `{code}_{First}_{Month}_{Year}_{id}.pdf` | OC_Maria_August_2026_1842.pdf |

### Validation errors the user can actually see

| Condition | Flash |
| --- | --- |
| No sales rep | Please select Sales Representative |
| No area (snapshot / FAR) | Please Enter Area Name |
| No month (county) | Please Select Month |
| No county | Please Select County |
| No month option (snapshot) | Please select month option |
| No sort (FAR) | Please select Sorting Order |
| No file | Please select csv file |
| Missing header | Column not found : {comma list} |
| Insert failed | Please try again! |

---

## Appendix B — Implementation notes — do not spare these either

These are behaviors in the current code, not recommendations. Anyone regenerating a report or explaining a number to an agent needs them.

1. **Name collision is real.** `SalesActivityReport` = County PDF. Listing label `Sales Activity` = Snapshot PDF. Email “Sales Activity Report Ready!” = County send.
2. **Snapshot template picker uses loose equality** (`'3' == '03'` is true in PHP). The 3 / 6 / 12 views do select. A future `===` refactor would break 3- and 6-month PDFs unless the form is padded to match.
3. **Snapshot property type is a caption.** Filter the extract upstream if the tile must be honest.
4. **Snapshot month filter is month-of-year, not a date window.** June 2024 and June 2026 both count in a lookback that includes June.
5. **Snapshot absentee test is the letter n only.**
6. **Snapshot divides by count and by sum(sqft) with no guard.** Empty keep-set or zero building size will error.
7. **County “Median $” is a mean.**
8. **County month and year on the orange rail are not from the file.** Month is the dropdown. Year is today.
9. **County only scores `rsfr` and `rcon`.** Everything else is silent loss.
10. **County city sort is `ksort`.** ASCII puts uppercase before lowercase, so “Yorba Linda” sorts above “anaheim”. Normalize city case in the extract.
11. **FAR child rows are deleted after render.** There is no replay without the original CSV.
12. **FAR zip_code on the parent is first-row-only.** A multi-ZIP file still ranks all rows; the listing Zipcode column can look wrong.
13. **FAR HIGHEST NON-OWNER route caption uses the turnover winner’s route.**
14. **FAR computes “highest” with `>`**, so ties keep the first top-10 row in sort order, not an alphabetical route.
15. **FAR city is required and then hidden.**
16. **Send CC is a yopmail address.** Every successful Send also goes there.
17. **Photo on County PDF** uses `AWS_ENABLE_FLAG` to pick AWS vs local. Photo on FAR PDF uses `checkRemoteFile`. Photo on Snapshot PDF prints if the path is non-empty, without the remote HEAD check.
18. **Access is master-only.** Ordinary sales users cannot upload; they only download from Farming Reports.
19. **Snappy zoom is 1.24 on County, default on the others.** County type will look larger relative to the Letter frame.
20. **`SalesSnapShot` index references `$this->report_js_version`** while the property is `$js_version`. JS cache-busting on that screen is undefined-property behavior.

---

## Appendix C — Side-by-side — what each report will and will not answer

| Question an agent asks | Sales Activity | Carrier Route | County Sales |
| --- | --- | --- | --- |
| How many sold? | Yes — one area, one lookback | Yes — per route, top 10 only | Yes — per city, SFR and condo split |
| What did they sell for? | Mean price and mean $/ft | Mean price per route | Mean price labeled Median, by city and type |
| Is price moving? | Yes — month-to-month $/ft % | No | No |
| Typical beds / baths? | Yes | No | No |
| Owner vs absentee / investor? | Absentee % (Owner Occupied = n) | NOO % per route | No |
| Which USPS route should we mail? | No | Yes — that is the report | No |
| How big is the mail drop? | No | # of Units | No |
| How fast does the farm turn? | Implied only via sale count | T.O.% and Avg. Y.O. | Implied only via # Sold |
| How does this city sit vs the rest of the county? | No — one area name | No — one area name | Yes — every city on the grid |
| SFR vs condo split? | Only if the CSV was pre-filtered; tile is a label | No | Yes — two column groups |
| Brand / leave-behind polish | Snapshot tiles + month table | Hero + six color tiles + top 10 | Orange Recent Sales rail + city grid, multi-page |

### Sources this document was built from

Controllers `SalesSnapShot.php`, `Report.php`, `SalesActivityReport.php`; models `SalesSnapShot_model.php`, `Report_model.php`, `SalesReport_model.php`; PDF views `three_month_pdf.php`, `six_month_pdf.php`, `twelve_month_pdf.php`, `report_pdf.php`, `sales_activity_report.php`; listing views under `salesSnapShot/`, `report/`, `salesReport/`, and `order/sales_report.php`; helper `separateZipRoute()`; constant `COUNTRY_CODE`; routes in `application/config/routes.php`; Phinx migrations cited on each report’s code-map page. No sample transaction files were opened.
