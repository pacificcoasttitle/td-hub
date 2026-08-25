# Open security items

**Status: documented, NOT fixed. No remediation has been attempted on any item here.**

Owner: unassigned
Opened: 2026-08-25
Source: surfaced incidentally during the SoftPro order-create investigation
(`spike/softpro-write-audit`, `fix/softpro-create-parity`)

## Why this file exists

Five distinct exposures surfaced over two days, each one interrupting a different
piece of bug-hunting. Handled one at a time as they appear, they derail the work
and none of them get finished. They are collected here so they can be owned,
prioritised and closed as their own stream, separately from the order-open fixes.

**Nothing in this file should be fixed by whoever is working the order-create
path.** It needs an owner with infrastructure access and a maintenance window.

Each item states what was **verified first-hand** and what is **reported or
inferred**, because the difference changes how urgently it should be treated and
what the first step is.

---

## 1. SoftPro adapter has no authentication

**Severity: high. Verified first-hand.**

The .NET adapter at `100.29.181.61` accepts unauthenticated requests on both
ports. Confirmed by issuing a plain `curl` with no credentials, no token and no
session to both:

```
GET http://100.29.181.61:3000/api/ordercreation/GetOrders  -> HTTP 200
GET http://100.29.181.61:8081/api/ordercreation/GetOrders  -> HTTP 200
```

The project's own integration notes state the design intent
(`docs/claude-skills/claude-skills/patterns/softpro-integration-rules.md:12`):

> **Auth:** None in production (network-restricted IP allowlist)

So the only control is the network allowlist. Anything that can reach the host
can read any order, create orders, update orders, add notes and upload
documents — `ordercreation/create`, `ordercreation/updateOrder`,
`ordercreation/AddDocuments` and the rest are all on the same unauthenticated
surface.

This is the write path for the entire title operation.

**Interacts with item 3.** An allowlist is a perimeter control; it assumes
nothing inside the perimeter is hostile and no credential to the perimeter has
leaked. Item 3 is a leaked credential to a machine inside it.

---

## 2. Title documents are enumerable over unauthenticated plain HTTP

**Severity: high — customer PII. Filename pattern verified from vendor docs;
retrievability deliberately NOT tested.**

The adapter returns document URLs on the same host, port 80, served by IIS
(`Server: Microsoft-IIS/10.0`, confirmed first-hand). The documented shapes
(`docs/playbook/SoftPro APIs.md:324,344,367,391,654`):

```
http://100.29.181.61/SoftProIntegrate/assets/Prelim_HHmmss.pdf
http://100.29.181.61/SoftProIntegrate/assets/Policy_HHmmss.pdf
http://100.29.181.61/SoftProIntegrate/assets/PrelimDoc_HHmmss.pdf
http://100.29.181.61/SoftProIntegrate/assets/DocumentName_HHmmss.pdf
http://100.29.181.61/SoftProIntegrate/assets/SalesReport/SalesReport_YYYYMMDD_HHmmss.xls
```

Three properties combine badly:

1. **Plain HTTP.** No TLS, so the contents and the URLs are visible to anything
   on the path.
2. **No authentication on the path.** Nothing ties a request to an authorised
   user or to the order the document belongs to.
3. **The filename is a timestamp.** `HHmmss` is 86,400 possible values per
   document-type prefix. That is not a search space — it is a few minutes of
   scripted requests.

Preliminary reports and policies carry owner names, property addresses, loan
amounts, vesting, and on occasion far more sensitive material — see the Aug 11
and Aug 12 disclosure scans for what has already turned up in prelim PDFs.

**What was NOT done, on purpose:** no attempt was made to retrieve an actual
document. Confirming enumerability by pulling a real prelim would mean
retrieving customer PII, which is the harm being reported. A request to the
directory root returned `403 Forbidden`, so there is no directory listing — but
that says nothing about whether a correctly-guessed filename is served, and
that is the question. **Whoever owns this should confirm it in a controlled way
against a document they already have the right to read.**

---

## 3. RDP Administrator password stored in plaintext beside the repo

**Severity: critical. Verified first-hand.**

A plaintext file in the working tree's parent directory contains RDP
credentials for `100.29.181.61` — the host running the SoftPro adapter — in the
form: IP, port, username `Administrator`, and the password in clear text.

**Path deliberately not repeated here.** It is known to the project owner and
was reported directly. The value has not been copied into this document, any
script, any commit, or any tracked file.

The file sits in the folder that contains the git worktrees, not inside a repo,
so it is not in git history — but it is on a developer workstation, in a
directory routinely opened by tooling, and it was read into an AI session
transcript on 2026-08-25 during this investigation.

**This is the item that turns item 1 from a design weakness into an exposure.**
The adapter's only protection is that you must be inside the network. This
credential is Administrator access to a machine that is inside it.

Required, in order:
1. Rotate the password on `100.29.181.61`.
2. Remove the file from the repo folder; store the credential in a password
   manager or secrets store.
3. Review RDP access logs on that host for the period the file existed.

---

## 4. `ANTHROPIC_API_KEY` exposed in a session transcript

**Severity: medium. Verified first-hand — self-inflicted.**

On 2026-08-24 the contents of `.env.local` were printed while verifying an
append, which put the live `ANTHROPIC_API_KEY` value into an AI session
transcript in full.

The key is used by the CRM email-draft feature and is server-side only, so it is
not exposed to browsers. The exposure is the transcript.

Rotate the key. The value is not repeated here.

**Contributing cause, and a process change already made:** the exposure happened
because a whole env file was echoed to check one line. Reading secret-bearing
files now goes through filters that redact values
(`sed -E 's/=.*/=<set>/'`) rather than `cat`. Both this item and item 3 were
caused by the same habit.

---

## 5. Database password in git history — REPORTED, NOT VERIFIED

**Severity: unknown pending verification.**

Reported by the project owner: a database password was committed to the history
of the vcard repository.

**Not verified in this investigation.** That repository was not examined and is
not present on this machine. It is recorded here so the item is not lost, but it
needs first-hand confirmation before anyone estimates its severity.

First step: search the history of that repository for the credential, and
establish whether the repo is public, private, or has ever been public.

Note that rotating is necessary but not sufficient for a committed secret —
git history retains it unless the history is rewritten, and any fork or clone
keeps it regardless.

---

## Pattern

Three of these five are the same failure: a secret written somewhere convenient
and then forgotten — a file beside the repo, an env file read aloud, a commit.
The other two are the same failure at the infrastructure layer: a service that
trusts its network position instead of its callers.

Neither is a people problem, and neither gets fixed by being careful next time.
They get fixed by there being one place secrets live, and by the adapter
authenticating its callers. Both of those are projects, which is the argument
for this file having a single owner rather than being absorbed into whatever
bug is being worked that day.

---

## Explicitly out of scope for this document

- No remediation attempted on any item.
- No secret values recorded, including in file paths where the path itself
  identifies a credential store.
- No enumeration or retrieval of any customer document.
- Item 5 is reported only; treat its severity as unestablished.
