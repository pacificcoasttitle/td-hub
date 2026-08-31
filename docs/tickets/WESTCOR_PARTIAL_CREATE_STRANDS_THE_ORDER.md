# A partly-accepted Westcor order strands the file, and every retry is refused

**Status: OPEN. Not fixed — the fix mutates vendor state and needs a live call
to verify.**
Opened: 2026-09-01
Found: diagnosing the order 6142 CPL failure.

## What happens

Westcor's Order/Update can **partly succeed**. It creates the file, then
rejects one name inside it. We treat the whole call as a failure, and the
record of the file we just created is lost.

Order 6142 / `20020090-GLT`, all three attempts, 2026-09-01:

```
03:58  generate_cpl  FAILED  Seller #2: Not Added. Please provide at least a
                             Company Name and/or First and Last Name…
04:05  generate_cpl  FAILED  HTTP 500 — Agent Number - Order Number Must be Unique.
04:16  generate_cpl  FAILED  HTTP 500 — Agent Number - Order Number Must be Unique.
```

The first attempt is the trust-seller regression, fixed in
`fix(cpl): a trust needs a CompanyName, not just a Trust field`.

**The second and third are the actual trap.** Westcor kept the order from
03:58. Our side kept nothing.

## Why the retry cannot work

`vendor_api_logs` for order 6142 holds **three rows, all `generate_cpl`,
all failed**. No `create_order` row exists, because Step A threw and the
handler logs one failure row for the whole flow.

`lookupExistingTvid` (`westcor/client.ts:76`) reads `create_order` rows with
`success = true`. With none, it returns `null`, so `createOrUpdateOrder` issues
a CREATE rather than an UPDATE — and Westcor refuses, because the agent file
number is already taken by the order it made at 03:58.

Every future attempt on this file takes the same path. **The trust fix alone
does not unstick it**: the payload is now valid, and the create is still a
duplicate.

## Blast radius

Small, and that is the only good news:

- **2 orders** have a failed `generate_cpl` and no recorded tvid.
- **3 orders** have already hit `Must be Unique`: **48, 49, 6142**. 48 and 49
  are early test files; 6142 is a live one.

The exposure grows with every partial failure, and partial failures are
exactly what the new preflight is designed to prevent — so this should stay
rare. It is not self-healing, though. Each one strands a file permanently.

## The shape of the fix — not chosen yet

Three options, in rough order of preference:

1. **Log Step A whenever Westcor returns an order, success or not.** The tvid
   is in the response body even when a name is rejected; we discard it because
   we throw first. Recording it makes the retry an UPDATE and the file
   recovers by itself. Smallest change, closest to the actual defect.

2. **Look the order up by `agent_file_number` before creating.** More robust —
   it recovers files stranded before any fix ships, including 6142 — but it
   adds a vendor round trip to every CPL.

3. **Treat `Must be Unique` as a signal to switch to update.** Recovers from
   the error rather than avoiding it. Least attractive: it reacts to a message
   string, which is the sort of thing that changes without warning.

(1) prevents new cases. Only (2) rescues the three that already exist.

## Why this is not being fixed in the same change

Every option writes to a vendor record we do not own, and none can be verified
without a live Westcor call against a real file. That is a mutation with an
audit trail at the underwriter, so it wants a decision rather than a guess —
particularly on 6142, which is a live order and not a test file.

## For tomorrow morning

**Order 6142 cannot be retried through the modal**, even after the trust fix
deploys. It needs one of the options above, or a manual resolution with
Westcor for that file number.

## Related

- `docs/tickets/CPL_WHAT_WE_DO.md` — the four-hop flow this sits inside.
- The same change that found this added the built buyer and seller names to
  the `generate_cpl` failure log. Without it this diagnosis needed the builder
  re-run against live data, because a positional rejection ("Seller #2") is
  unreadable without the array it counts into.
