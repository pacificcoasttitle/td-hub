import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
// Entity-owned AND complete address AND an APN — so the one call cannot miss
// for a boring reason. These rows were populated BY SiteX, so it matched once.
console.table(await sql.unsafe(`
  select p.order_id, p.primary_owner, p.address, p.city, p.state, p.zip, p.apn, p.county,
         o.file_number
  from order_properties p join orders o on o.id = p.order_id
  where p.primary_owner ~ '^[0-9]'
    and nullif(trim(p.address),'') is not null
    and nullif(trim(p.city),'') is not null
    and nullif(trim(p.zip),'') is not null
    and nullif(trim(p.apn),'') is not null
  order by p.updated_at desc limit 6`));
console.log('\n-- also: clear LLC/INC owners with full address+apn --');
console.table(await sql.unsafe(`
  select p.order_id, p.primary_owner, p.address, p.city, p.state, p.zip, p.apn
  from order_properties p
  where (p.primary_owner ilike '%LLC%' or p.primary_owner ilike '%INC%')
    and nullif(trim(p.address),'') is not null and nullif(trim(p.city),'') is not null
    and nullif(trim(p.zip),'') is not null and nullif(trim(p.apn),'') is not null
  order by p.updated_at desc limit 6`));
await sql.end();
