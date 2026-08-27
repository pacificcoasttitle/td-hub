/**
 * READ-ONLY follow-up to scripts/audit/latch-and-buyer-agent-impact.ts.
 *
 * That script established that SoftPro returns NO email and NO person lookup
 * code for the buyer's agent on any of the 7 files that carry one. That closes
 * off the direct route to a new email recipient, but not the indirect one:
 * `resolvePartyIdentityFromMaster` also fills `email` from the `companies` row
 * matched on `companyLookupCode`, and one of the 7 files (`20005524-ONT`)
 * returned `Coldw840`.
 *
 * So this measures the remaining surface:
 *   1. Whether the companies rows reachable from a buyer-agent company lookup
 *      code hold an email.
 *   2. How broad that risk is across all real-estate companies.
 *   3. Whether the live `order.closed` path — which emails each `buyer_agent`
 *      party row individually via resolveRecipients — is actually firing, since
 *      it is a far higher-volume path than the confirmation.
 *   4. What the comparable `listing_agent` rows already look like, as the
 *      control: that role has 1,971 rows and the same code emails them today.
 *
 * Every statement is a SELECT. No vendor calls.
 *
 *   npx tsx --env-file=.env.local scripts/audit/buyer-agent-email-surface.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

/** The only company lookup code the buyer-agent probe returned across 7 files. */
const BUYER_AGENT_COMPANY_CODES = ['Coldw840'];

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  show(
    'C1 companies reachable from the buyer-agent company lookup codes observed',
    await sql`
      select id, name, lookup_code, source_id, email, phone, is_real_estate_company
      from companies
      where lookup_code = any(${BUYER_AGENT_COMPANY_CODES}::text[])
         or source_id   = any(${BUYER_AGENT_COMPANY_CODES}::text[])
      order by id
    `,
  );

  show(
    'C2 how many companies hold an email at all (the indirect-route risk surface)',
    await sql`
      select is_real_estate_company,
             count(*)::int as companies,
             count(*) filter (where nullif(btrim(email), '') is not null)::int as with_email
      from companies group by 1 order by 2 desc
    `,
  );

  // The live order.closed dispatch resolves buyer_agent party rows into
  // individual TO recipients. If it never fires, adding rows changes nothing
  // there; if it fires often, it is the bigger exposure than the confirmation.
  show(
    'N1 notification_logs volume by event type',
    await sql`
      select event_type, status, count(*)::int as logs,
             min(created_at)::date as first_seen, max(created_at)::date as last_seen
      from notification_logs group by 1, 2 order by 3 desc
    `,
  );

  show(
    'N2 outbox events by type — what actually gets enqueued',
    await sql`
      select event_type,
             count(*)::int as events,
             count(*) filter (where published_at is not null)::int as published,
             min(created_at)::date as first_seen, max(created_at)::date as last_seen
      from event_outbox group by 1 order by 2 desc
    `,
  );

  // The control: listing_agent is written by the same mapper style this change
  // copies, and the same dispatch code already emails it.
  show(
    'A1 agent party rows: how many carry a reachable email today',
    await sql`
      select p.role,
             count(*)::int as rows,
             count(*) filter (where nullif(btrim(p.external_email), '') is not null)::int as with_external_email,
             count(*) filter (where p.contact_id is not null)::int as with_contact_id,
             count(*) filter (where nullif(btrim(c.email), '') is not null)::int as with_contact_email
      from order_parties p
      left join contacts c on c.id = p.contact_id
      where p.role in ('listing_agent', 'buyer_agent')
      group by 1 order by 2 desc
    `,
  );

  // Migration 0035 raises on a duplicate (order_id, role, is_primary). Confirm
  // the index exists and that nothing in the latched set already holds a
  // buyer_agent row that a re-enrich could collide with.
  show(
    'U1 unique index on order_parties',
    await sql`
      select indexname, indexdef from pg_indexes
      where tablename = 'order_parties' order by indexname
    `,
  );

  show(
    'U2 latched orders that already hold any party row (collision candidates)',
    await sql`
      select count(*)::int as latched,
             count(*) filter (
               where exists (select 1 from order_parties p where p.order_id = o.id)
             )::int as latched_with_any_party,
             count(*) filter (
               where exists (
                 select 1 from order_parties p
                 where p.order_id = o.id and p.role = 'buyer_agent'
               )
             )::int as latched_with_buyer_agent
      from orders o
      where o.contacts_empty_confirmed = true
    `,
  );

  show(
    'U3 existing duplicate (order_id, role, is_primary) groups — must be zero',
    await sql`
      select count(*)::int as duplicate_groups from (
        select order_id, role, is_primary
        from order_parties
        group by 1, 2, 3 having count(*) > 1
      ) d
    `,
  );

  // The 92: the concrete dry-run population, listed so the preview and the
  // eventual live run can be compared row for row.
  show(
    'D1 the latched population, listed',
    await sql`
      select o.id, o.file_number, o.transaction_type, o.operational_status,
             o.opened_at::date as opened,
             o.last_contacts_fetch_at::date as last_fetch,
             (select count(*)::int from order_parties p where p.order_id = o.id) as party_rows
      from orders o
      where o.contacts_empty_confirmed = true
      order by o.last_contacts_fetch_at asc nulls first, o.id
    `,
  );

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
