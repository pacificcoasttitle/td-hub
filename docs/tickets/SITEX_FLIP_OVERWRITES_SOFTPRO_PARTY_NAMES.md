# SiteX owner flip overwrites correct SoftPro party names

**Status: documented, not fixed.** `process-detail.ts` / `enrich-orders.ts` are out of
scope for the entity-owner-names work.

Opened: 2026-08-26
Found while answering the SoftPro organization-routing question on
`fix/sitex-entity-owner-names`.

---

## Correction first — a claim in the previous report was wrong

An earlier report from this session stated that on order `20019200-OCT` our inbound sync
**dropped** the primary party `LUCHSHEYE CORP` and stored only the secondary,
`Sandy Nieves`.

**That is false and is retracted.** Both rows are present and correct:

| file_number | role | is_primary | external_name |
|---|---|---|---|
| 20019200-OCT | buyer | **true** | `LUCHSHEYE CORP` |
| 20019200-OCT | buyer | false | `Sandy Nieves` |

which matches SoftPro exactly (`Person.PrimaryBorrower = "LUCHSHEYE CORP"`,
`SecondaryBorrower = "Sandy Nieves"`).

The error was in the audit script, not the data: it keyed a lookup map by
`file_number|role` with no `is_primary`, so the second buyer row overwrote the first and
the primary looked missing. Nothing is dropped. `mapOrderContacts` reads
`buyer.Person.PrimaryBorrower` with a `Company.PrimaryBorrower` fallback and is correct.

**No orders need remediation for a dropped party.** The real defect below is narrower and
has a different cause.

---

## The actual defect

Our SiteX owner flip writes mangled organization names into `order_parties` on orders that
came from SoftPro — where SoftPro already holds the correct name.

`20020972-OCT`, traced end to end:

| Source | Value |
|---|---|
| SiteX gave us (`order_properties.primary_owner`, raw) | `LOUKA TONY LIVING TRUST (DTD 03/07/18)` |
| We stored (`order_parties.external_name`) | `Tony Living Trust (Dtd 03/07/18) Louka` |
| **SoftPro holds** (`GetOrderContacts`) | **`Tony Louka Living Trust (Dtd 03/07/18)`** |

The flip moved the first token to the end and title-cased the result — its exact signature.
SoftPro's copy is right; ours is not.

This is **not** the inbound SoftPro sync corrupting data. It is the SiteX enrichment path
overwriting a correct SoftPro value with a flipped SiteX one.

## Root cause is shared

The flip is correct for `SANCHEZ SERGIO T` and wrong for `LOUKA TONY LIVING TRUST`,
because a trust has no surname to move. That is the same defect being fixed on
`fix/sitex-entity-owner-names` — the entity-abstention rule, once landed, removes the
cause here too.

**What this ticket is for is the part the fix does not cover:** rows already written, and
the decision about which source wins when SoftPro and SiteX disagree about a party name.

## Scale

Of **112** organization-named buyer/seller parties on `softpro_sync` orders, **98** do not
end with their entity suffix — `... Llc Matana`, `... Living Trust Louka` — which is the
signature of a first-token move.

Read that as an upper bound, not a count. Some are legitimately shaped that way
(`Zachery Cullen (1008M14, LLC)`), and some arrived already mangled from upstream:
`Holdings Llc Matana` matches SoftPro **byte for byte**, so SoftPro received it that way
and we merely copied it. Confirming the true count means reading each order back.

Of 6 orders spot-checked against SoftPro, **1** diverged in a way attributable to us.

## Open questions for whoever takes this

1. **Who wins?** When SoftPro holds `Tony Louka Living Trust` and SiteX-derived
   enrichment produces something else, which value should sit in `order_parties`? SoftPro
   is the system of record for the order; SiteX is the system of record for the property.
   For a party name, SoftPro should probably win — but that is a product call.
2. **Backfill?** 98 rows are suspect, and the correct value is one `GetOrderContacts` call
   away per order. That is a read-only repair, but it is 98 vendor calls and it should not
   run before question 1 is settled.
3. **Should enrichment write party names at all** on an order SoftPro already populated?

## Not to be done here

Do not fix in `fix/sitex-entity-owner-names`. That branch owns `sitex-owner-names.ts`,
`parsers.ts`, `types.ts` and `client.ts`, and stops at producing a correct parse.
`process-detail.ts` and `enrich-orders.ts` belong to whoever takes this ticket.
