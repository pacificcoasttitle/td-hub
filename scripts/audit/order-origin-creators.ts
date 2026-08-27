/**
 * Read-only: can the database tell the hub open-order form apart from the
 * client-facing wizard? Both funnel through createLocalRecords.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  show(
    'Q24 distinct creators of the manual_entry population',
    await sql`
      select o.created_by,
             pr.display_name,
             pr.role,
             count(*)::int as orders
      from orders o
      left join profiles pr on pr.id = o.created_by
      where o.source = 'manual_entry'
      group by o.created_by, pr.display_name, pr.role
      order by orders desc
    `,
  );

  show(
    'Q25 is the web_form enum value ever used?',
    await sql`select count(*)::int as web_form_orders from orders where source = 'web_form'`,
  );

  show(
    'Q27 the four TBD-named buyer rows: which orders hold them',
    await sql`
      select o.id, o.file_number, o.source, o.transaction_type, o.opened_at,
             p.external_name, p.is_primary, p.created_at as party_created_at
      from order_parties p
      join orders o on o.id = p.order_id
      where p.role = 'buyer'
        and upper(btrim(p.external_name)) in ('TBD','TBD TBD')
      order by o.opened_at
    `,
  );

  show(
    'Q26 client-wizard submission tables, if any rows link to orders',
    await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and (table_name ilike '%wizard%' or table_name ilike '%submission%'
             or table_name ilike '%intake%' or table_name ilike '%request%')
      order by table_name
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
