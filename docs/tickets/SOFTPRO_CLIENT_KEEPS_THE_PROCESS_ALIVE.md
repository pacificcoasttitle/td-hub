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

## The fix for scripts — do this one now

**Any standalone script that makes a SoftPro call must close the pool or exit
explicitly.** It is one line, and its absence has now cost three
investigations, one destroyed measurement sample, and two wrong mechanisms.

```ts
// At the end of any standalone script that touches the SoftPro client.
// The client logs every request through the shared pool; the pool holds the
// event loop open; without this the process finishes its work and then sits
// there until something kills it — losing block-buffered stdout with it.
import { db } from '@/lib/db/client';

try {
  // … work …
} finally {
  await db.$client.end();
}
```

If a script also opens its own `postgres()` handle for queries, close **both**.
Closing one does not close the other.

**Not yet explained:** one earlier script did close its own handle with
`await sql.end()` and *did* exit cleanly, printing its full output, despite also
making SoftPro calls that should have left the shared pool open. That
contradicts the mechanism above and has not been investigated. It may be
timing, a failed log insert leaving no live handle, or something else. Recorded
as an open loose end rather than smoothed over — the whole point of this ticket
is that three mechanisms were asserted before one was measured.

**And flush stdout before any hard exit.** `process.exit()` discards a buffered
non-TTY stdout. If a script must exit hard:

```ts
process.stdout.write('', () => process.exit(0));
```

That flush is the part that actually cost the time here: the runs did their
work correctly and then lost every line of it.

## What a fix for the library would involve

Not attempted, and lower priority than the script rule above, because nothing
in production is affected.

- An explicit `closeSoftProClient()` / pool teardown export, so callers do not
  have to know that a logging side effect owns a socket.
- Or make `logRequest` fire-and-forget onto a queue that does not hold a handle.
- Neither is urgent: request handlers want the pool to persist, and they are
  every production caller.

## Why it is worth a ticket rather than a note

The failure mode is *exit 0, having produced nothing*. That is the same shape
as several defects already logged today — a value collected and discarded, a
detector that tallies and never writes, a chip that reports absence beside a
working action. Here it is in the transport layer, and it is the one that made
two measurements silently disappear and produced a false finding that survived
into a document.
