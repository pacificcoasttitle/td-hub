# Marketing bridge — design (phase 1)

**Status:** design only. No integration code, no Mailchimp calls, no schema changes.
**Date:** Aug 10, 2026 · **Branch:** `feat/marketing-bridge-design`
**Companion:** [marketing-bridge-identity-mapping.md](./marketing-bridge-identity-mapping.md)

Route listing agents from TD Hub orders into the right sales rep's Mailchimp
audience, without TD Hub ever holding a Mailchimp credential.

```
TD Hub  ──POST /api/marketing/subscribers──▶  pct.com gateway  ──PUT──▶  Mailchimp
 (job)        bearer, shared secret              (holds the key)
```

**TD Hub never holds the Mailchimp API key.** It knows a gateway URL and a
shared secret scoped to one endpoint. If TD Hub is compromised, the blast radius
is "can enqueue subscribers", not "owns the marketing list".

---

## 1. Role scope for v1 — `listing_agent` only

Measured on production `order_parties`:

| Role | Parties | With email | **Distinct emails** | Verdict |
|---|---|---|---|---|
| `other` | 11,552 | 10,697 | **68** | ❌ internal noise — 5,363 `@pct.com` + 4,952 `@wltic.com` |
| `escrow_company` | 5,464 | 5,407 | 954 | ❌ our own customers — the CRM owns this relationship |
| `buyer` | 5,095 | **0** | 0 | ❌ no emails exist |
| `seller` | 3,165 | **0** | 0 | ❌ no emails exist |
| `lender` | 3,049 | 604 | 160 | ⏸ later candidate |
| **`listing_agent`** | **1,824** | **1,381** | **886** | ✅ **v1** |
| `lender_contact` | 1,391 | 959 | 382 | ⏸ later candidate |

`other` is the trap: 10,697 addresses that collapse to **68 distinct**, almost
all internal. Any "just send all party emails" approach would push ~10k rows at
Mailchimp to deliver 68 mostly-internal contacts.

`buyer` and `seller` have **literally zero** emails — SoftPro's `GetOrderContacts`
returns names only for those roles.

**884 of the 886 distinct listing agents** sit on orders that have a sales rep,
so nearly the whole set is routable in principle.

## 2. Denylist

Applied at the gateway, so it holds even if a future TD Hub caller is careless.

1. **Internal domains** — `@pct.com`, `@wltic.com`, `@pacificcoasttitle.com`,
   plus the underwriter/affiliate domains seen in `other`.
2. **Rep-owned domains** — reps whose contact email is *not* `@pct.com` also
   appear as parties: `angelineahn.com` (314 rows) and `joinnickwatt.com` (53).
   A domain denylist that only knows `@pct.com` misses these.
3. **The rep themselves** — never subscribe a rep to their own audience.
4. **House accounts** — see the mapping doc; these resolve to no audience at all.
5. **Disposable/test** — `yopmail.com` (an active test rep uses it).

Today only **2 of 886** listing-agent addresses are internal, so the denylist
buys little on this role — but it is what makes adding `lender_contact` or
`escrow_company` later a config change rather than an incident.

## 3. Gateway endpoint

### `POST https://www.pct.com/api/marketing/subscribers`

**Auth — this is the piece that does not exist today.** Everything on pct.com is
cookie session + `requireApiRole('marketing')`, which a server-to-server caller
cannot satisfy. v1 needs a machine path:

```
Authorization: Bearer <MARKETING_BRIDGE_TOKEN>
X-Request-Id:  <uuid>                     # client-generated, echoed back
X-Signature:   sha256=<hmac(secret, raw_body)>   # optional but recommended
```

- Token is a single-purpose secret, scoped to this one route — not a user
  session, not an admin key.
- Rotatable without a TD Hub deploy if TD Hub reads it from its own env at call
  time and pct.com accepts two valid tokens during a rotation window.
- HMAC over the raw body makes a leaked token insufficient on its own. Optional
  for v1; the token alone is acceptable if the endpoint is idempotent and
  rate-limited, which it is.

**Request**

```jsonc
{
  "idempotency_key": "ord:6646|role:listing_agent|em:9f2c…",  // see §4
  "source": {
    "system": "td_hub",
    "order_id": 6646,
    "file_number": "20020625-OCT",
    "party_role": "listing_agent"
  },
  "subscriber": {
    "email": "agent@example.com",
    "first_name": "Naret",          // optional, best-effort from external_name
    "last_name": "Tosaard"
  },
  "routing": {
    "rep_identity": "contact:22117",        // TD Hub contact id — the stable key
    "rep_email": "aahn@angelineahn.com",    // hint only; NEVER the sole matcher
    "rep_name": "Angeline Wu"
  },
  "consent": {
    "basis": "transactional_relationship",  // OPEN — see §8
    "captured_at": "2026-08-10T20:15:00Z",
    "status": "OPEN_PENDING_COMPLIANCE"     // subscribed vs pending — not decided
  }
}
```

**Response** — always `200` with a typed `result`, except auth/validation.
A typed result is what lets TD Hub tell "we should retry" from "this will never
work", which a bare HTTP code cannot.

| `result` | HTTP | Meaning | TD Hub behaviour |
|---|---|---|---|
| `accepted` | 200 | Upserted into the audience | success |
| `skipped_no_audience` | 200 | Rep resolved, but has no `mailchimp_audience_id` | success-skip; count it |
| `skipped_denylist` | 200 | Internal / rep / house-account address | success-skip |
| `skipped_unsubscribed` | 200 | Already `unsubscribed` or `cleaned` | **success-skip — never retry** |
| `rep_unmapped` | 200 | No bridge row and no email match | success-skip; **surfaces roster gaps** |
| `mailchimp_error` | 502 | Upstream failure | retry with backoff |
| — | 401 | Bad/missing token | alert, do not retry |
| — | 422 | Malformed body | do not retry; log |
| — | 429 | Gateway rate limit | retry after `Retry-After` |

```jsonc
{ "result": "accepted", "audience_id": "a1b2c3", "request_id": "…",
  "subscriber_hash": "9f2c…", "already_present": true }
```

The distinction between `skipped_no_audience` and `rep_unmapped` matters: the
first means "we know who this is, they have no list"; the second means "we do
not know who this is". They drive different fixes — one is a marketing-roster
gap, the other a bridge-table gap.

## 4. Idempotency

**Key:** `ord:{order_id}|role:{party_role}|em:{sha256(lower(trim(email)))[0:16]}`

Stable across SoftPro re-syncs, because none of its inputs change when an order
is re-fetched. The look-back sync re-reads thousands of orders on a schedule;
without this, every sweep would re-POST every party.

- Gateway stores the key in the audit table with a unique index and returns the
  **original** result on a repeat, without calling Mailchimp.
- Deliberately **not** time-boxed. "Same order, same role, same address" is the
  same fact forever.
- Email is hashed in the key so the audit table never needs the plaintext.

Two layers of protection, because they fail differently: the idempotency key
stops repeat *work*, and Mailchimp's `PUT` (§5) makes a repeat *harmless* if the
key layer is ever bypassed.

## 5. The Mailchimp write

```
PUT /3.0/lists/{audience_id}/members/{md5(lower(trim(email)))}
{ "email_address": "...", "status_if_new": "<pending|subscribed — §8>",
  "merge_fields": { "FNAME": "...", "LNAME": "..." } }
```

- `PUT` is an idempotent upsert — no duplicate members, no "already exists"
  error to special-case.
- **`status_if_new`, never `status`.** `status` would overwrite an existing
  member's state and could resurrect someone who opted out. `status_if_new`
  only applies on creation.
- **MD5 is Mailchimp's addressing scheme, not a security choice.** It is
  required by their API. Do not "upgrade" it to SHA-256 — the request will 404.
  Use SHA-256 for our own audit hashing (§6), where the choice is ours.

**Never re-subscribe someone who opted out.** Before writing, read the member:
if `status` is `unsubscribed` or `cleaned`, return `skipped_unsubscribed` and
stop. That is a **success**, not an error and not a retry — retrying an opt-out
is the single worst failure mode this system has, both legally and for sender
reputation.

## 6. Audit table (on pct.com)

```sql
marketing_bridge_log (
  id                bigserial primary key,
  idempotency_key   text not null unique,     -- powers §4
  source_system     text not null,            -- 'td_hub'
  source_order_id   integer,
  source_file_number text,
  party_role        text not null,
  email_sha256      char(64) not null,        -- NEVER the plaintext address
  email_domain      text,                     -- kept: useful, low-sensitivity
  rep_identity      text,
  audience_id       text,
  result            text not null,            -- the §3 enum
  mailchimp_status  text,                     -- subscribed | pending | unsubscribed | cleaned
  error_detail      text,
  request_id        uuid,
  created_at        timestamptz not null default now()
)
```

**No full emails.** The hash supports dedupe, idempotency, and "did we ever
touch this person" without the log becoming a marketing database of its own. The
domain is kept deliberately — it answers most operational questions ("are we
sending to internal addresses?") and is far less sensitive than the local part.

Indexes: `unique(idempotency_key)`, `(created_at)`, `(result)`, `(rep_identity)`.

## 7. TD Hub side

### Emitter

A new job, **`marketing.emit_subscribers`**, on the established handler pattern.

**Not** a hook on order creation. Emitting inline would put a third-party
dependency in the order path, and the trigger we actually want ("this order has
a listing agent with an email") is only true *after* `enrich_orders` writes
parties — which is minutes to hours later.

**Trigger:** cursor over `order_parties` where `role='listing_agent'`, email is
non-empty, and the order has a `sales_rep_id` — same claim-by-id, high-water
cursor shape as `softpro.lookback_sync`, with the cursor in the job payload.

**Backlog:** 884 distinct routable agents, 1,378 parties. A first sweep is
small; steady state is a handful per day.

**Retry/backoff:** only `mailchimp_error` (502) and `429` are retryable.
Exponential backoff 1m → 5m → 30m, max 3 attempts, then park the row and count
it. Every `skipped_*` and `rep_unmapped` is terminal-success and must never be
retried — retrying a skip is how you end up hammering the gateway with requests
that can never succeed.

**Kill switch:** DB-backed setting **`marketing_bridge_shut_off`**, same pattern
as `lookback_sync_shut_off`, checked before any outbound call. Not an env var:
a Vercel env change needs a redeploy to take effect, which is useless in an
incident. Flipping it stops the next run; the cursor is untouched, so it resumes.

**Counts on the job payload** (the `recordRun` pattern): `examined`, `accepted`,
`skipped_*` per reason, `rep_unmapped`, `errors`, `stoppedEarly`, `nextCursorId`.
`rep_unmapped` is the number to watch — it is the roster-hygiene signal.

### Rate limiting and batching

- **Concurrency 1–2, 250ms spacing.** Mailchimp's per-key limit is 10
  simultaneous connections, and the gateway serialises on top; there is no
  deadline pressure here, so slow is free.
- **Bounded per run** (~200 subscribers) under the 239s deadline guard, so it
  fits the job runner ceiling with room for a worst-case unit.
- Mailchimp offers a batch endpoint. **Not for v1** — it is asynchronous, so you
  trade a simple per-item result for polling a batch job and reconciling partial
  failures. At this volume the simple path wins.
- Schedule off-peak if it ever shares the window with the look-back sync; they
  hit different vendors, so it is not required.

## 8. Consent — OPEN, pending compliance

**This is the one thing that gates going live, and it is not an engineering
decision.**

The contract carries `consent.basis` and `consent.captured_at` now, so the
decision is a value change rather than a schema change. What is undecided:

| Option | `status_if_new` | Trade-off |
|---|---|---|
| Single opt-in | `subscribed` | Everyone lands on the list; highest legal exposure |
| **Double opt-in** | `pending` | Mailchimp sends a confirmation; only confirmers join |

Everything else in this design works identically either way. **The gateway
should read the value from its own config, not from the TD Hub request** — so
the decision is made once, in one place, by the people accountable for it, and
cannot be overridden by a caller.

Until it is settled, the member-add call is the only step that must not ship.
Everything else — identity mapping, denylist, audit, idempotency — can be built
and exercised with the write disabled.

## 9. What phase 1 does not do

No unsubscribe sync back to TD Hub, no merge-field/tag taxonomy, no
`lender_contact`/`escrow_company` roles, no backfill of historical orders beyond
the 884, no Mailchimp batch endpoint.
