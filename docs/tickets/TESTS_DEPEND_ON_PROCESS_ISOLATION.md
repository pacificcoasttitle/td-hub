# 71 tests pass only because each file gets its own process

**Status:** open — measured, not fixed
**Raised:** 2026-09-22, while fixing the local test timeouts

## What was found

Vitest runs each test file in its own forked process by default. Turning that
off — `isolate: false`, which lets a worker reuse its module registry across
files instead of re-importing everything 256 times — takes the suite from
**213s to 150s**.

It also fails **71 tests across 11 files**, which pass today for no better
reason than that a fresh process hides them.

One example, from `src/app/api/client/orders/[id]/documents/route.test.ts`:
the route returns 500 instead of 200 when another file has run first in the
same worker. The test asserts a clean mock of the database; what it gets is
whatever the previous file left in the module registry.

## Why it matters beyond the 60 seconds

A test that only passes in a fresh process is a test that is not asserting
what it appears to assert. It is the same family as the memoised bundle guard
that passed by not running: green, and not measuring what its name claims.

The 60 seconds is not the reason to fix it. The reason is that 71 tests are
currently making a weaker statement than they look like they are making, and
nobody knows which of the 71 would still pass if the coupling were removed
honestly.

## What it would take

1. Run `npx vitest run --no-isolate` and collect the 11 files.
2. For each, find the shared state. The likely shapes, in order: module-level
   caches that are never reset, `vi.mock` factories holding state across
   files, `process.env` mutated in one file and read in another, and
   singletons in `src/lib/db/client` or the S3 client.
3. Fix the tests, not the config — a module-level cache that leaks between
   test files usually leaks between requests in production too, which is the
   more interesting half of this ticket.
4. When all 256 files pass with `--no-isolate`, set it in `vitest.config.ts`
   and take the 60 seconds.

## Related

The worker cap and raised `testTimeout` in `vitest.config.ts` are the
immediate fix for the local failures and are unaffected by this. The numbers
behind them are in that file's header comment.
