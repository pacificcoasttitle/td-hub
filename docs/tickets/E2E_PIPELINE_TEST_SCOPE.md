# End-to-end pipeline test against SoftPro staging — scope

**Status: SCOPE, for approval. No code written.**
Opened: 2026-09-02

Prove the pipeline works, repeatably, rather than have Gerard's team discover
that it doesn't. They have shown it *can* work; this shows it *does*.

---

## 0. Where this sits in the sequence

**The harness comes BEFORE the pipeline rebuild.** Trace id and
generation-before-submit move behind it.

```
1. test cast          people and companies the suite runs as
2. harness            built against TODAY's code
3. green on today     the baseline
4. trace id
5. generation before submit, then the sequential phases
```

Building the harness first gives every rebuild step a baseline. Rebuilding
first leaves us unable to tell a regression from a gap that was already there —
and this codebase already has gaps that looked like regressions for exactly
that reason.

**After the harness, and only then**, in this order:

1. A test per route asserting which roles reach it, generated from the current
   constants (`docs/tickets/ROLE_CONSTANTS_SHARE_NAMES.md`). The authorization
   surface is entirely unverified today.
2. The role-constant sweep, which that test makes safe.

---

## 1. The two blocking questions, answered from source

### How does a script authenticate without a browser?

**Auth is Supabase, cookie-only.** `createSupabaseServer`
(`src/lib/security/supabase-server.ts`) builds `createServerClient` with a
cookie adapter and nothing else — **there is no Authorization-header path**, so
a bearer token will not work. Every route on the create path calls
`getSession()`.

Login is client-side: `signInWithPassword` in
`src/app/(auth)/login/page.tsx:50`. **There is no server-side login endpoint to
POST to.** `/api/auth/session` is a GET that reads an existing session.

**So the script must hold real Supabase auth cookies.** The robust way is to
let the same library that reads them also write them:

```
create an in-memory cookie jar
  -> @supabase/ssr createServerClient(url, anonKey, { cookies: jar })
  -> auth.signInWithPassword({ email, password })     // jar now populated
  -> send jar as a Cookie header on every fetch
```

Using `@supabase/ssr` for both halves means the cookie format is never
hand-rolled — that format is chunked and version-sensitive, and hand-rolling it
is the kind of thing that works until a dependency bump.

**WHAT WE NEED FROM YOU: credentials for the existing `open_order_team` test
user.** Gerard already has test users in every role, all pointing at his email.
No account needs creating.

**THE SUITE RUNS AS `open_order_team`, NOT AS AN ADMIN.** That is the role that
actually opens orders, and a suite running with elevated permissions can pass
while a real operator gets a 403.

Specifically **no new auth surface** — no test-only bypass, no shared secret
that skips `getSession`. A bypass on the production auth path to make testing
easier is a bad trade at any price.

### CORRECTION, 2026-09-02 — the first draft of this section was wrong

It said the create route "returns 403" without a role in `ADMIN_ROLES` and, on
that basis, recommended running the suite as an admin. **`open_order_team` can
reach the route and always could.**

The route defines its OWN constant, wider than the one in `security/auth.ts`:

```
security/auth.ts       ADMIN_ROLES        ['super_admin','admin','cs_admin']
orders/create (local)  ORDER_CREATE_ROLES ['super_admin','admin','cs_admin',
                                           'open_order_team','escrow_assistant']
```

Both were called `ADMIN_ROLES`. I read the name in the route and attached the
other one's meaning to it. Production settles it — the operators opening orders
are the role the draft claimed was excluded:

```
open_order_team   Amna Illyas       12 orders
super_admin       Jerry Hernandez   11
open_order_team   Shean Veoh         9
admin             Aileen Delfin      5
open_order_team   Emelio Delfin      3
```

The route's constant is now `ORDER_CREATE_ROLES`. The wider survey is in
`docs/tickets/ROLE_CONSTANTS_SHARE_NAMES.md`: 32 local `ADMIN_ROLES` with three
different contents, 35 local `ALLOWED_ROLES` with twelve.

**Every other route on this path gates on session only, with no role check**, so
running as `open_order_team` exercises the whole pipeline with exactly the
permissions a real operator has.

### Can anything on that path NOT be driven from outside the UI?

**No. Every stage is reachable.** Checked route by route:

| Route | Gate | Driveable |
|---|---|---|
| `/api/orders/sitex-lookup` | `getSession` | yes, JSON body |
| `/api/titlepoint/pre-initiate` | `getSession` | yes — `{address, city, state, county, apn}` |
| `/api/titlepoint/pre-initiate/status` | `getSession` | yes — `?sessionId=` |
| `/api/orders/check-duplicate` | `getSession` | yes |
| `/api/orders/create` | `getSession` + `ADMIN_ROLES` | yes, the same payload the form builds |
| `/api/form-options` | `getSession` | yes |

**No CSRF token, no origin check, no referer check** — `src/middleware.ts` has a
path matcher and no request-origin enforcement, and nothing in `src/lib/security`
implements one.

One browser-side piece is worth naming: `isConfidentSiteXMatch` decides whether
pre-init fires. It is a **pure function** (`domain/titlepoint/confident-sitex.ts`)
the script imports directly, so the decision is reproduced rather than
simulated.

---

## 2. Assert outcomes, not absence of errors

This is the whole point, and it is not a style preference. Three things found
this week that **a "no error thrown" test passes**:

- a retry job that reported success **5,926 times** while every AddDocuments
  call inside it returned 400
- a document verify step that has **never passed** — 14 of 14 failures — against
  an endpoint that cannot see the folders we write to
- a SoftPro create that returned **200 and stored nothing locally**

So every stage reads the thing back.

| Stage | Assertion — the read-back, not the return value |
|---|---|
| Address | SiteX returns a single match; APN and county equal the fixture's expected values |
| Pre-init | `title_point_data` has tax + LV rows for the session id, and they reach a terminal status |
| Create | a file number came back **and** `orders.file_number` holds it locally |
| Create | `order_properties` exists and its address, city, state, county and APN equal what was sent |
| Create | **read the order back from SoftPro** and confirm address, APN and county are stored there |
| Documents | three `documents` rows — legal_vesting, grant_deed, tax — each with a storage key that downloads |
| Upload | **read the documents back from SoftPro** and confirm all three are in their folders |
| Confirmation | `notification_logs` has rows for the expected TO and CC, and the send carried **three attachments** |

**Two of these cannot be asserted honestly today and must be built or waived:**

- **"Read the documents back from SoftPro."** `GetAttachedDocuments` does not
  see Production Documents subfolders — that is the whole of
  `SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS.md`, with an open ask to
  Aashima. Until it is answered, the strongest honest assertion is SoftPro's own
  write-side evidence: a 200, or a 400 *"an item already exists by that name"*
  with `FileUploadedStatus: true`. **That is weaker and the test must say so in
  its own output rather than printing a green tick.**
- **"Three attachments on the confirmation."** `buildAttachments` builds them
  in-process; `notification_logs` does not record a count. Either the send path
  records it, or the test asserts on the three `documents` rows that feed it and
  says that is what it checked.

---

## 3. Fixed test properties

A small committed fixture set. Not production data, not random.

Each fixture is `{ address, city, state, zip, expectedApn, expectedCounty,
expectedFips, expectedMatch }`. A run that diffs against these means something;
a run against whatever is in production means nothing.

**The first fixture should be a property already proven to work end to end** —
`760 N Brierwood Ave, Rialto` is in the working `property_lookup` example in
our own SiteX reference, and the four documents on order 8136 came back clean
for `1815 Holmby Ave, Los Angeles`. Starting from a known-good property means a
red first run is the harness, not the data.

---

## 4. Scenarios, in order

**First one narrow: one property, one order, all the way through, hard
assertions at every stage. Green after every change.** Then:

| # | Scenario | What it proves |
|---|---|---|
| 1 | Title only, confident match | the happy path, end to end |
| 2 | Title & Escrow | the escrow-officer path — 3 of 3 hub T&E orders currently have no prelim |
| 3 | Multi-match address | the operator supplies county; documents still generate |
| 4 | Entity seller | `nameFields` routes to CompanyName/Trust — the defect that broke CPLs on 373 orders |
| 5 | Missing county | asserts the **recorded reason** and that a confirmation is still sent |

Scenario 5 asserts the fix from #84: the `order_status_history` note names the
missing input, and `noDocuments: true` still reaches the outbox. That is a test
for a *deliberate* refusal, which is the kind most easily lost.

---

## 5. Cost per run — measured

From three complete hub orders (8164, 8157, 8154):

```
TitlePoint   14 calls per order
             create_service 1, get_request_summaries 1, get_result 1,
             get_result_raw_xml 1, get_documents_by_parameters3 1,
             request_image 3, get_request_status 3, get_image 3

SoftPro       ~5 calls per order   (against staging, so no production effect)

SiteX         1 credit per successful /search
              A scripted run makes exactly the calls it chooses: 1 for the
              confirm, 2 if it also runs a candidate search first.
```

**SiteX per-order attribution is not possible from the logs** — every `sitex`
row carries `order_id = NULL`. The 1,457 lookups against 32 hub orders in seven
days is dominated by typeahead during manual entry, not by one lookup per
order, so it is not a per-run figure and should not be read as one.

**I cannot give you a currency figure.** The SiteX credit price and the
TitlePoint per-search price are not in this repository or in the vendor
responses. The call counts above are exact; the unit prices have to come from
you or from the contracts.

**So: on demand and nightly, never per commit.** Nightly across five scenarios
is ~5 SiteX credits and ~70 TitlePoint calls per night.

---

## 6. Staging isolation — VERIFIED, not assumed

Gerard said `:8081` lands in SoftPro's test profile and the vendor prefixes the
file number with `TEST-`. Checked rather than taken, 2026-09-02.

**Read check — the two known files:**

```
TEST-20002219-OCT   :8081 rows=1  OrderNumber=TEST-20002219-OCT
                    :3000 rows=0
TEST-20002223-OCT   :8081 rows=1  OrderNumber=TEST-20002223-OCT
                    :3000 rows=0
```

**Write check — one order created against `:8081` with PRODUCTION credentials:**

```
POST http://100.29.181.61:8081/api/ordercreation/create
{"Status":200,"Message":"Order created successfully",
 "OrderNumber":"TEST-20002225-OCT","data":[]}          41.5s

file number carries TEST- prefix : YES
:8081 sees it                    : YES  (rows=1)
:3000 sees it                    : no   (rows=0)
```

Same `SOFTPRO_TOKEN` and `SOFTPRO_USER_ID`. `SOFTPRO_API_URL` is the only
switch (`softpro/client.ts:61`), and the base URL carries the `/api/` suffix:
`http://100.29.181.61:8081/api/`.

### What this removes from the scope

**The distinguishing problem is gone.** No test flag on the orders table, no
marking step, no separate deployment, and no shared-database concern — the
vendor separates the environments and names the files for us.

```sql
WHERE file_number NOT LIKE 'TEST-%'
```

is the whole of it, and it excludes test orders from every list and every
measurement. Gerard's team never sees them. **Currently 0 of our 8,230 orders
carry a TEST- prefix**, so the predicate is free today and stays correct as
runs accumulate.

### The one thing it adds

**A staging create took 41.5 seconds** — consistent with production (p50 21.5s,
p95 45.1s, max 57.3s), so staging is not a faster environment to test against.
The harness needs a create timeout at or above the production ceiling, and a
nightly run should budget ~1 minute for that stage alone.

### Still needed from Gerard

1. **Credentials for the existing `open_order_team` test user.** No account
   needs creating — Gerard has one per role already.
2. **The unit prices** — SiteX credit and TitlePoint per-search, for the cost
   line in section 5.

Not needed, now that the vendor separates them: any answer about cleanup.
Test files accumulate in SoftPro's test profile, which is what it is for.

## 7. What this does not cover

- The browser. This drives the API, so a form that stops sending a field is
  invisible to it. That is a deliberate trade — the API path is where the
  defects have been — but it should be said rather than discovered.
- Production SoftPro. Staging only, by design.
- Legacy. Out of scope entirely; see the denominator note in
  `OPEN_ORDER_PIPELINE_REBUILD.md` §1a.

## Related

- `docs/tickets/OPEN_ORDER_PIPELINE_REBUILD.md` — the pipeline this proves.
- `docs/tickets/SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS.md` — why one
  read-back assertion is currently weaker than it should be.
