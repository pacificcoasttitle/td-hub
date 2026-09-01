# Create-order orphans — 2026-08-31 / 2026-09-01

**Status: keep/cancel adapted to SoftPro Select. Do not un-cancel.**
Opened: 2026-09-01 after PR #80. Ticket rewritten 2026-09-01 after Select
cancelled the first Josephine/Jackson files instead of the later twins.

Two defects, both now closed in code (#80 timeout recover + this morning's
varchar / 200-then-hub-insert-fail treatment). This ticket is the orphan
handoff — not chat. Keep/cancel below is **what Select actually did**, not
the original first-of-set proposal.

**Do not un-cancel.** 20021680-GLT and 20021669-OCT stay cancelled.
Revised keeps: **20021681-GLT** (Josephine) and **20021683-OCT** (Jackson).

**Do not measure the create tail a week early.** The agreed report-back is
the create-time tail after a week on the 120s ceiling.

**This week's duplicate total is eleven files across the two causes**
(varchar overflow + 60s create abort): four varchar duplicates + seven
timeout duplicates.

There is no SoftPro cancel/void API in the app. Do not invent one. Do not
reverse a Select cancel.

Invite off. No TESSA. No AddDocuments re-POST. Repair writes only after
this ticket and `scripts/audit/repair-create-order-orphans.ts` are on a
merged commit. The script is an explicit keep list (8 files, hard limit 50).

---

## Case study — 56320 Bonanza Dr (Aileen's screenshot)

One screenshot, both defects, three SoftPro files.

- Timeout made three SoftPro orders: **20021701-GLT keep**, 20021702 and
  20021703 still live in Select (originally slated to cancel; not repaired).
- The mangled entity seller is the same file: **D & B REAL ESTATE
  INVESTMENT LLC** (hub/client split it before #80 classified entities).
- Hub 701 has buyers (Chakraborty) and escrow (Escrow Studio / Emily Chen).
  SoftPro sync never wrote a seller party on the hub row.

---

## Select status as of 2026-09-01 (hub + SoftPro-sync)

Hub `operational_status` and `softpro_status` agree on every named file.

**Cancelled in Select** (both columns `canceled`):

| File | Address | Why it matters |
|---|---|---|
| 20021680-GLT | 4020 Josephine St, Lynwood | Original keep-first. Stays cancelled. Do not repair. Do not un-cancel. |
| 20021669-OCT | 15181 Jackson St, Midway City | Original keep-first. Stays cancelled. Do not repair. Do not un-cancel. |
| 20021679-OCT | 15181 Jackson St, Midway City | Confirmed cancelled. Jackson now has exactly one live file: **683**. |

**Live keeps** (both columns `in_process` / `inprocess`) — script touches only these eight:

| File | Address | Client / escrow | Opened (PT) | Hub | Repair |
|---|---|---|---|---|---|
| 20021662-OCT | 18556 Rex Ln, Redding | Hacienda Escrow Corp. / D Cara, Steven G Quinn | Aug 31 4:04pm | 8145 | Property + TitlePoint already (PR #81 apply). |
| 20021675-GLT | 6154 Whittier Blvd, Los Angeles | American Plus Escrow | Aug 31 4:59pm | 8158 | Property + TitlePoint already. 20021692-GLT is a later sync row at the same address — not in either named set; no verdict invented. |
| 20021676-GLT | 2570 Rudder Avenue, Port Hueneme | Ethos Escrow Inc. / LAWRENCE ANTHONY ZERO | Aug 31 5:05pm | 8162 | Property + TitlePoint already. |
| 20021681-GLT | 4020 Josephine St, Lynwood | Vision Escrow Group / MEJIA, ELIAPSAR / buyer Ana V Gonzalez | Aug 31 6:20pm | 8165, sync shell, county Los Angeles | **Revised Josephine keep.** Property already on the sync row. TitlePoint remaining. |
| 20021683-OCT | 15181 Jackson St, Midway City | Annexe Escrow / Tam Truong, Hung Ta | Aug 31 6:43pm | 8166, sync shell, county Orange | **Revised Jackson keep.** Only live Jackson file (669 and 679 cancelled). Property already on the sync row. TitlePoint remaining. |
| 20021684-OCT | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:49pm | 8167 | Property + TitlePoint already. |
| 20021695-GLT | 82639 Crest Ave, Indio | Autumn Skye Escrow | Aug 31 10:33pm | 8178 | Property + TitlePoint already. |
| 20021701-GLT | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:36am | 8184 | Property + TitlePoint already. Seller entity is still missing locally — do not invent it here. |

**Still live in Select, originally a cancel candidate, not repaired.** SoftPro
cancel remains a human action. The script must not touch these:

| File | Address | Opened (PT) |
|---|---|---|
| 20021663-OCT | 18556 Rex Ln, Redding | Aug 31 4:07pm |
| 20021677-OCT | 18556 Rex Ln, Redding | Aug 31 5:31pm |
| 20021678-OCT | 18556 Rex Ln, Redding | Aug 31 5:33pm |
| 20021685-OCT | 21975 Trailway Ln, Lake Forest | Aug 31 6:56pm |
| 20021686-OCT | 21975 Trailway Ln, Lake Forest | Aug 31 6:58pm |
| 20021687-OCT | 21975 Trailway Ln, Lake Forest | Aug 31 7:00pm |
| 20021696-GLT | 82639 Crest Ave, Indio | Aug 31 10:37pm |
| 20021702-GLT | 56320 Bonanza Dr, Yucca Valley | Sep 1 8:46am |
| 20021703-GLT | 56320 Bonanza Dr, Yucca Valley | Sep 1 8:52am |

---

## 680 vs 681 and 669 vs 683 — cancelled files have no unique work

Checked before repairing the revised keeps. Neither cancelled file carries
work the survivor lacks. Choice follows Select; it is not a data rescue.

**Josephine — cancelled 20021680-GLT vs live 20021681-GLT**

| | 680 (cancelled) | 681 (live keep) |
|---|---|---|
| Hub / SoftPro-sync status | canceled / canceled | in_process / inprocess |
| Documents / prelim / CPL | none | none |
| TitlePoint / notes / jobs | none | none |
| Property | 4020 Josephine St, Lynwood, LA, APN 6174-014-009, legal + owners | same |
| Parties | sellers Eliapsar / Yesmin; escrow Ada Ruiz / Vision; buyer **TBD TBD** | same sellers and escrow; buyer **Ana V Gonzalez** |

680 has nothing 681 lacks. 681 is the richer file (real buyer name).

**Jackson — cancelled 20021669-OCT vs live 20021683-OCT**

| | 669 (cancelled) | 683 (live keep) |
|---|---|---|
| Hub / SoftPro-sync status | canceled / canceled | in_process / inprocess |
| Documents / prelim / CPL | none | none |
| TitlePoint / notes / jobs | none | none |
| Property | none (varchar create-fail) | 15181 Jackson St, Midway City, Orange (no APN) |
| Parties | buyers Hung Ta / Tam Truong; escrow Elenor Savageau / Annexe | same buyers; escrow Kim Nguyen / Annexe |
| Other | create-path escrow# 7864-RE and deliverable recipient ae@annexescrow.com | escrow email already on the party row |

669 is strictly less (no property). Escrow# / deliverable row are create-path
metadata, not operator work. 679 is the same address, also cancelled, also
empty of documents / prelim / CPL / TitlePoint.

---

## 1. Timeout / 60s abort — eleven files (last night into this morning)

SoftPro created the file after we aborted. Hub later grew a `softpro_sync`
shell. Create logs for these are `NETWORK` / "aborted due to timeout" — no
payload to rebuild from. Property on the keep rows came from SoftPro sync.

Times are Pacific. Verdicts match Select, not the original first-of-set call.

| File | Verdict (Select) | Address | Client / escrow | Opened (PT) | Repair |
|---|---|---|---|---|---|
| 20021676-GLT | **Keep** (single) | 2570 Rudder Avenue, Port Hueneme | Ethos Escrow Inc. / LAWRENCE ANTHONY ZERO | Aug 31 5:05pm | already done |
| 20021680-GLT | **Cancelled in Select** | 4020 Josephine St, Lynwood | Vision Escrow Group / MEJIA, ELIAPSAR | Aug 31 5:41pm | none — do not un-cancel, do not repair |
| 20021681-GLT | **Keep** (Josephine survivor) | 4020 Josephine St, Lynwood | Vision Escrow Group / Ana V Gonzalez | Aug 31 6:20pm | TitlePoint only |
| 20021683-OCT | **Keep** (Jackson survivor) | 15181 Jackson St, Midway City | Annexe Escrow / Tam Truong, Hung Ta | Aug 31 6:43pm | TitlePoint only |
| 20021684-OCT | **Keep** (first of Trailway) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:49pm | already done |
| 20021685-OCT | Still live; originally cancel (keep 684) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:56pm | none |
| 20021686-OCT | Still live; originally cancel (keep 684) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:58pm | none |
| 20021687-OCT | Still live; originally cancel (keep 684) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 7:00pm | none |
| 20021695-GLT | **Keep** (first of Crest) | 82639 Crest Ave, Indio | Autumn Skye Escrow | Aug 31 10:33pm | already done |
| 20021696-GLT | Still live; originally cancel (keep 695) | 82639 Crest Ave, Indio | Autumn Skye Escrow | Aug 31 10:37pm | none |
| 20021701-GLT | **Keep** (first of Bonanza) | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:36am | already done |
| 20021702-GLT | Still live; originally cancel (keep 701) | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:46am | none |
| 20021703-GLT | Still live; originally cancel (keep 701) | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:52am | none |

---

## 2. Varchar / SoftPro-200-then-hub-property-fail — seven files

**No committed list of seven named files was found** in PRs (Aug 31–Sep 1),
`docs/tickets/`, agent transcripts, or `fix/create-persist-after-softpro-200`
(that branch has no unique commits). The persist worktree is empty of a
repair script.

These seven are every hub order since 2026-08-31 20:00 UTC with **no
`order_properties` row** at listing time. Each has a successful SoftPro
`create_order` 200 in `vendor_api_logs`, a `manual_entry` hub order, and
parties (from later enrich). That is the createLocalRecords shape: order
insert succeeds, property insert fails, parties arrive later.

`createLocalRecords` is not transactional. Property insert is the step that
throws on a varchar overflow (`order_properties.property_type` is
varchar(50); SiteX types run longer). The logged SoftPro payloads themselves
do not carry a property type.

Four of the seven are duplicates, which is how this week's duplicate total
reaches eleven.

| File | Verdict (Select) | Address | Client / escrow | Opened (PT) | Hub | Repair |
|---|---|---|---|---|---|---|
| 20021662-OCT | **Keep** (first of Rex) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. / D Cara, Steven G Quinn | Aug 31 4:04pm | 8145 | already done (property from logged payload, then TitlePoint) |
| 20021663-OCT | Still live; originally cancel (keep 662) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. | Aug 31 4:07pm | 8146 | none |
| 20021669-OCT | **Cancelled in Select** | 15181 Jackson St, Midway City | Annexe Escrow / Tam Truong, Hung Ta | Aug 31 4:41pm | 8152 | none — do not un-cancel, do not repair |
| 20021675-GLT | **Keep** (single) | 6154 Whittier Blvd, Los Angeles | American Plus Escrow | Aug 31 4:59pm | 8158 | already done |
| 20021677-OCT | Still live; originally cancel (keep 662) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. | Aug 31 5:31pm | 8159 | none |
| 20021678-OCT | Still live; originally cancel (keep 662) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. | Aug 31 5:33pm | 8160 | none |
| 20021679-OCT | **Cancelled in Select** | 15181 Jackson St, Midway City | Annexe Escrow | Aug 31 5:38pm | 8161 | none — confirmed cancelled; Jackson live count is 1 (683) |

---

## Repair path (reuse, do not invent a second rebuild)

Live create already persists through `createLocalRecords`
(`src/lib/domain/orders/create-order.ts`). The property row is
`buildOrderPropertyValues` — same function the repair script calls via
`attachMissingOrderProperty`. Payload mapping is
`propertyFromSoftProCreatePayload` (Country → county; no SiteX re-fetch).

TitlePoint is `autoTriggerTitlePoint`, the same post-local-records path hub
create uses. County required. Confirmation / invite is not enqueued.

Script: `scripts/audit/repair-create-order-orphans.ts`. `--apply` writes.
Default is dry-run. Idempotent: property already present and TitlePoint
already started are no-ops.

**Keep list the script will touch:** 662, 675, 676, **681**, **683**, 684,
695, 701.

**Not in the script:** 663, 669 (cancelled), 677, 678, 679 (cancelled),
680 (cancelled), 685, 686, 687, 696, 702, 703.

---

## SoftPro cancel

No cancel/void API is used in-app. Do not un-cancel 680 or 669.

Already cancelled in Select (hub + SoftPro-sync): **680, 669, 679**.

Still live; originally proposed as cancels; human action if they should go:

- 20021663, 677, 678 (Rex)
- 20021685, 686, 687 (Trailway)
- 20021696 (Crest)
- 20021702, 703 (Bonanza)
