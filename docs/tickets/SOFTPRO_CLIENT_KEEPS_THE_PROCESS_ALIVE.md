# A process that uses the SoftPro client never exits on its own

**Status: mechanism identified, NOT fixed.**
Opened: 2026-08-28
Found: while diagnosing two background runs that produced empty output files.

## Read this first — the ticket it replaces was wrong

This was opened on my claim that *"something in the typed SoftPro client hangs
indefinitely on these read paths where a plain `fetch` to the same URL returns
immediately."*

**That is false, and it was tested rather than reasoned about.** The typed
client is fine:

```
LINE 1: process started, nothing imported yet
LINE 2 (2.2s): client imported
LINE 3 (2.2s): calling getOrderContacts…
LINE 4 (5.8s): getOrderContacts returned success=true
LINE 5 (5.8s): calling getOrderDetails…
LINE 6 (8.8s): getOrderDetails returned success=true, items=1
LINE 7 (8.8s): done — process should now exit
LINE 8 (13.8s): STILL ALIVE 5s after finishing — something holds the event loop
```

Both calls returned in about three seconds. No hang, and the `AbortSignal`
never needed to fire because nothing stalled.

**LINE 8 is the real finding.** All work finished at 8.8s and the process was
still running at 13.8s. It never exits.

## The mechanism

`makeRequest` calls `logRequest` on every request, success or failure
(`softpro/client.ts:65`), and `logRequest` writes through the **shared**
database client:

```ts
// softpro/client.ts:36
import { db } from '@/lib/db/client';
// softpro/client.ts:80
    await db.insert(vendorApiLogs).values({ … });
```

That client owns a `postgres` connection pool. The pool holds an open socket,
an open socket is an active libuv handle, and an active handle keeps the Node
event loop alive. Nothing in the client closes it, and nothing should — in the
Next.js server the pool is meant to persist between requests.

So: **one SoftPro call from a standalone process leaves that process running
forever.**

## Why it read as a hang

The two background runs wrote stdout to a file rather than a terminal. Node
block-buffers a non-TTY stdout instead of line-buffering it. The sequence was:

1. script does its work, writing into the stdout buffer
2. work completes
3. process does not exit, because the pool holds the loop open
4. process is eventually killed
5. **the buffered stdout is discarded with it — the file is empty**

The harness reported exit code 0 and "completed", so an empty file looked like
a run that had produced nothing. I read that as evidence of a hang in the
vendor call. It was evidence of a process that finished and could not leave.

An earlier run of the same shape did produce output, which is what made this
confusing: whether the buffer reaches the file before the kill is a matter of
buffer size and timing, not of anything the script did.

## Actual blast radius — narrower than "it will hang a cron or a create"

| context | affected? |
|---|---|
| Next.js request handlers | **No.** The pool is supposed to persist; the request returns normally. |
| Vercel cron hitting an HTTP route | **No.** Same as above — it is a request. |
| A standalone `node`/`tsx` script calling the client | **Yes.** Never exits. |
| Anything run in CI or a container expecting exit | **Yes.** Hangs until killed. |

The client returns correctly in every case. What is broken is process
lifecycle, not the request path. Nothing in production is currently hanging
because of this — every production caller is a request handler.

## What a fix would involve

Not attempted. Sketched only:

- Give standalone entry points an explicit teardown that closes the shared pool
  (`db.$client.end()` or equivalent) in a `finally`.
- Or have scripts call `process.exit()` once their work is done, accepting that
  it discards buffered output unless flushed first.
- Either way, **anything writing stdout to a file should flush before exiting**,
  otherwise a killed process silently loses its entire output — which is the
  part that actually cost time here.

## Why it is worth a ticket rather than a note

The failure mode is *exit 0, having produced nothing*. That is the same shape
as several defects already logged today — a value collected and discarded, a
detector that tallies and never writes, a chip that reports absence beside a
working action. Here it is in the transport layer, and it is the one that made
two measurements silently disappear and produced a false finding that survived
into a document.
