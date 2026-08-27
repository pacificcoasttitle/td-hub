/**
 * Read-only. Two questions, both raised while gating `order.closed`'s
 * buyer-agent role and reviewing the 21 party rows the latched re-enrichment
 * would write.
 *
 * 1. Does `order.closed` actually carry `buyer_agent` in its
 *    `notification_types.recipient_roles`? The gate is worth having either way
 *    — the column is editable from the admin UI — but the answer decides
 *    whether it is live today or a guard against a future edit.
 *
 * 2. Can the 21 planned `external_name` values carry a flipped name? The flip
 *    lives behind `parseSiteXOwners` and lands in
 *    `order_properties.primary_owner`, a different table from `order_parties`.
 *    A hub-created order could in principle have written a flipped name INTO
 *    SoftPro at create time, which the read-back would then faithfully return.
 *    So check `orders.source` for the four orders, and print the SiteX-derived
 *    owner strings beside them for comparison.
 *
 * Also re-confirms both 0035 indexes are present, since the 0036 rename is
 * predicated on the SQL already having been applied by hand.
 *
 *   npx tsx --env-file=.env.local scripts/audit/order-closed-gate-and-name-flip.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

/** The four orders the dry run says would gain party rows. */
const DRY_RUN_ORDER_IDS = [5986, 6505, 6625, 7086];

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  show(
    'A1 notification_types — which slugs request buyer_agent',
    await sql`
      select slug, is_enabled, channels, recipient_roles,
             ('buyer_agent' = any(recipient_roles)) as requests_buyer_agent
      from notification_types
      order by slug
    `,
  );

  show(
    'A2 buyer_agent rows in order_parties today (expected 0 before any write)',
    await sql`
      select count(*)::int as buyer_agent_rows,
             count(distinct order_id)::int as orders
      from order_parties
      where role = 'buyer_agent'
    `,
  );

  show(
    'A3 both 0035 indexes — already applied by hand, so the rename is collision-only',
    await sql`
      select indexrelid::regclass::text as index_name,
             indrelid::regclass::text as table_name,
             indisvalid, indisready
      from pg_index
      where indexrelid::regclass::text in (
        'order_parties_order_role_primary_uniq',
        'vendor_logs_party_wizard_ip_idx'
      )
    `,
  );

  show(
    'B1 the four dry-run orders — origin, so we know who wrote the names SoftPro holds',
    await sql`
      select o.id, o.file_number, o.source, o.created_by, o.transaction_type,
             o.opened_at, o.created_at, o.contacts_empty_confirmed,
             o.last_contacts_fetch_at
      from orders o
      where o.id = any(${DRY_RUN_ORDER_IDS})
      order by o.id
    `,
  );

  show(
    'B2 SiteX-derived owner strings on those orders — the values the flip CAN reach',
    await sql`
      select o.id, o.file_number,
             p.primary_owner, p.secondary_owner
      from orders o
      left join order_properties p on p.order_id = o.id
      where o.id = any(${DRY_RUN_ORDER_IDS})
      order by o.id
    `,
  );

  show(
    'B3 existing party rows on those orders (expected 0 — that is the population filter)',
    await sql`
      select order_id, count(*)::int as party_rows
      from order_parties
      where order_id = any(${DRY_RUN_ORDER_IDS})
      group by order_id
      order by order_id
    `,
  );

  show(
    'B4 how many hub-created orders exist at all, by source',
    await sql`
      select source, count(*)::int as orders
      from orders
      group by source
      order by orders desc
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
