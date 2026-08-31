# auth.users token columns left NULL — magic link / recover 500

**Status:** filled 2026-08-31. Do not treat the fill as the fix for the *creator*.
**Symptom:** Supabase dashboard `POST /auth/v1/magiclink` and `/recover` returned
`Database error finding user`. Auth log:

```
error finding user: sql: Scan error on column index 3, name "confirmation_token":
converting NULL to string is unsupported
```

Not a permission failure. 0038/0039 were not implicated (no auth.users trigger,
no public function, no view joining auth, revoke did not touch `auth`).

## What was wrong

GoTrue scans `confirmation_token`, `recovery_token`, `email_change_token_new`,
and `email_change` as Go `string`, not `*string`. `NULL` cannot scan.

| created (UTC day) | users | tokens `NULL` | tokens `''` |
|---|---:|---:|---:|
| 2026-03-10 | 1 | 0 | 1 |
| **2026-03-17** | **15** | **14** | **1** |
| 2026-04-02 | 50 | 0 | 50 |
| 2026-05-19 | 1 | 0 | 1 |

The 14 NULL rows were the March 17 seed (all nine `open_order_team`, plus
admins created in the same three millisecond-identical batches). The one
March 17 exception is `bheethuis@pct.com` (`''`). April 2 is the sales-rep
Auth API seed (`seed-sales-rep-users` → `auth.admin.createUser`).

## What created them — and what will do it again

There is **no** `INSERT INTO auth.users` in this repository. The March 17
rows share three exact `created_at` timestamps (18:22:51, 18:23:15, 18:23:38
UTC) — a batched SQL insert or dashboard paste, not `createUser` one-by-one.

Live app paths that create users go through the Auth API and write `''`:

- `src/app/api/admin/invite-user/route.ts` — `auth.admin.createUser`
- `src/app/api/admin/seed-sales-rep-users/route.ts` — same

**Recurrence is any future SQL write to `auth.users` that omits those
columns** (SQL editor, one-off seed, an agent inserting rows). The Invite
User button is not the source. Users & Roles → Sync from SoftPro writes
`contacts` only, not `auth.users`.

## Fill applied 2026-08-31

On the 14 rows only, these four columns NULL → `''`:

`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`

No other `auth.users` columns. Sessions live on `auth.sessions` /
`auth.refresh_tokens`; 47 live refresh tokens were unchanged after the write.
After: 0 NULL / 67 empty on `confirmation_token`.

## Do not

- Insert into `auth.users` from SQL. Use `auth.admin.createUser`.
- Roll back 0039 over a magic-link 500. Check Auth logs for the Scan error first.
