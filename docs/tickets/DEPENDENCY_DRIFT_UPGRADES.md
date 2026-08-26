# Dependency drift frozen by the lockfile, and the upgrade it deferred

Status: ticketed, not started. Opened 2026-08-26 alongside `d8f8e1d`, which committed
the repo's first lockfile.

## What happened

No lockfile was committed until 2026-08-26, so every Vercel production build and every
CI run resolved `package.json`'s caret ranges from scratch. What shipped depended on
when the build ran.

`d8f8e1d` stopped that by pinning the tree we test against. It deliberately did **not**
take the newer versions a cold resolution would pick, because that is a dependency
upgrade and needed its own testing pass rather than riding along in a build-hygiene
commit.

## The size of what was frozen

Resolving `package.json` cold on 2026-08-26 puts **174 packages** on versions newer than
the pinned tree (750 pinned entries versus 772 cold).

By family:

| family | packages moved | ships to production runtime |
|---|---|---|
| `tsx` | 28 | no — script runner |
| `@aws-sdk` | 18 | **yes** — S3 document storage |
| `@tailwindcss` | 18 | yes — CSS output |
| `@rolldown` | 14 | no — bundler internals |
| `@typescript-eslint` | 14 | no |
| `@supabase` | 7 | **yes** — every query and auth call |
| `@smithy` | 6 | yes — AWS transport layer |
| `@vitest` | 6 | no |
| `@babel`, `@types`, `vitest`, `@eslint` | 14 | no |

The two that carry real risk:

```
@aws-sdk/client-s3            3.1068.0 -> 3.1118.0
@aws-sdk/s3-request-presigner 3.1068.0 -> 3.1118.0
@supabase/supabase-js         2.108.2  -> 2.112.4
```

The S3 client and presigner are what store and hand out prelim documents. Supabase is
every read and write. Fifty AWS SDK releases is not a patch bump in practice, even
inside a caret range.

`next` (16.1.6), `react` (19.2.3) and `react-dom` are pinned exactly in `package.json`,
so they do not move.

## The second, quieter problem

528 of the 750 pinned entries carry a version but no `resolved` URL and no integrity
hash, because npm reconstructed them from the installed tree rather than from registry
metadata. Consequences:

- Versions are pinned, which is what stops the drift. This is the property we wanted.
- Tarball integrity is not verified on install, so a compromised or altered registry
  artifact would not be detected.
- `npm ci` works against it regardless — verified on Linux CI and locally.

Closing the integrity gap requires a cold resolution, which means taking the 174
upgrades. The two are the same piece of work.

## Approach when this is picked up

1. Regenerate the lockfile cold: delete it, `npm install --package-lock-only`, confirm
   all entries carry `resolved` and `integrity`.
2. `npm ci` from scratch locally, then `npm run typecheck`, `npm run typecheck:scripts`
   and the full suite. The suite was 1061 tests at the time of writing.
3. Exercise what the SDK bumps touch, because tests mock the vendors: upload a document
   and fetch it through a presigned URL, and run a prelim fetch end to end.
4. Deploy and watch. Do not merge on a Friday.
5. Keep the diff in the PR body so the reviewer sees which 174 moved.

## Why not just do it now

Nothing is broken today. The pinned tree is the tree 1061 tests pass against and the one
production has been running since `d8f8e1d`. The upgrade buys integrity verification and
current AWS/Supabase clients; it costs a real verification pass on the two integrations
that carry customer documents.
