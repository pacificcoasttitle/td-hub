/**
 * Read-only follow-up for HUB_ORDER_ORIGIN_AND_BUYER_COUNT: reconstruct the
 * 14-day purchase / no-buyer counts as they stood at past instants, and probe
 * the placeholder-name states that a row-existence count cannot see.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  // Point-in-time: an order counts as "no buyer" at instant T only if no buyer
  // row had been created by T. Rebuilds what a query run at T would have seen.
  show(
    'Q15 as-of reconstruction, 6-hourly anchors, 14d purchase window',
    await sql`
      select to_char(anchor, 'YYYY-MM-DD HH24:MI') as anchor_utc,
             count(o.id)::int as purchases_14d,
             count(o.id) filter (
               where not exists (
                 select 1 from order_parties p
                 where p.order_id = o.id and p.role = 'buyer'
                   and p.created_at <= anchor
               )
             )::int as no_buyer_row_as_of
      from generate_series(now() - interval '14 days', now(), interval '6 hours') as anchor
      left join orders o
        on o.transaction_type = 'Purchase'
       and o.opened_at <  anchor
       and o.opened_at >= anchor - interval '14 days'
      group by anchor
      order by anchor
    `,
  );

  show(
    'Q16 anchors that reproduce exactly 235 purchases (hourly, last 21d)',
    await sql`
      select to_char(anchor, 'YYYY-MM-DD HH24:MI') as anchor_utc,
             purchases_14d, no_buyer_row_as_of
      from (
        select anchor,
               count(o.id)::int as purchases_14d,
               count(o.id) filter (
                 where not exists (
                   select 1 from order_parties p
                   where p.order_id = o.id and p.role = 'buyer'
                     and p.created_at <= anchor
                 )
               )::int as no_buyer_row_as_of
        from generate_series(now() - interval '21 days', now(), interval '1 hour') as anchor
        left join orders o
          on o.transaction_type = 'Purchase'
         and o.opened_at <  anchor
         and o.opened_at >= anchor - interval '14 days'
        group by anchor
      ) q
      where purchases_14d = 235
      order by anchor
    `,
  );

  show(
    'Q17 anchors that reproduce exactly 172 no-buyer (hourly, last 21d)',
    await sql`
      select to_char(anchor, 'YYYY-MM-DD HH24:MI') as anchor_utc,
             purchases_14d, no_buyer_row_as_of
      from (
        select anchor,
               count(o.id)::int as purchases_14d,
               count(o.id) filter (
                 where not exists (
                   select 1 from order_parties p
                   where p.order_id = o.id and p.role = 'buyer'
                     and p.created_at <= anchor
                 )
               )::int as no_buyer_row_as_of
        from generate_series(now() - interval '21 days', now(), interval '1 hour') as anchor
        left join orders o
          on o.transaction_type = 'Purchase'
         and o.opened_at <  anchor
         and o.opened_at >= anchor - interval '14 days'
        group by anchor
      ) q
      where no_buyer_row_as_of = 172
      order by anchor
    `,
  );

  // Placeholder names: 'TBD' is what create-order defaults an unentered party to.
  show(
    'Q18 placeholder party names across the whole table',
    await sql`
      select p.role,
             count(*) filter (where upper(btrim(p.external_name)) in ('TBD','TBD TBD'))::int as tbd_rows,
             count(distinct p.order_id) filter (
               where upper(btrim(p.external_name)) in ('TBD','TBD TBD'))::int as tbd_orders,
             count(*)::int as rows_total
      from order_parties p
      group by p.role
      order by rows_total desc
    `,
  );

  show(
    'Q19 TBD-named parties by order origin',
    await sql`
      select o.source, p.role, count(*)::int as tbd_rows
      from order_parties p
      join orders o on o.id = p.order_id
      where upper(btrim(p.external_name)) in ('TBD','TBD TBD')
      group by o.source, p.role
      order by tbd_rows desc
    `,
  );

  // Is the missing buyer an ingestion lag or a settled absence?
  show(
    'Q20 synced purchases without a buyer row, by operational status and age band',
    await sql`
      select o.operational_status,
             case
               when o.opened_at >= now() - interval '7 days'  then '0-7d'
               when o.opened_at >= now() - interval '14 days' then '7-14d'
               when o.opened_at >= now() - interval '30 days' then '14-30d'
               when o.opened_at >= now() - interval '90 days' then '30-90d'
               else '90d+'
             end as age_band,
             count(*)::int as purchases,
             count(*) filter (
               where not exists (select 1 from order_parties p
                                 where p.order_id = o.id and p.role = 'buyer')
             )::int as no_buyer_row
      from orders o
      where o.source = 'softpro_sync' and o.transaction_type = 'Purchase'
      group by 1, 2
      order by 2, 1
    `,
  );

  show(
    'Q21 the three states for the hub-created population (all 8), buyer side',
    await sql`
      select o.id, o.transaction_type,
             coalesce(
               (select case
                         when p.external_name is null then 'absent'
                         when btrim(p.external_name) = '' then 'present-but-empty'
                         when upper(btrim(p.external_name)) in ('TBD','TBD TBD') then 'placeholder-TBD'
                         else 'present-with-value'
                       end
                from order_parties p
                where p.order_id = o.id and p.role = 'buyer' and p.is_primary
                order by p.id limit 1),
               'no-buyer-row') as primary_buyer_state,
             coalesce(
               (select case
                         when p.external_name is null then 'absent'
                         when btrim(p.external_name) = '' then 'present-but-empty'
                         when upper(btrim(p.external_name)) in ('TBD','TBD TBD') then 'placeholder-TBD'
                         else 'present-with-value'
                       end
                from order_parties p
                where p.order_id = o.id and p.role = 'seller' and p.is_primary
                order by p.id limit 1),
               'no-seller-row') as primary_seller_state
      from orders o
      where o.source = 'manual_entry'
      order by o.id
    `,
  );

  // Did any hub order ever exist that was later reclassified or deleted?
  show(
    'Q22 orders whose first status-history row was written by the manual path',
    await sql`
      select osh.source, count(distinct osh.order_id)::int as orders
      from order_status_history osh
      group by osh.source
      order by orders desc
    `,
  );

  show(
    'Q23 transaction_type distribution by origin (all time)',
    await sql`
      select o.source,
             coalesce(o.transaction_type::text, '(null)') as transaction_type,
             count(*)::int as orders
      from orders o
      group by 1, 2
      order by 1, orders desc
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
