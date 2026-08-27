/**
 * Read-only exploration for HUB_ORDER_ORIGIN_AND_BUYER_COUNT.
 * Establishes which columns actually exist and how origin is marked.
 */
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  show('now()', await sql`select now() as now_utc, current_database() as db`);

  show(
    'orders columns (information_schema)',
    await sql`
      select column_name, data_type, udt_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'orders'
      order by ordinal_position
    `,
  );

  show(
    'order_parties columns',
    await sql`
      select column_name, data_type, udt_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'order_parties'
      order by ordinal_position
    `,
  );

  show(
    'order_source enum values',
    await sql`
      select e.enumlabel
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'order_source'
      order by e.enumsortorder
    `,
  );

  show(
    'orders by source x is_imported (all time)',
    await sql`
      select source, is_imported, count(*)::int as orders,
             min(opened_at) as first_opened, max(opened_at) as last_opened
      from orders
      group by source, is_imported
      order by orders desc
    `,
  );

  show(
    'orders by source, created_by null-ness',
    await sql`
      select source,
             count(*)::int as orders,
             count(created_by)::int as with_created_by
      from orders
      group by source
      order by orders desc
    `,
  );

  show(
    'external refs by system/ref_type',
    await sql`
      select system, ref_type, count(*)::int as rows
      from order_external_refs
      group by system, ref_type
      order by rows desc
    `,
  );

  show(
    'orders total + window sizes (opened_at vs created_at)',
    await sql`
      select
        count(*)::int as all_orders,
        count(*) filter (where opened_at  >= now() - interval '14 days')::int as opened_14d,
        count(*) filter (where created_at >= now() - interval '14 days')::int as created_14d
      from orders
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
