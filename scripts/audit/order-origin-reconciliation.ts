/**
 * Read-only reconciliation of two contradictory measurements:
 *   A) "172 of 235 purchase orders in the last 14 days have no buyer" (hub-created)
 *   B) "only 8 hub orders have ever been created"
 *
 * Every query here is quoted verbatim in
 * docs/tickets/HUB_ORDER_ORIGIN_AND_BUYER_COUNT.md. Read-only: no writes.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  show('clock', await sql`select now() as now_utc`);

  // ── 1. Origin discriminator ────────────────────────────────────────────────
  show(
    'Q1 origin discriminator: source x is_imported x created_by',
    await sql`
      select source,
             is_imported,
             count(*)::int                    as orders,
             count(created_by)::int           as with_created_by,
             min(opened_at)                   as first_opened,
             max(opened_at)                   as last_opened
      from orders
      group by source, is_imported
      order by orders desc
    `,
  );

  show(
    'Q2 the manual_entry population, listed',
    await sql`
      select id, file_number, transaction_type, source, is_imported,
             created_by is not null as has_created_by,
             opened_at, created_at
      from orders
      where source <> 'softpro_sync'
      order by id
    `,
  );

  // ── 2. Measurement A, as most plausibly written ────────────────────────────
  show(
    'Q3 ALL purchases opened in last 14d, buyer coverage (three states)',
    await sql`
      with win as (
        select o.id
        from orders o
        where o.transaction_type = 'Purchase'
          and o.opened_at >= now() - interval '14 days'
      ),
      b as (
        select w.id,
               count(p.id) filter (where p.role = 'buyer')::int as buyer_rows,
               count(p.id) filter (
                 where p.role = 'buyer'
                   and (p.external_name is not null and btrim(p.external_name) <> '')
               )::int as named_buyer_rows
        from win w
        left join order_parties p on p.order_id = w.id
        group by w.id
      )
      select count(*)::int                                            as purchases_14d,
             count(*) filter (where buyer_rows = 0)::int              as no_buyer_row_at_all,
             count(*) filter (where buyer_rows > 0
                              and named_buyer_rows = 0)::int          as buyer_row_but_blank_name,
             count(*) filter (where named_buyer_rows > 0)::int        as has_named_buyer
      from b
    `,
  );

  show(
    'Q4 same, split by origin',
    await sql`
      with win as (
        select o.id, o.source
        from orders o
        where o.transaction_type = 'Purchase'
          and o.opened_at >= now() - interval '14 days'
      ),
      b as (
        select w.id, w.source,
               count(p.id) filter (where p.role = 'buyer')::int as buyer_rows,
               count(p.id) filter (
                 where p.role = 'buyer'
                   and (p.external_name is not null and btrim(p.external_name) <> '')
               )::int as named_buyer_rows
        from win w
        left join order_parties p on p.order_id = w.id
        group by w.id, w.source
      )
      select source,
             count(*)::int                                     as purchases,
             count(*) filter (where buyer_rows = 0)::int       as no_buyer_row,
             count(*) filter (where buyer_rows > 0
                              and named_buyer_rows = 0)::int   as blank_buyer_name,
             count(*) filter (where named_buyer_rows > 0)::int as has_named_buyer
      from b
      group by source
      order by purchases desc
    `,
  );

  show(
    'Q5 window sensitivity: purchases + no-buyer-row, by window definition',
    await sql`
      select label, purchases, no_buyer_row
      from (
        select 'opened_at >= now()-14d'  as label, 1 as ord,
               count(*)::int as purchases,
               count(*) filter (where nb)::int as no_buyer_row
        from (
          select o.id,
                 not exists (select 1 from order_parties p
                             where p.order_id = o.id and p.role = 'buyer') as nb
          from orders o
          where o.transaction_type = 'Purchase'
            and o.opened_at >= now() - interval '14 days'
        ) x
        union all
        select 'created_at >= now()-14d', 2,
               count(*)::int,
               count(*) filter (where nb)::int
        from (
          select o.id,
                 not exists (select 1 from order_parties p
                             where p.order_id = o.id and p.role = 'buyer') as nb
          from orders o
          where o.transaction_type = 'Purchase'
            and o.created_at >= now() - interval '14 days'
        ) x
        union all
        select 'opened_at >= now()-7d', 3,
               count(*)::int,
               count(*) filter (where nb)::int
        from (
          select o.id,
                 not exists (select 1 from order_parties p
                             where p.order_id = o.id and p.role = 'buyer') as nb
          from orders o
          where o.transaction_type = 'Purchase'
            and o.opened_at >= now() - interval '7 days'
        ) x
        union all
        select 'opened_at >= now()-30d', 4,
               count(*)::int,
               count(*) filter (where nb)::int
        from (
          select o.id,
                 not exists (select 1 from order_parties p
                             where p.order_id = o.id and p.role = 'buyer') as nb
          from orders o
          where o.transaction_type = 'Purchase'
            and o.opened_at >= now() - interval '30 days'
        ) x
      ) q
      order by ord
    `,
  );

  // Was 235/172 true for some earlier 14-day window? Walk the anchor back.
  show(
    'Q6 rolling 14d anchors: purchases and no-buyer-row per anchor date',
    await sql`
      select to_char(anchor, 'YYYY-MM-DD') as anchor_utc,
             count(o.id)::int as purchases_14d,
             count(o.id) filter (
               where not exists (select 1 from order_parties p
                                 where p.order_id = o.id and p.role = 'buyer')
             )::int as no_buyer_row
      from generate_series(now()::date - 21, now()::date, interval '1 day') as anchor
      left join orders o
        on o.transaction_type = 'Purchase'
       and o.opened_at <  anchor + interval '1 day'
       and o.opened_at >= anchor + interval '1 day' - interval '14 days'
      group by anchor
      order by anchor
    `,
  );

  // ── 3. Measurement B ───────────────────────────────────────────────────────
  show(
    'Q7 party-row counts for the 8 hub orders',
    await sql`
      select o.id,
             o.file_number,
             o.transaction_type,
             o.opened_at,
             count(p.id)::int as party_rows,
             count(p.id) filter (where p.role = 'buyer')::int   as buyer_rows,
             count(p.id) filter (where p.role = 'seller')::int  as seller_rows,
             count(p.id) filter (where p.role not in ('buyer','seller'))::int as other_rows
      from orders o
      left join order_parties p on p.order_id = o.id
      where o.source = 'manual_entry'
      group by o.id, o.file_number, o.transaction_type, o.opened_at
      order by o.id
    `,
  );

  show(
    'Q8 every party row on the 8 hub orders, three-state name check',
    await sql`
      select p.order_id, p.role, p.is_primary, p.source,
             case
               when p.external_name is null then 'absent'
               when btrim(p.external_name) = '' then 'present-but-empty'
               else 'present-with-value'
             end as name_state,
             p.external_name,
             p.contact_id,
             p.created_at
      from order_parties p
      join orders o on o.id = p.order_id
      where o.source = 'manual_entry'
      order by p.order_id, p.role, p.is_primary desc, p.id
    `,
  );

  // ── 4. Buyer identity on the SoftPro-synced population ─────────────────────
  show(
    'Q9 buyer coverage on ALL purchases, all time, three states, by origin',
    await sql`
      with b as (
        select o.id, o.source,
               count(p.id) filter (where p.role = 'buyer')::int as buyer_rows,
               count(p.id) filter (
                 where p.role = 'buyer'
                   and p.external_name is not null and btrim(p.external_name) <> ''
               )::int as named_buyer_rows
        from orders o
        left join order_parties p on p.order_id = o.id
        where o.transaction_type = 'Purchase'
        group by o.id, o.source
      )
      select source,
             count(*)::int as purchases,
             count(*) filter (where buyer_rows = 0)::int as no_buyer_row,
             count(*) filter (where buyer_rows > 0 and named_buyer_rows = 0)::int as blank_buyer_name,
             count(*) filter (where named_buyer_rows > 0)::int as has_named_buyer
      from b
      group by source
      order by purchases desc
    `,
  );

  show(
    'Q10 no-buyer purchases in the 14d window: how old, and enrichment state',
    await sql`
      select count(*)::int as no_buyer_purchases_14d,
             count(*) filter (where last_details_fetch_at is null)::int as never_details_fetched,
             count(*) filter (where last_contacts_fetch_at is null)::int as never_contacts_fetched,
             count(*) filter (where contacts_empty_confirmed)::int as contacts_empty_confirmed,
             round(avg(extract(epoch from (now() - opened_at)) / 3600)::numeric, 1) as avg_age_hours
      from orders o
      where o.transaction_type = 'Purchase'
        and o.opened_at >= now() - interval '14 days'
        and not exists (select 1 from order_parties p
                        where p.order_id = o.id and p.role = 'buyer')
    `,
  );

  show(
    'Q11 buyer-row arrival lag on synced purchases (age at which a buyer row appears)',
    await sql`
      with firstbuyer as (
        select o.id,
               o.opened_at,
               min(p.created_at) filter (where p.role = 'buyer') as first_buyer_at
        from orders o
        left join order_parties p on p.order_id = o.id
        where o.source = 'softpro_sync'
          and o.transaction_type = 'Purchase'
          and o.opened_at >= now() - interval '90 days'
        group by o.id, o.opened_at
      )
      select count(*)::int as purchases_90d,
             count(first_buyer_at)::int as ever_got_a_buyer_row,
             round(avg(extract(epoch from (first_buyer_at - opened_at)) / 3600)
                   filter (where first_buyer_at is not null)::numeric, 1) as avg_hours_to_buyer_row,
             count(*) filter (where first_buyer_at is null
                              and opened_at < now() - interval '14 days')::int
               as still_no_buyer_after_14d
      from firstbuyer
    `,
  );

  show(
    'Q12 aged cohort: purchases opened 15-90 days ago, buyer coverage by origin',
    await sql`
      with b as (
        select o.id, o.source,
               count(p.id) filter (where p.role = 'buyer')::int as buyer_rows
        from orders o
        left join order_parties p on p.order_id = o.id
        where o.transaction_type = 'Purchase'
          and o.opened_at <  now() - interval '14 days'
          and o.opened_at >= now() - interval '90 days'
        group by o.id, o.source
      )
      select source,
             count(*)::int as purchases,
             count(*) filter (where buyer_rows = 0)::int as no_buyer_row
      from b
      group by source
      order by purchases desc
    `,
  );

  // ── 5. The buyer the operator types vs the buyer SoftPro reads back ────────
  show(
    'Q13 party row provenance across the whole table',
    await sql`
      select coalesce(p.source, '(null)') as party_source,
             p.role,
             count(*)::int as rows
      from order_parties p
      where p.role in ('buyer','seller','borrower')
      group by 1, 2
      order by rows desc
    `,
  );

  show(
    'Q14 does order_properties carry an owner where parties do not? (14d purchases)',
    await sql`
      select count(*)::int as purchases_14d,
             count(*) filter (where pr.order_id is null)::int as no_property_row,
             count(*) filter (where pr.primary_owner is null)::int as primary_owner_absent,
             count(*) filter (where pr.primary_owner is not null
                              and btrim(pr.primary_owner) = '')::int as primary_owner_empty,
             count(*) filter (where pr.primary_owner is not null
                              and btrim(pr.primary_owner) <> '')::int as primary_owner_valued
      from orders o
      left join order_properties pr on pr.order_id = o.id
      where o.transaction_type = 'Purchase'
        and o.opened_at >= now() - interval '14 days'
    `,
  );
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
