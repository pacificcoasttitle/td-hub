# Open order pipeline rebuild — design

**Status: DESIGN, for approval. No code written.**
Opened: 2026-09-02
Supersedes the independent-clock arrangement of TitlePoint retrieval, document
generation, the confirmation email and the SoftPro upload.

---

## 1. What is verified, and what is assumed

Everything this design rests on was checked against source or production before
being written down. Stated here so the rest can be read without hedging.

### Verified from source

**TitlePoint never receives the SoftPro file number.** All five search calls
send it blank:

```
src/lib/integrations/titlepoint/client.ts:228, 251, 279, 299, 324
    'orderNo=&' +
```

The only use of `fileNumber` in that client is an archive key,
`lp-xml/${fileNumber}.xml` (`client.ts:941`) — local bookkeeping, exactly as the
brief states. **The premise holds: nothing TitlePoint needs comes from SoftPro.**

**The session-keyed path already exists.** `preInitiateSearches(property)`
(`pre-initiate.ts:25`) fires tax and LV against a `tp_api_id_*` session with no
order, and `linkSessionToOrder(sessionId, orderId, fileNumber)`
(`pre-initiate.ts:132`) binds them afterwards. Its own comment says the poll
loop *"parks at result_ready when no orderId"*.

**`initiateSearch(orderId, searchType, userId)`** (`service.ts:39`) takes an
order id first and loads the order and property from the database. This is the
coupling Phase A has to break.

**Grant deed needs only LV output.** `grant-deed.ts:20-21, 34-39` parses
`instrumentNumber` and `recordedDate` out of the LV result. Nothing from SoftPro.

### Verified from production

**The structural blocker is one column.**

```
documents.order_id          NOT NULL     <- the entire reason generation waits
title_point_data.order_id   nullable
title_point_data.session_id nullable
```

Searches can already run without an order. **Documents cannot be written without
one.** That single constraint is why generation is deferred to after submit.

**105 session searches are sitting at `result_ready` with no order** (plus 1
failed). Those are completed retrievals whose PDFs were never generated because
no order existed to hang them on.

**The submit gate.** `PRE_INIT_SUBMIT_GATE_MS = 45_000`
(`use-pre-init-on-sitex.ts:7`), polling every 1.5s. Measured across 68 sessions:
p50 to ready **5.8s**, and **21 of 68 (31%) never released early** — those
operators waited the full 45 seconds and submitted anyway.

**The verify step has never passed.** 14 rows in `title_docs_attach_verified`,
14 failures. `GetAttachedDocuments` has returned **0 of 1,029** non-empty reads
containing a name we uploaded. It is currently marking **57 documents across 20
orders** as unsynced while SoftPro's own reply — *"An item already exists by that
name"*, with `FileUploadedStatus: true` — says they are there.

### Corrected from the brief — and then corrected again

**The brief said 4 of 32. The first draft of this document said 9 of 32 and
called the brief wrong. The brief was right.**

The 9 included **five cancelled orphans** from the 2026-08-31/09-01 incident —
`20021663-OCT`, `20021669-OCT`, `20021677-OCT`, `20021678-OCT`,
`20021679-OCT`. All five are `operational_status: canceled` and
`softpro_status: canceled`, all five appear on the `CANCEL_FILES` list in
`scripts/audit/repair-create-order-orphans.ts`, and
`docs/tickets/CREATE_ORDER_ORPHANS_2026-08-31.md` says *"Do not un-cancel."*
They have no `order_properties` row because they were cancelled, not because
anything failed. Counting them as failures inflated the defect by 2x.

The live population:

```
live hub orders (7 days, excluding cancelled):  27
with no county:                                  4
with no TitlePoint:                              4      the same four
```

`20021653-GLT`, `20021658-GLT`, `20021664-GLT`, `20021668-OCT`.

**15% of live orders lose every title document.** Still the cheapest fix on the
list; it is a required field. But the number is 4 of 27, and any argument that
rests on a larger one is resting on cancelled files.

### The gate is three-way, and that is the real fix

`create-order.ts:342`:

```ts
} else if (input.property.address && input.property.state && county) {
```

**Any** of the three missing skips TitlePoint entirely, silently. County is one
door into the same hole; address and state are the others. And county itself has
two sources —

```ts
const county = input.property.county ?? sitexData?.county ?? '';
```

— so a SiteX failure or a no-match empties it just as effectively as a
multi-match, and the SiteX call is wrapped in
`catch { /* SiteX failure never blocks order creation */ }`.

So the fix is **not** "county required". It is: this branch records which input
was missing, and that reason is visible on the order. The required field on the
form is the entrance; the recorded reason is what stops the next silent skip
through a different door.

### The 105 parked sessions — investigated, zero repairs

53 sessions across 31 addresses, every one accounted for:

| Where the order ended up | Addresses | Repair |
|---|---:|---|
| Created in **legacy** (arrived via `softpro_sync`) | 13 | None — not our order |
| Created in the **hub** | 14 | None — all 14 complete, `tp=4 docs=3` |
| No order at all | 4 | None — abandoned |

**No order is missing documents because of a linking failure.**

Two findings fall out of it:

**Session churn — and it is now step 1.** 53 sessions for 31 addresses; 11
addresses have more than one, up to **5**. `buildPreInitAddressKey` is
`address|city|state|zip|apn`, recomputed on every keystroke, and the invalidation
effect in `use-quick-entry.ts:98-108` fires on each change. Every edit after a
match drops the session locally while the server-side searches keep running.

Today that wastes two searches per edit. **After Phase A moves generation
earlier it wastes two searches and three PDFs per edit** — an operator
correcting an address twice would generate nine documents for one order. That is
why this moves ahead of Phase A rather than being cleanup.

**13 addresses started in the hub and finished in legacy.** The order arrived
later via `softpro_sync`. `15181 Jackson St` fired five sessions and still went
to legacy. **No cause is inferred here** — Gerard is asking the team directly.
The measurement stays running so we can see whether it drops as things are
fixed.

### Assumed, and flagged as such

- ~~That the SiteX multi-match is the only producer of a missing county.~~
  **Resolved: it is not.** The gate is three-way and county has two sources.
  See "The gate is three-way" above.
- That generating a PDF needs nothing from the order row beyond the property.
  This is true of the three types in scope but has not been proven for every
  code path that writes a document, and step 5 must establish it before moving
  generation.

### Session churn: reuse, not cancel

**Decision: reuse the session when the property resolves to the same APN.**

Two pieces of evidence:

1. **The APN is stable across re-fires. 11 of 11, zero exceptions.** Every
   address with more than one parked session carried an identical APN on every
   one of them:

   ```
   15181 jackson st     5 sessions   ["107-151-44"]
   56320 bonanza dr     4 sessions   ["0585-452-03-0000"]
   349 kirby st         4 sessions   ["5486-016-001"]
   9207 s central ave   4 sessions   ["6049-031-035"]
   ...                             11 addresses, 0 with a differing APN
   ```

2. **There is no cancel to call.** The TitlePoint client uses eight endpoints —
   `CreateService3/4`, `GetRequestSummaries`, `GetResultByID/3`,
   `CreateRequest3`, `GetRequestStatus`, `GetGeneratedImage`,
   `GetDocumentsByParameters3`. None cancels a service. "Cancel the in-flight
   one" could only mean abandoning it locally while it keeps running and keeps
   costing, which is exactly today's behaviour.

So cancel is unavailable and reuse is provably safe. The key becomes the APN
when one is present, falling back to the current address key when it is not —
`isConfidentSiteXMatch` already requires a single match, and a single match
carries an APN.

---

## 1a. The denominator — read this before any percentage in this document

**Legacy is running concurrently and handling PCT's business.** The hub is
being built alongside it and the team cuts over when it is ready. We are not
replacing a dead system; we are building the better version of a live one.

```
softpro_sync (legacy's order, mirrored here)   8,185
manual_entry (hub-created, ours end to end)       40
                                               ─────
                                               8,225      hub = 0.49%
```

**Any percentage measured against 8,225 describes legacy's book, not ours.**
A gap on a synced order is not evidence of a defect — legacy sent that
confirmation, delivered that prelim, attached those documents. Absence there
means it was handled somewhere we cannot see.

**The hub's denominator is 40.** Three consequences that change how this
project is run:

1. **Every hub-created order can be checked individually.** There is no need to
   sample, and no excuse for a conclusion drawn from a subset.
2. **A defect on 4 orders is 10% of everything the hub has ever created.** The
   county gap and the missing confirmations are not edge cases at this scale;
   they are a tenth of the product.
3. **A number that looks small against 8,225 can be the whole story against 40.**
   That is how "49 orders with no prelim recipient" survived as a finding for a
   day: 44 were legacy's and the 4 that were ours had already been counted
   elsewhere.

**One refinement, because the rule is easy to over-apply.** Source tells you
whose ORDER it is, not whose ACTION. We push CPLs and prelims onto legacy's
synced orders; a failure in one of OUR calls is ours wherever the order came
from. The rule applies to ABSENCE, where legacy plausibly did the thing.

A worked example of getting this wrong, from the same day:

```
upload_document, hub orders:   252 attempts,  33 successes    -> "13% success"
```

That reading was wrong twice over. The 252 attempts carried only **60 distinct
documents** — the retry cap is 8, and a rejected duplicate inflates attempts
without touching documents. Counting documents instead of attempts:

```
distinct documents attempted:                60
reached SoftPro (success or "already exists"): 40
did not reach:                                20   ALL "order has unresolved errors"
```

67%, not 13% — and the 20 failures are one cause on seven orders from March to
August, all of them SoftPro refusing a document onto an order with outstanding
errors on its own side. On the current population:

```
hub orders created in the last 14 days:  34
their pushable documents:                80
marked synced:                           80      100%
```

**Count the things, not the attempts at the things.**

---

## 2. Target flow

### Phase A — while the operator fills the form. Nothing blocks them.

| Step | What happens |
|---|---|
| A1 | Operator confirms the property from SiteX |
| A2 | County resolved. On a multi-match with no county the operator supplies it. **Required.** |
| A3 | Tax and LV searches fire, session-keyed. Geo fires here too. |
| A4 | **As each search completes, its PDF is generated immediately.** LV additionally yields FIPS + instrument number + recorded date, which trigger the grant deed. |
| A5 | Artifacts stored under the session id |
| A6 | **Submit is never disabled.** Progress may be shown; nothing is blocked. |

### Phase B — the click. The only wait.

| Step | What happens |
|---|---|
| B1 | Create in SoftPro, return the file number |
| B2 | Write the local order record |
| B3 | Bind the session's TitlePoint rows and artifacts to the order |
| B4 | Rename stored objects from session naming to `{fileNumber}` naming |
| B5 | **Operator released** |

### Phase C — sequential. Nothing here runs concurrently with anything else here.

| Step | What happens |
|---|---|
| C1 | Wait for all documents terminal (success or failed). Normally instant. |
| C2 | Send the confirmation email with every succeeded document attached |
| C3 | Upload to SoftPro in **one** AddDocuments call, into folders |
| C4 | Mark complete |

---

## 3. State model

One pipeline per order, forward-only, persisted.

```
session_started -> searching -> generating -> ready_to_submit
  -> creating_in_softpro -> created -> binding
  -> awaiting_documents -> emailing -> uploading -> complete
```

Every transition writes: step, started_at, ended_at, what it produced, and on
failure the actual error **and the vendor payload**. That last clause is not
decoration — it is the defect that cost an evening on order 6142 and left three
Westcor orders unrecoverable for five months.

**Resumable** means a worker can pick up any pipeline not in `complete` and
continue from its current step. A failure stops that order at that step, named
and visible. It does not skip ahead and it does not leave two other jobs running.

This is the durable work record from the previous proposal. Same table, not a
second one.

---

## 4. What gets deleted

| Deleted | Why it is safe |
|---|---|
| `PRE_INIT_SUBMIT_GATE_MS` and the disabled Submit | The create already accepts `titlePointSessionId` as optional; `autoTriggerTitlePoint` already runs after the order exists. The gate protects nothing. |
| The AddDocuments verify step | 14 of 14 failures. It reads an endpoint that has never once reported a document we wrote. **SoftPro's "an item already exists by that name" is the confirmation.** |
| `titlepoint.drain` cadence *for these documents* | Generation becomes event-driven inside the pipeline. The drain job itself stays for anything else that uses it. |
| The separate email-readiness gate | Ordering makes email-before-documents unrepresentable. |
| Any per-document upload path | One batched call at C3. |

Deleting the verify step also stops the retry storm: 57 documents currently
marked failed will stop being re-uploaded into rejections.

---

## 5. Failure handling

| Step | On failure |
|---|---|
| A3 / A4 | That document is terminal-failed. **The pipeline continues.** Missing documents never block an order. Record which and why. |
| B1 | **Do not retry.** Search SoftPro for the file. Found → adopt the number. Not found → the order did not create and the operator may resubmit. Already built in #80; keep as is. |
| B4 | Retry. Our own storage. Never lose the artifact. |
| C2 | Retry with backoff. **Do not proceed to C3** until success or terminal failure. |
| C3 | Retry. **On "already exists", treat as success** — the file is there. |

---

## 6. Edge cases

1. **Submit before generation finishes** — allowed and normal. C1 waits;
   generation binds on completion.
2. **LV returns no qualifying deed** — no grant deed. Not a failure. Email sends
   with the other two. (`CONFIRMATION_OPTIONAL_DOC_TYPES` already contains
   `grant_deed`, so this is consistent with what exists.)
3. **Form abandoned after generation started** — sweep sessions and objects
   older than 24h with no order. **Log the count.** If it is ever non-trivial we
   want to know.
4. **Property changed mid-session** — old artifacts abandoned, new session
   begins. Documents generated for one property must never attach to another.
   **Asserted with a test**, not a convention.
5. **Two operators, same property** — two sessions, two orders. Correct. The
   duplicate question belongs to the create path.
6. **SoftPro create succeeds, local write fails** — the order exists at the
   vendor. **Never report failure.** Name the file number, say do not re-enter.
7. **County genuinely unknown** — the order can still be created; it gets no
   TitlePoint documents and the pipeline **records that reason explicitly**
   rather than silently doing nothing, which is what happens today on 28% of
   orders.

---

## 7. Build order

One PR per step, each independently revertable.

| # | Step | Why here |
|---|---|---|
| 1 | **Session reuse on address edit** | Ahead of Phase A because Phase A multiplies its cost from 2 wasted searches per edit to 2 searches + 3 PDFs. |
| 2 | **Three-way gate records the missing input, plus the required field** | 4 of 27 live orders lose every document. The recorded reason closes the other two doors. |
| 3 | **Trace id** through SiteX, TitlePoint, SoftPro, jobs, local writes | Every question this week needed archaeology because `create_order` rows carry `order_id = NULL` on every row. |
| 4 | **Delete the submit gate** | Pure subtraction. No vendor contact. |
| 5 | **Session-keyed generation (Phase A)** | The core change. Requires the migration below. |
| 6 | **Bind and rename (Phase B)** | `linkSessionToOrder` already exists; extend it to artifacts. |
| 7 | **Sequential Phase C; delete the verify step** | |
| 8 | **State model persisted, resumable** | Last because steps 5–7 define what the states actually are. |

### The migration step 5 needs

`documents.order_id` becomes nullable, `documents.session_id` is added, and a
check constraint requires **exactly one** of them. Additive; hand-applied ahead
of the code per convention; flagged before it is applied.

Without it, Phase A cannot write a document at all — that column is the whole
reason today's 105 completed searches never became PDFs.

---

## 8. Measurement, before and after

Captured on today's code first, so the comparison is real.

| Metric | Today |
|---|---|
| Address confirm → Submit clickable | up to 45s; p50 5.8s; **31% hit the cap** |
| Submit click → operator released | SoftPro create: p50 21.5s, p95 45.1s, max 57.3s |
| Submit → confirmation email sent | not instrumented |
| Submit → all documents in SoftPro | not instrumented |
| % of orders with all three documents in SoftPro | not instrumented |
| **% of live orders with no documents at all** | **15% (4 of 27)** |

The two "not instrumented" rows are what step 1 exists to fix. **If these
numbers do not move after the rebuild, the design was wrong and that should be
reported, not explained away.**

---

## 9. Constraints

- **SoftPro is shared with legacy, which is still running PCT's business.**
  Anything writing to SoftPro keeps full caution. Everything on our side can be
  rebuilt.
- Legacy remains the system of record until cutover. A hub failure means the
  operator opens it in legacy.
- **No untracked code writes to production.** Everything through a branch.
  (Noted because two writers currently in production —
  `job:backfill_te_prelims` and whatever sets `softpro_listing_confirmed` —
  appear in no commit in this repository.)
- **The async create is explicitly not built.** The operator waits only for the
  SoftPro call, which is the irreducible minimum. Whether that call is slow for
  a fixable reason is the separate cron-competition question.

---

## 10. Related

- `docs/tickets/WESTCOR_PARTIAL_CREATE_STRANDS_THE_ORDER.md` — why the state
  model persists vendor payloads on failure.
- `docs/tickets/THROWING_ON_A_VENDOR_ERROR_DISCARDS_THE_BODY.md` — same lesson,
  surveyed.
- `docs/tickets/PERSIST_THEN_THROW_AS_A_STRUCTURE.md` — the helper the pipeline's
  vendor calls should route through.
