# TD Hub — Director Chat Handoff

**Written 2026-09-02. For the cloud continuation of Jerry Hernandez's engineering-direction chat.**

You are picking up a long-running working relationship, not a cold task. Read this before doing
anything. Most of what follows was learned expensively.

---

## 1. Who and what

**Jerry Hernandez** — Director of Product Development, Pacific Coast Title (PCT). Call him Jerry.
He is not a developer by trade but reads systems well, catches over-engineering fast, and is
usually right when he pushes back.

**PCT** is a California title company. Escrow officers and agents open title orders; PCT produces
title documents, preliminary reports, CPLs and policies.

**TD Hub** (`td-hub`) is the new platform — Next.js 16 App Router, React 19, TypeScript strict,
Drizzle + Postgres on Supabase, deployed on Vercel.

**TransactionDeskClone** is the legacy PHP/CodeIgniter system. **It is still running and handling
PCT's actual business.** The hub is being proven alongside it. The team cuts over when it's ready.

### The single most important structural fact

```
softpro_sync (legacy's orders, mirrored here)   8,185
manual_entry (hub-created, genuinely ours)         40
```

**Any number measured across the whole order table is 99.5% legacy's book.** Split every
measurement on source. Absence of a confirmation, a document or a delivery on a *synced* order
means legacy handled it — not that anything failed.

The refinement that matters: **source tells you whose order it is, not whose action.** We push CPLs
and prelims onto legacy's orders. Those are our calls, and failures there are ours wherever they
land.

**The honest denominator for "does the hub work" is 40.** A defect affecting four orders is 10% of
everything the hub has ever created.

---

## 2. The vendors

| Vendor | What it does | Environments |
|---|---|---|
| **SoftPro** | System of record for orders. Shared with legacy. | prod `100.29.181.61:3000`, staging `:8081` — same host, separate data |
| **SiteX** (ICE/Black Knight) | Property data, owner names, comparables | prod live; UAT published at `api.uat.bkitest.com`, untested |
| **TitlePoint** | Legal & Vesting, Grant Deed, Taxes, Geo | live only |
| **Westcor** | CPL underwriter (default) | UAT exists, needs their provisioning |
| **FNF / Commonwealth** | CPL underwriter (Full ALTA only) | UAT at `cpltrainfuture.fnf.com`, needs credentials |

**SoftPro writes are real and shared with legacy.** Full caution applies. Everything else on our
side of the line can be rebuilt.

Aashima Narang is the SoftPro API contact.

---

## 3. The one pattern behind almost every defect found

> **We treat "it returned" as "it worked," and we don't keep enough to tell the difference
> afterwards.**

Every major finding was an instance of this:

- SoftPro returned `200` and silently discarded the property address for months, because we sent
  `propertyDetails` as an array where it binds an object
- A retry job reported success **5,926 times** while every call inside it returned 400
- A document verification step **has never passed once** — it reads an endpoint that cannot see
  inside the folders we write to — and marked good documents as failed
- `hasMore` was read at the top level of a response where the vendor puts it inside `Pagination`;
  `undefined` coerced to `false`, and the company sync silently truncated at 1,000 rows for months
- A watchdog has run 2,879 times in 30 days and has never reported anything
- Westcor returned a `tvid` and an error in the same body; we kept the error and discarded the id,
  stranding three orders for five months

---

## 4. Watch-outs (these exist as docs in the repo)

**`claims-nothing-verifies`** — a check that cannot distinguish the thing it asserts. Instances
included a numeric comparator that called `31195 EMERY CT` and `31195 Emery City` a match, a
`not.toBeNull()` standing in for a value nobody looked at, and a Map keyed without `is_primary`.

> Before trusting a check that passed, ask what it would look like if the thing being checked for
> were **true**. If the answer is "the same," it's decoration.

**`undefined-means-done`** — reading a field the vendor never sent, coercing to a decision.

**`writing-from-the-shape-of-the-problem`** — asserting a vendor contract from what the problem
*feels* like rather than from the document.

> A claim about a vendor contract that contains no quotation from the vendor contract is a
> hypothesis wearing a conclusion's clothes.

**Endorsement is not corroboration.** A wrong claim survived three rounds because it had agreement
behind it. The check that would have killed it took fifteen seconds.

**"What am I about to do" versus "what does what I'm about to do set in motion."** An agent verified
the email it was about to send, and not the email that firing TitlePoint would trigger. One went to
a real escrow company.

**A cached read is not a fresh read.** A `null` from a cache says nothing about the vendor.

**Unconsumed `mockReturnValueOnce` leaks into the next test** and the failure appears somewhere you
didn't touch. Passing in isolation is the tell.

---

## 5. Methods that worked

**Ask legacy.** It has run for years; every wrong assumption in it has already been found by
someone hitting it. Legacy answered the owner-name parsing, the SoftPro payload shape, the CPL
borrower rule, the document folder strings, and the timeout question. **Four separate times legacy
had the answer we were about to guess at.**

Caveat: legacy is not scripture. It hardcodes `ClosingAgentNumber`, falls back to the property owner
for a borrower on purchases (which is wrong), and leaves its submit button clickable during a create.
Use it as evidence, not authority.

**Read the vendor's own contract before paying to guess.** Westcor's Postman collection contained
two working Title & Escrow examples. SiteX publishes its OpenAPI at
`/realestatedata/search/schema/{feedId}` — free, and it settled a question we had authorised a
billable call for. FNF's `GetCPLMetadata` returned the exact field list. **Every one of these was
one round trip away and nobody had looked.**

**Measure before fixing, and split by population.** "170 orders missing an address" turned out to be
three different problems with three different owners. "14,869 missing orders" was mostly a system
that wasn't ingesting yet.

**The first real use is the test.** Ship it, have Jerry or the team use it once, watch the logs live.

**Retract loudly and immediately.** Several conclusions were wrong. Every one was caught by
re-reading rather than by the original check. Retractions were cheap; a wrong finding in a ticket
outlives everyone's memory of where it came from.

---

## 6. Standing rules in force

- **No untracked code writes to production.** Ever. Not a one-off, not a repair script.
- **Agents open PRs; Jerry approves the merge.** `gh` is authenticated as `easydeed`.
- **CI is a required check** (`app`, `scripts`) with branch protection and no bypass. It is the only
  gate between a branch and production — 0 approvals required, so treat a red build as a hard stop.
- **Migrations are hand-applied to production ahead of the code**, and flagged before applying.
- **No billable vendor call without explicit approval.** SiteX credits especially.
- **SoftPro write tests go to `:8081` only**, with separation proven before each run.
- **Never claim success from a command whose exit code you didn't read.**
- **Kill the child PID; verify a stop by absence of new database rows over a full cycle**, never by
  a process handle. Two scripts reported "stopped" while still running.
- **A standalone script that touches the DB must close the pool or exit explicitly**, or it hangs
  forever and its buffered output is lost.

---

## 7. What was fixed (week of 2026-08-25 to 09-01)

**Order creation into SoftPro**
- `propertyDetails` sent as an object, not an array — this was the original "address isn't writing"
  complaint and the last thing found
- Owner names: SiteX returns `LAST FIRST MIDDLE`; we now flip and split correctly, handle
  multi-owner strings, and route entities to `CompanyName`/`Trust` instead of inventing a person
  named after a street number
- Title & Escrow orders now work — they had never once succeeded, going back to March. Cause: the
  branch code was taken from the escrow officer while the examiner came from the title officer
- Party contacts reach SoftPro with lookup codes for the first time
- Four silently-dropped columns now persist; 26 of ~50 form fields were being discarded

**Documents**
- Batched into one `AddDocuments` call — three concurrent uploads were deleting each other's staging
  folder mid-flight
- Legacy folder strings (`legal-vesting`, `grant-deed`, `tax`)
- Accepted-vs-confirmed split; the blind verify step is being deleted

**Missing orders**
- The sync only ever asked about "today." 332 orders recovered. Failures went from 92/day to under 1
- `GetOrders` truncates silently at 250; company sync truncated at 1,000 because `hasMore` was read
  from the wrong place

**CPL**
- `ClosingAgentNumber` was printing Orange's agency code on every branch's letter — it should be
  null entirely on a single-agent CPL
- `CountyFips` (required) and `ParcelID` were never sent
- A zero coverage amount could go out on a refinance
- The borrower preflight blocked 54% of orders on a check legacy doesn't have
- Vendor error messages now reach the operator instead of "CPL generation failed"

**Client/company creation** — firm-then-person, deterministic lookup codes, type derived from the
company's flags, near-match before create

**Infrastructure** — CI, committed lockfile (174 packages were drifting), branch protection, RLS
enabled, `anon` write and TRUNCATE grants revoked on 42 tables

---

## 8. The current work: the open order pipeline rebuild

**The problem:** TitlePoint retrieval, the confirmation email and the SoftPro document upload run as
three independent things on three separate clocks. That is the cause of the document race, the email
timing and the stuck searches.

**The key discovery:** TitlePoint never receives the SoftPro file number. All five search calls send
`orderNo=&` blank. Generation takes a service ID; the grant deed takes FIPS, instrument number and
recorded date, all present in the LV result. **So everything except the SoftPro create can happen
before the operator clicks Create.** The only blocker is one column: `documents.order_id NOT NULL`.

**The target flow:**

- **Phase A** — while the operator fills the form. Address confirmed → searches fire → **each PDF
  generates as its search returns**. Session-keyed. Submit is never blocked.
- **Phase B** — Create clicked. SoftPro create, local write, bind session artifacts, rename to the
  file number. Operator released.
- **Phase C** — sequential, after: wait for all documents terminal → send confirmation with
  attachments → upload to SoftPro folders in one call.

**Nothing in Phase C runs concurrently with anything else in Phase C.** Ordering makes the race
impossible rather than guarded against.

**Deleted by this design:** the 45-second submit gate, the verify step, the independent drain
cadence, the email readiness gate.

**Build order:** three-way gate recorder + required county field → trace id → session-keyed
generation → bind/rename → sequential Phase C → persisted resumable state model.

Design doc: `docs/tickets/OPEN_ORDER_PIPELINE_REBUILD.md`.

---

## 9. Open items

- **Automated end-to-end testing** against SoftPro `:8081` — scoped, being built. Must assert
  outcomes, not absence of errors
- **Four orders repaired or repairing** (`8136`, `8141`, `8147`, `8151`) — hub-created, missing
  county, got no documents and no confirmation
- **Party wizard** — invite switch OFF, listing-agent form only, three roles unbuilt, one-link
  picker design parked
- **Concierge property profile** — merged, dormant, needs an operator UI
- **Market reports** — migration approved, not started
- **FNF CPL** — built, auth proven, `GetCPLList` returns 200, **no letter has ever been issued**
- **Thirteen addresses started in the hub and finished in legacy** — worth asking the team why

---

## 10. How to work with Jerry

- **Be concise.** He has said so directly, more than once.
- **Give the English version.** He asks for it explicitly. Lead with the plain answer, keep the
  detail behind it.
- **Don't rush to write an agent prompt before the conversation is finished.** He has called this
  out. Think with him first; the prompt comes after the decision.
- **He will push back and he is usually right.** "Why are we applying a patch rather than fixing it
  correctly," "you're solving a problem you don't understand," "we didn't build it correctly
  initially" — all three reframed the work productively.
- **Own errors immediately and without collapsing.** Several recommendations in this project were
  wrong. Saying so plainly cost nothing and kept the work honest.
- **He runs multiple agent sessions** — Claude Code and Cursor, plus a legacy-source session and a
  SoftPro-API session. Your job is to route work, review reports critically, and surface only what
  needs him. Instructions written from one session's findings cannot be executed by another; the
  receiving session usually can't tell.
- **Visuals land well.** He has asked for diagrams and reacted well to rendered mockups and
  pipelines.
