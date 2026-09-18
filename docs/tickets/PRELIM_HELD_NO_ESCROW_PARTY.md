# 17 held prelims have no escrow party at all

**Opened:** 2026-09-18 · **Status:** logged, not a delivery fix

## The class, in one sentence

> A prelim held `blocked_no_recipient` because the order has **no escrow
> officer and no `escrow_company` party** — SoftPro was never asked, and
> nothing a retry can do will create a recipient.

This is a data gap on the order, not a delivery bug. The retry that
re-examines holds after enrich writes a party explicitly skips these and
writes `prelim_held_no_escrow_party` once per document so they do not sit
in the retry loop.

The other 51 of the 68 hub-resolve holds **did** gain a valid escrow
contact from enrich after they were held. Those are the retry. These 17
did not.

## The 17 (as of 2026-09-18)

All Title-only. None have `escrow_officer_id`. None have an
`escrow_company` party. Client, where present, is a listing/selling agent
or a private party — not an escrow firm.

| File | Source | Opened (UTC) | Client |
|---|---|---|---|
| 20020998-GLT | softpro_sync | 2026-08-12 | *(none)* |
| 20022049-OCT | manual_entry | 2026-09-10 | Laura Oliver / United Family Homes Foundation Inc |
| 20022095-OCT | manual_entry | 2026-09-10 | Brian Tran / HPT Realty |
| 20022149-OCT | manual_entry | 2026-09-12 | Brad Kessel / SoCal Pacific Realty |
| 20022155-OCT | manual_entry | 2026-09-14 | Lisa Adams / Distinctive Coast Properties, Inc. |
| 20022158-GLT | manual_entry | 2026-09-14 | Misael Vasquez / Century 21 All Stars |
| 20022170-OCT | softpro_sync | 2026-09-14 | *(none)* |
| 20022174-GLT | softpro_sync | 2026-09-14 | Anne Yang / Reliable Real Estate |
| 20022186-GLT | manual_entry | 2026-09-14 | Xochilt Esqueda / New Innovation Real Estate |
| 20022188-OCT | manual_entry | 2026-09-14 | Patty Hickok / Val-Chris Investments, Inc. |
| 20022208-GLT | softpro_sync | 2026-09-14 | *(none)* |
| 20022231-OCT | manual_entry | 2026-09-15 | Faith Wise / eXp Realty of Southern California, Inc |
| 20022242-GLT | manual_entry | 2026-09-15 | Abby Nava / The Agency |
| 20022270-GLT | manual_entry | 2026-09-15 | Jose Luna / Realty One Homelink |
| 20022289-OCT | manual_entry | 2026-09-16 | Terence Webster / Buchanon & Associates |
| 20022305-GLT | manual_entry | 2026-09-16 | Ronnie Diep / Ronnie Diep, Realtor |
| 20022315-GLT | manual_entry | 2026-09-16 | Ken Shah / Keller Williams Empire Estates |

Six of the 17 are inside the three-day age window (opened 15–16 Sep).
Even those cannot deliver until an escrow contact exists on the order.

## What this is not

- Not the three Green Forest files. Those had a hub address; SoftPro had
  none. Pre-send held them. The rule change that would have released
  them is off.
- Not the 51 that enrich later filled in. Retry those.

## Status

| Instance | Status |
|---|---|
| These 17 held prelims | open — need an escrow contact on the order |
| Any later hub-resolve hold with no party | the retry job logs `prelim_held_no_escrow_party` once and does not send |
