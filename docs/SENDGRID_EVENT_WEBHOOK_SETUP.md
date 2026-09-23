# Turning on the SendGrid event webhook

Ten minutes, in the SendGrid dashboard and Vercel. Until this is done the
endpoint is live and correct and receives nothing.

## 1. SendGrid → the webhook

**Settings → Mail Settings → Event Webhook → Create new webhook**

**Post URL — paste exactly this:**

```
https://hub.pctdesk.com/api/webhooks/sendgrid/events
```

**Events to subscribe to.** Tick these five and nothing else:

| Section | Tick | Why |
| --- | --- | --- |
| Deliverability | **Delivered** | the only thing that earns the word Delivered |
| Deliverability | **Bounced** | the receiving server refused it |
| Deliverability | **Dropped** | SendGrid never tried — **this is the silent one** |
| Deliverability | **Deferred** | retry in progress; stored for diagnosis, shown to nobody |
| Engagement | **Spam Reports** | we got through and a person rejected us |

**Leave unticked:**

- **Processed** — fires for every single message and tells us nothing we did
  not already log ourselves. It would roughly double the traffic for nothing.
- **Opened, Clicked, Unsubscribed, Group Unsubscribes/Resubscribes** — we do
  not track engagement, and open tracking rewrites links in client emails.

**Dropped is the one that matters most.** It is the event for a message sent
to an address already on a suppression list: SendGrid answers our API call
with a 202 and never attempts delivery. That is how seventeen emails —
six prelims and eleven confirmations — were recorded as sent between April
and September 2026 while reaching nobody.

## 2. Signature verification — turn it ON

Same page, toggle **Enable Signature Verification**. SendGrid then shows a
**public key**.

This is not optional. The endpoint **refuses every batch** until the key is
configured — it will not accept unverified events, because anything that can
write to it could silence a real bounce by asserting `delivered`.

The key is public: it can only *check* signatures, not create them, so there
is no risk in it being stored or seen.

## 3. Vercel → the key

**Vercel → td-hub → Settings → Environment Variables**

| Name | Value | Environments |
| --- | --- | --- |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | the key SendGrid just showed | Production |

Paste it exactly as shown. Bare base64 or full PEM both work.

**Then redeploy** — environment variables are read at build time, so the
variable does nothing until the next deployment.

## 4. Check it works

In SendGrid, the Event Webhook page has a **Test Your Integration** button.
It sends a sample batch.

- A **200** with `{"ok":true,...}` means the signature verified.
- A **401** means the key is wrong, missing, or the redeploy has not happened.

SendGrid's test events use invented message ids, so the response will say
`unmatched: N` and `kept: 0`. **That is correct** — those events are not ours,
and the same filter is what keeps the other sender's traffic on this account
out of our numbers.

To confirm it is working on real mail, send a report to yourself from the
Reports page and watch the Delivery column go from **Sent** to **Delivered**
within a minute or so.

## What you will see afterwards

The Delivery column stops claiming and starts reporting:

| | means |
| --- | --- |
| **Sent** (navy) | accepted by SendGrid, nothing heard yet — usually seconds |
| **Delivered** (green) | the receiving server took it. Proved, not assumed |
| **Bounced** (red) | refused — the address is wrong |
| **Dropped** (red) | never attempted — we are mailing an address SendGrid gave up on |
| **Spam** (amber) | it arrived and a person rejected it |

## One thing still open

The SendGrid account is not only ours: it shows roughly 99,900 requests
against our 5,500 for the same period. Something else at Pacific Coast Title
sends on it. Whatever holds that API key can also read the suppression lists
and send as Pacific Coast Title, so it is worth identifying.

The webhook is already filtered to our own sends and is unaffected by it —
but any alerting built on account-level numbers would be measuring them
rather than us.
