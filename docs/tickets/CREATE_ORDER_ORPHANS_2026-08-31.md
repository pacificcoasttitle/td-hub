# Create-order orphans — 2026-08-31 / 2026-09-01

**Status: listed, keep/cancel called, repair script ready. SoftPro cancel is a human action.**
Opened: 2026-09-01 after PR #80.

Two defects, both now closed in code (#80 timeout recover + this morning's
varchar / 200-then-hub-insert-fail treatment). This ticket is the orphan
handoff — not chat.

**Do not measure the create tail a week early.** The agreed report-back is
the create-time tail after a week on the 120s ceiling.

**This week's duplicate total is eleven files across the two causes**
(varchar overflow + 60s create abort): four varchar duplicates + seven
timeout duplicates.

There is no SoftPro cancel/void API in the app. Do not invent one. Rows
marked **operator cancels in SoftPro Select** stay a human action.

Invite off. No TESSA. No AddDocuments re-POST. Repair writes only after
this ticket and `scripts/audit/repair-create-order-orphans.ts` are on a
merged commit. The script is an explicit keep list (7 files, hard limit 50).

---

## Case study — 56320 Bonanza Dr (Aileen's screenshot)

One screenshot, both defects, three SoftPro files.

- Timeout made three SoftPro orders: **20021701-GLT keep**, 20021702 and
  20021703 cancel.
- The mangled entity seller is the same file: **D & B REAL ESTATE
  INVESTMENT LLC** (hub/client split it before #80 classified entities).
- Hub 701 has buyers (Chakraborty) and escrow (Escrow Studio / Emily Chen).
  SoftPro sync never wrote a seller party on the hub row.

---

## 1. Timeout / 60s abort — eleven files (last night into this morning)

SoftPro created the file after we aborted. Hub later grew a `softpro_sync`
shell. Create logs for these are `NETWORK` / "aborted due to timeout" — no
payload to rebuild from. Property on the keep rows came from SoftPro sync.

Times are Pacific.

### Cancel in SoftPro Select (keep the first of each set)

| File | Verdict | Address | Client / escrow | Opened (PT) | Repair |
|---|---|---|---|---|---|
| 20021681-GLT | **Cancel** (keep 680) | 4020 Josephine St, Lynwood | Vision Escrow Group / MEJIA | Aug 31 6:20pm | none — do not repair |
| 20021685-OCT | **Cancel** (keep 684) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:56pm | none |
| 20021686-OCT | **Cancel** (keep 684) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:58pm | none |
| 20021687-OCT | **Cancel** (keep 684) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 7:00pm | none |
| 20021696-GLT | **Cancel** (keep 695) | 82639 Crest Ave, Indio | Autumn Skye Escrow | Aug 31 10:37pm | none |
| 20021702-GLT | **Cancel** (keep 701) | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:46am | none |
| 20021703-GLT | **Cancel** (keep 701) | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:52am | none |

### Keep / repair

| File | Verdict | Address | Client / escrow | Opened (PT) | Hub | What repair needs |
|---|---|---|---|---|---|---|
| 20021676-GLT | **Keep** (single) | 2570 Rudder Avenue, Port Hueneme | Ethos Escrow Inc. / LAWRENCE ANTHONY ZERO | Aug 31 5:05pm | 8162, sync shell, county Ventura, no TitlePoint | TitlePoint only. Property already on the sync row. |
| 20021680-GLT | **Keep** (first of Josephine) | 4020 Josephine St, Lynwood | Vision Escrow Group / MEJIA, ELIAPSAR | Aug 31 5:41pm | 8163, **already `canceled` on hub**, county Los Angeles | Operator must un-cancel 680 and cancel 681 in SoftPro Select — the keep/cancel is inverted on the hub today. Script will not touch a canceled row. |
| 20021683-OCT | **Cancel** (updated) | 15181 Jackson St, Midway City | Annexe Escrow / Tam Truong, Hung Ta | Aug 31 6:43pm | 8166, sync shell | Listed as a timeout single before the varchar seven were proven. Same address as 669/679. Keep-first is **669**. Operator cancels 683. Do not repair. |
| 20021684-OCT | **Keep** (first of Trailway) | 21975 Trailway Ln, Lake Forest | Vanguard Escrow, Inc. | Aug 31 6:49pm | 8167, sync shell, county Orange, no TitlePoint | TitlePoint only. |
| 20021695-GLT | **Keep** (first of Crest) | 82639 Crest Ave, Indio | Autumn Skye Escrow | Aug 31 10:33pm | 8178, sync shell, county Riverside, no TitlePoint | TitlePoint only. |
| 20021701-GLT | **Keep** (first of Bonanza) | 56320 Bonanza Dr, Yucca Valley | Escrow Studio | Sep 1 8:36am | 8184, sync shell, county San Bernardino, no TitlePoint | TitlePoint only. Seller entity is still missing locally — do not invent it here. |

---

## 2. Varchar / SoftPro-200-then-hub-property-fail — seven files

**No committed list of seven named files was found** in PRs (Aug 31–Sep 1),
`docs/tickets/`, agent transcripts, or `fix/create-persist-after-softpro-200`
(that branch has no unique commits). The persist worktree is empty of a
repair script.

These seven are every hub order since 2026-08-31 20:00 UTC with **no
`order_properties` row**. Each has a successful SoftPro `create_order` 200
in `vendor_api_logs`, a `manual_entry` hub order, and parties (from later
enrich). That is the createLocalRecords shape: order insert succeeds,
property insert fails, parties arrive later. Do not treat this as a named
list recovered from chat — it is what the logs prove.

`createLocalRecords` is not transactional. Property insert is the step that
throws on a varchar overflow (`order_properties.property_type` is
varchar(50); SiteX types run longer). The logged SoftPro payloads themselves
do not carry a property type.

Keep-first of each address set. Four of the seven are duplicates, which is
how this week's duplicate total reaches eleven.

| File | Verdict | Address | Client / escrow | Opened (PT) | Hub | What repair needs |
|---|---|---|---|---|---|---|
| 20021662-OCT | **Keep** (first of Rex) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. / D Cara, Steven G Quinn | Aug 31 4:04pm | 8145, no property, no TitlePoint | Property from logged create payload (county Shasta / APN 074-070-012-000), then TitlePoint. |
| 20021663-OCT | **Cancel** (keep 662) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. | Aug 31 4:07pm | 8146, no property | Operator cancels in SoftPro Select. Do not repair. |
| 20021669-OCT | **Keep** (first of Jackson) | 15181 Jackson St, Midway City | Annexe Escrow / Tam Truong, Hung Ta | Aug 31 4:41pm | 8152, no property, no TitlePoint | Property from logged payload (county Orange / APN 107-151-44 / legal present), then TitlePoint. |
| 20021675-GLT | **Keep** (single) | 6154 Whittier Blvd, Los Angeles | American Plus Escrow | Aug 31 4:59pm | 8158, no property, no TitlePoint | Property from logged payload (county Los Angeles / APN 6339-019-014), then TitlePoint. 20021692-GLT is a later sync row at the same address — not in either named set; no verdict invented. |
| 20021677-OCT | **Cancel** (keep 662) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. | Aug 31 5:31pm | 8159, no property | Operator cancels in SoftPro Select. Do not repair. |
| 20021678-OCT | **Cancel** (keep 662) | 18556 Rex Ln, Redding | Hacienda Escrow Corp. | Aug 31 5:33pm | 8160, no property | Operator cancels in SoftPro Select. Do not repair. |
| 20021679-OCT | **Cancel** (keep 669) | 15181 Jackson St, Midway City | Annexe Escrow | Aug 31 5:38pm | 8161, no property | Operator cancels in SoftPro Select. Do not repair. |

---

## Repair path (reuse, do not invent a second rebuild)

Live create already persists through `createLocalRecords`
(`src/lib/domain/orders/create-order.ts`). The property row is
`buildOrderPropertyValues` — same function the repair script calls via
`attachMissingOrderProperty`. Payload mapping is
`propertyFromSoftProCreatePayload` (Country → county; no SiteX re-fetch).

TitlePoint is `autoTriggerTitlePoint`, the same post-local-records path hub
create uses. County required. Confirmation / invite is not enqueued.

There was no this-morning repair script to copy. This is that script:
`scripts/audit/repair-create-order-orphans.ts`. `--apply` writes. Default
is dry-run.

**Keep list the script will touch:** 662, 669, 675, 676, 684, 695, 701.

**Not in the script:** 663, 677, 678, 679, 680 (canceled on hub), 681, 683,
685, 686, 687, 696, 702, 703.

---

## SoftPro cancel

No cancel/void API is used in-app. Operator cancels in SoftPro Select:

- 20021663, 677, 678 (Rex)
- 20021679, 683 (Jackson — 683 was the timeout "single" before 669 was found)
- 20021681 (Josephine) — and **un-cancel 680** if 680 is the keep
- 20021685, 686, 687 (Trailway)
- 20021696 (Crest)
- 20021702, 703 (Bonanza)
