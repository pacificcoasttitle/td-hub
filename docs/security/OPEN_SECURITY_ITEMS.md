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

Item 6 was added on 2026-08-27 from a Supabase advisor warning. It is the first
item here that is a **regression of a control this project already applied** —
which is why the argument for a single owner is now stronger, not weaker.

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

## 6. Row Level Security is off on the five newest tables, and the anon key is in the browser bundle

**Severity: high, and live. Verified first-hand, including one confirmed
anonymous read of real rows from production.**

Opened: 2026-08-27. Source: Supabase advisor (`rls_disabled_in_public`).

The advisor names five tables in `public` with RLS disabled:

```
party_wizard_links
party_submissions
concierge_profiles
concierge_profile_comps
concierge_profile_transfers
```

### The anon key is reachable from a browser — this is not latent

Migration `0032_enable_rls_public_lockdown.sql` already asserted this, and it is
still true. Re-verified against the **live production deployment**, not local
source:

- `/login` and `/` are client components that call `createBrowserClient(...)`
  with `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/app/(auth)/login/page.tsx:23`,
  `src/lib/security/sign-out.ts:4`). `NEXT_PUBLIC_*` is inlined at build time.
- Crawling every JS chunk referenced by those pages on
  `https://td-hub.vercel.app` (deployment `dpl_3o2muTSchDPkPEbi9wUzRJ71irK8`),
  the anon key's **exact literal value** appears in
  `/_next/static/chunks/a98b931760ed386f.js`, served publicly with no auth. It
  is a JWT (`eyJ…`, 208 chars).
- The **service-role key is not** in any client chunk. It is
  `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix, `sb_secret_…` format)
  and is only read in `src/lib/security/supabase-admin.ts`, server-side. Checked
  explicitly; no hits in any shipped chunk. **This distinction is the difference
  between item 6 and an emergency.**

Anon reads were then confirmed to actually work. Using that key against
PostgREST, `GET /rest/v1/party_wizard_links` returned **HTTP 200 with real
rows** — both rows currently in the table. The other four returned `HTTP 200`
with `[]` because they are empty right now, not because anything denied them.

The grants make this worse than read-only. Every one of the 42 tables in
`public` grants `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` to both `anon` and
`authenticated`. On the 37 RLS-enabled tables that grant is inert. On these five
it is not: an anonymous caller can **truncate `party_submissions`**.

### The true scope is exactly five, and that is the interesting part

Queried `pg_class.relrowsecurity` across `public`:

```
TOTAL public tables: 42    RLS ON: 37    RLS OFF: 5
FORCE ROW LEVEL SECURITY set on: (none)
tables with any policy:          (none)
```

The five RLS-off tables are precisely the five the advisor named. The schema is
**not** blanket RLS-off — migration 0032 closed the other 37, with no policies,
as a blanket deny.

**Root cause is drift, not oversight.** 0032 is a hand-written enumeration of
table names. None of these five has a `CREATE TABLE` migration anywhere in
`src/lib/db/migrations` — they were pushed straight from the Drizzle schema, so
they never passed through a migration file and were never appended to 0032's
list. **Every future table will land RLS-off the same way.** Whoever owns this
should treat the recurrence as the actual finding; the five tables are only this
month's instance.

### Enabling RLS is a verified no-op for the application

This was the open question, and it is answered by query rather than inference.
The app connects via Drizzle over a direct Postgres connection
(`src/lib/db/client.ts`, `DATABASE_URL`). As that connection:

```
current_user = postgres    session_user = postgres
pg_roles: postgres -> rolsuper = false, rolbypassrls = TRUE
owner of all five tables = postgres
```

So the app's role bypasses RLS on **two** independent grounds — `BYPASSRLS`, and
table ownership (owners bypass RLS unless `FORCE ROW LEVEL SECURITY`, which is
set nowhere). Enabling RLS without policies changes nothing for the app and
denies `anon`/`authenticated` outright. That is the same shape 0032 already
proved safe on 37 tables.

Separately, and independently sufficient: **no application code reaches any
table through PostgREST.** Every Supabase client call in `src/` is
`supabase.auth.*` — `signInWithPassword`, `signOut`, `getUser`,
`auth.admin.createUser`, `auth.admin.generateLink`. There is not one
`.from('<table>')` data call in the codebase. Supabase is the identity provider
here; it is not a data path.

### What breaks per table: nothing

| Table | Reached by | Runs as | Effect of RLS-on, no policies |
| --- | --- | --- | --- |
| `party_wizard_links` | `party-wizard-service.ts` (Drizzle) | `postgres` | none |
| `party_submissions` | `party-wizard-service.ts` (Drizzle) | `postgres` | none |
| `concierge_profiles` | `concierge/usage.ts`, SiteX feed (Drizzle) | `postgres` | none |
| `concierge_profile_comps` | same | `postgres` | none |
| `concierge_profile_transfers` | same | `postgres` | none |

**The party wizard specifically.** The public page and its POST were the stated
risk, so they were traced end to end. `src/app/party-wizard/[token]/page.tsx`
calls `resolvePartyWizardLink` and `recordLinkAccess`; `POST
/api/party-wizard/[token]` calls `submitPartyWizard`. All three live in
`party-wizard-service.ts`, which imports `db` from `@/lib/db/client` and touches
nothing else. Token validation and submission acceptance are Drizzle-only. **The
public feature does not use the anon key and does not break.**

### Policies versus blanket deny

**Blanket deny — RLS on, no policies — for all five.** Nothing legitimate
reaches these tables via the anon key, so there is no access pattern for a
policy to describe. A policy here would be unverifiable by construction: there
would be no caller to test it against, and it would create the impression of a
reviewed grant where none exists. This also keeps the five consistent with the
37 already closed by 0032, so the schema has one rule instead of two.

Per-table reasoning for what is at stake:

- **`party_wizard_links`** — the only one leaking today (2 rows, read
  anonymously and confirmed). Exposes `order_id`, `role`, `created_by`, and
  access timestamps. It does **not** hand out usable links: the URL token is
  `tokenId.secretHalf.hmac`, only `token_hash` (SHA-256 of a 24-byte secret) is
  stored, and forging a signature needs `PARTY_WIZARD_TOKEN_SECRET`, which is
  server-side. The token design holds even with the table world-readable —
  credit where due. The exposure is metadata plus the `UPDATE`/`TRUNCATE` grant.
- **`party_submissions`** — empty today, so no PII is out yet. The schema is
  `submitter_email`, `submitted_name`, `submitted_company`, `submitted_email`,
  `submitted_phone`, `submitted_values`. **This is the one that matters**: it is
  contact detail collected from people outside PCT via a link forwarded through
  inboxes we do not control, and it becomes world-readable the moment the first
  party submits. Highest priority of the five on that basis alone. Mitigating:
  no background job scans this table, so an anonymous `INSERT` sits inert rather
  than becoming a SoftPro write — the SoftPro push happens inline during submit.
- **`concierge_profiles`** — empty; feature not yet in production use. Holds
  `prepared_for_email`, `presenting_rep_email`, `presenting_rep_phone`, plus
  SiteX-derived property, tax and valuation data and `sitex_credits_charged`.
  Externally-sourced licensed vendor data as well as PII.
- **`concierge_profile_comps` / `concierge_profile_transfers`** — empty; comp
  and transfer records hanging off the above by `profile_id`. Same licensed-data
  exposure, no independent access pattern. Close them with the parent.

### Required, in order

1. Extend 0032's pattern to the five: `ENABLE ROW LEVEL SECURITY`, no policies,
   no `FORCE`. Reversible per table with `DISABLE ROW LEVEL SECURITY`.
2. Decide whether the anon key belongs in the bundle at all. It is only there
   for `signInWithPassword` and `signOut`; a server-side sign-in route would
   remove the browser-reachable credential entirely and make item 6 unable to
   recur. This is the durable fix and it is application work, not a DDL change.
3. Fix the drift, or this returns with the next table. Either stop hand-writing
   the table list (event-trigger or a default-deny convention) or add a CI check
   that fails when a `public` table has `relrowsecurity = false`.
4. Consider revoking the blanket `anon`/`authenticated` DML grants across
   `public`. RLS is sufficient to deny, so this is defence in depth rather than
   required — but `TRUNCATE` granted to `anon` on 42 tables is not a grant
   anybody chose.

### What was NOT done, on purpose

No security configuration was changed: no RLS enabled, no policy created, no
grant altered, no key rotated, no table touched. The only production access was
`SELECT` against catalog and count queries, and read-only `GET`s to PostgREST.

**No anonymous write was attempted.** The `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`
grants above are read from `information_schema.role_table_grants` and are
reported as *granted*, not as *exercised* — confirming a write by performing one
would mean writing to production with an anonymous credential, which is the harm
being reported. The read of `party_wizard_links` was exercised, and is reported
as verified.

No key value is recorded here — only the chunk path where the anon key can be
found, its format, and the fact that the service-role key is absent from it.

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

Item 6 is a third kind, and it sharpens that argument. It is not a secret left
somewhere or a service trusting its network — it is a control that **was**
applied, correctly, to 37 tables, and then did not stay applied. Five tables
added afterwards missed it because the control is a hand-maintained list. So the
fix that closes item 6 tonight (five `ALTER TABLE`s) is not the fix that keeps
it closed, and nobody working a bug will own the second one. That is the owner
problem: items 1 through 5 need someone to start them, and item 6 needs someone
to still be watching in a month.

---

## Explicitly out of scope for this document

- No remediation attempted on any item.
- No secret values recorded, including in file paths where the path itself
  identifies a credential store.
- No enumeration or retrieval of any customer document.
- Item 5 is reported only; treat its severity as unestablished.
- Item 6 changed no security configuration and performed no write of any kind.
  Its anonymous-write exposure is reported from the grant tables, not exercised.
