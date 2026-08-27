/**
 * READ-ONLY impact measurement for the two defects in
 * docs/tickets/SOFTPRO_MISSING_BUYER.md.
 *
 * Answers, against production, the two questions the fixes cannot be reviewed
 * without:
 *
 *   1. How much does making `contacts_empty_confirmed` releasable increase the
 *      enrich job's per-run vendor call volume? Measured by counting the
 *      eligible population under the CURRENT picker predicate and under each
 *      candidate replacement, not by reasoning about it.
 *
 *   2. Would mapping `BuyersAgentBrokers` cause a confirmation email to start
 *      going to somebody who has never received one? That needs three facts:
 *      whether the vendor supplies a buyer-agent EMAIL (a name alone changes
 *      nobody's inbox), whether the buyer agent's lookup code resolves to a
 *      local contact that HAS an email, and whether enrichment lands before the
 *      confirmation is sent.
 *
 * Every SQL statement is a SELECT. The SoftPro calls are GET GetOrderContacts
 * only, issued through raw `fetch` rather than `client.ts` so the probe appends
 * no `vendor_api_logs` rows and no Postgres write of any kind occurs.
 *
 *   npx tsx --env-file=.env.local scripts/audit/latch-and-buyer-agent-impact.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

/**
 * The seven files the diagnosis probe found carrying a real buyer's agent, plus
 * the two latched files. Re-read here for the ONE fact the diagnosis did not
 * record: whether the agent has an email address.
 */
const BUYER_AGENT_FILES = [
  '20017694-ONT', '20012563-PRV', '20005524-ONT', '20019416-ONT',
  '20021133-ONT', '20017912-ONT', '20015577-PRV',
];

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

// ─── Vendor reads (GET only, no client.ts, no vendor_api_logs) ────────────────

interface BuyerAgentShape {
  fileNumber: string;
  httpStatus: number | null;
  keyPresent: boolean;
  personName: string | null;
  personEmail: string | null;
  personPhone: string | null;
  personLookupCode: string | null;
  companyName: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  companyLookupCode: string | null;
  error: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function readBuyerAgent(base: string, fileNumber: string): Promise<BuyerAgentShape> {
  const url = `${base}ordercreation/GetOrderContacts?${new URLSearchParams({ orderNumber: fileNumber }).toString()}`;
  const token = process.env.SOFTPRO_TOKEN;
  const blank: BuyerAgentShape = {
    fileNumber, httpStatus: null, keyPresent: false,
    personName: null, personEmail: null, personPhone: null, personLookupCode: null,
    companyName: null, companyEmail: null, companyPhone: null, companyLookupCode: null,
    error: null,
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-API-KEY': token } : {}) },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ...blank, httpStatus: res.status, error: 'non-JSON response' };
    }

    const data = (body.data ?? body) as Record<string, unknown>;
    const role = data.BuyersAgentBrokers as Record<string, unknown> | null | undefined;
    const person = (role?.Person ?? null) as Record<string, unknown> | null;
    const company = (role?.Company ?? null) as Record<string, unknown> | null;

    return {
      fileNumber,
      httpStatus: res.status,
      keyPresent: Object.prototype.hasOwnProperty.call(data, 'BuyersAgentBrokers'),
      personName: str(person?.Name),
      personEmail: str(person?.Email),
      personPhone: str(person?.Phone),
      personLookupCode: str(person?.LookupCode),
      companyName: str(company?.Name),
      companyEmail: str(company?.Email),
      companyPhone: str(company?.Phone),
      companyLookupCode: str(company?.LookupCode),
      error: null,
    };
  } catch (err) {
    return { ...blank, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  show('clock', await sql`select now() as now_utc`);

  // ── Defect 1: the latch, and what releasing it costs ──────────────────────

  show(
    'L1 latched population',
    await sql`
      select o.transaction_type,
             count(*)::int as latched,
             count(*) filter (
               where not exists (select 1 from order_parties p where p.order_id = o.id)
             )::int as latched_zero_parties,
             min(o.last_contacts_fetch_at)::date as oldest_fetch,
             max(o.last_contacts_fetch_at)::date as newest_fetch
      from orders o
      where o.contacts_empty_confirmed = true
      group by 1 order by 2 desc
    `,
  );

  show(
    'L2 latched orders by fetch age band and terminal-vs-open status',
    await sql`
      select case
               when o.last_contacts_fetch_at is null                             then 'never'
               when o.last_contacts_fetch_at < now() - interval '30 days'        then '>30d'
               when o.last_contacts_fetch_at < now() - interval '7 days'         then '7-30d'
               else '<7d'
             end as fetch_age,
             o.operational_status,
             count(*)::int as latched
      from orders o
      where o.contacts_empty_confirmed = true
      group by 1, 2 order by 3 desc
    `,
  );

  // The picker predicate, decomposed. `eligible_now` reproduces the shipped
  // WHERE clause exactly; the others substitute one arm at a time so the extra
  // vendor calls attributable to each candidate fix are separable.
  show(
    'L3 enrich picker: eligible population under current vs candidate predicates',
    await sql`
      with base as (
        select o.id,
               o.contacts_empty_confirmed as latched,
               o.last_contacts_fetch_at,
               (o.lender_id is null and o.listing_agent_id is null
                and o.title_company_id is null and o.underwriter_id is null)
                 or o.client_contact_id is null
                 or not exists (select 1 from order_parties p where p.order_id = o.id)
                 as needs_data,
               (o.last_contacts_fetch_at is null
                or o.last_contacts_fetch_at < now() - interval '6 hours') as stale_6h,
               (o.last_contacts_fetch_at is null
                or o.last_contacts_fetch_at < now() - interval '7 days') as stale_7d
        from orders o
      )
      select
        count(*) filter (where needs_data and stale_6h and not latched)::int
          as eligible_now,
        count(*) filter (where needs_data and stale_6h)::int
          as eligible_if_latch_deleted,
        count(*) filter (where needs_data and (
                (not latched and stale_6h) or (latched and stale_7d)
              ))::int as eligible_if_latch_expires_7d,
        count(*) filter (where needs_data and (
                (not latched and stale_6h) or (latched and stale_7d)
              )) - count(*) filter (where needs_data and stale_6h and not latched)::int
          as added_by_7d_expiry,
        count(*) filter (where latched and needs_data and stale_7d)::int
          as latched_and_7d_stale
      from base
    `,
  );

  // A run is capped at SOFTPRO_ENRICH_ORDERS_BATCH_SIZE (default 25), so what
  // actually changes per run is which 25 come back, not how many. This is the
  // backlog the cap is draining, and the honest measure of the change.
  show(
    'L4 enrich run cadence and observed calls per run, last 14 days',
    await sql`
      select date_trunc('day', l.started_at)::date as day,
             count(*)::int as enrich_contact_calls,
             count(distinct l.order_id)::int as distinct_orders
      from vendor_api_logs l
      where l.operation = 'enrich_order_contacts'
        and l.started_at >= now() - interval '14 days'
      group by 1 order by 1 desc
    `,
  );

  // ── Defect 2: who would newly be emailed ──────────────────────────────────

  show(
    'B1 order_parties role census (buyer_agent expected 0)',
    await sql`
      select role, count(*)::int as rows, count(distinct order_id)::int as orders
      from order_parties group by 1 order by 2 desc
    `,
  );

  show(
    'B2 notification_types whose recipient_roles include buyer_agent',
    await sql`
      select slug, display_name, is_enabled, channels, recipient_roles
      from notification_types
      where recipient_roles @> array['buyer_agent']::text[]
      order by slug
    `,
  );

  show(
    'B3 all notification_types, enabled flag and roles (context for B2)',
    await sql`
      select slug, is_enabled, channels, recipient_roles
      from notification_types order by slug
    `,
  );

  // Does enrichment land before the confirmation is sent? If it does, party
  // rows written by enrichment are visible to the recipient resolver.
  show(
    'B4 confirmation sends vs first enrich, same order',
    await sql`
      with conf as (
        select nl.order_id, min(nl.sent_at) as confirmed_at
        from notification_logs nl
        where nl.event_type = 'order.confirmation'
          and nl.status in ('sent', 'sent_no_client')
          and nl.sent_at is not null
        group by 1
      ),
      enr as (
        select l.order_id, min(l.started_at) as first_enrich_at
        from vendor_api_logs l
        where l.operation = 'enrich_order_contacts'
        group by 1
      )
      select count(*)::int as confirmed_orders,
             count(enr.first_enrich_at)::int as also_enriched,
             count(*) filter (where enr.first_enrich_at < conf.confirmed_at)::int
               as enriched_before_confirmation,
             count(*) filter (where enr.first_enrich_at >= conf.confirmed_at)::int
               as enriched_after_confirmation
      from conf left join enr on enr.order_id = conf.order_id
    `,
  );

  show(
    'B5 orders still awaiting a confirmation (future sends this would affect)',
    await sql`
      select o.email_status, o.source, count(*)::int as orders,
             count(*) filter (where o.opened_at >= now() - interval '30 days')::int as opened_30d
      from orders o
      where not exists (
        select 1 from notification_logs nl
        where nl.order_id = o.id and nl.event_type = 'order.confirmation'
      )
      group by 1, 2 order by 3 desc
    `,
  );

  // ── Vendor: does the buyer agent have an email at all? ─────────────────────

  const base = process.env.SOFTPRO_API_URL;
  if (!base) {
    console.log('\n=== V0 SKIPPED: SOFTPRO_API_URL not set ===');
  } else {
    console.log(`\n=== V0 SoftPro base URL (unmodified from env) ===\n${base}`);
    const shapes: BuyerAgentShape[] = [];
    for (const fileNumber of BUYER_AGENT_FILES) {
      shapes.push(await readBuyerAgent(base, fileNumber));
    }
    show('V1 BuyersAgentBrokers per file, including email fields', shapes);

    show('V2 summary: how many carry a usable email', {
      files: shapes.length,
      keyPresent: shapes.filter((s) => s.keyPresent).length,
      withPersonName: shapes.filter((s) => s.personName).length,
      withCompanyName: shapes.filter((s) => s.companyName).length,
      withPersonEmail: shapes.filter((s) => s.personEmail).length,
      withCompanyEmail: shapes.filter((s) => s.companyEmail).length,
      withAnyEmail: shapes.filter((s) => s.personEmail ?? s.companyEmail).length,
      withPersonLookupCode: shapes.filter((s) => s.personLookupCode).length,
    });

    // A null vendor email is not the end of it: upsertResolvedParty attaches a
    // contact_id when the lookup code matches, and the recipient resolver
    // prefers contacts.email over external_email. So the lookup codes have to
    // be checked against our own contacts table too.
    const codes = shapes
      .map((s) => s.personLookupCode)
      .filter((c): c is string => Boolean(c));

    if (codes.length === 0) {
      show('V3 local contact resolution for buyer-agent lookup codes', 'no person lookup codes returned');
    } else {
      show(
        'V3 local contact resolution for buyer-agent lookup codes',
        await sql`
          select c.id, c.full_name, c.email, c.lookup_code, c.softpro_lookup_code, c.source_id
          from contacts c
          where c.lookup_code = any(${codes}::text[])
             or c.softpro_lookup_code = any(${codes}::text[])
             or c.source_id = any(${codes}::text[])
          order by c.id
        `,
      );
    }
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
