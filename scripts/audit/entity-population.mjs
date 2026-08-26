import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.table(await sql.unsafe(`
  select count(*)::int as owner_strings,
    count(*) filter (where primary_owner ilike '% LLC%' or primary_owner ilike '%LLC')::int as llc,
    count(*) filter (where primary_owner ilike '%TRUST%')::int as trust,
    count(*) filter (where primary_owner ilike '% INC%' or primary_owner ilike '%INC')::int as inc,
    count(*) filter (where primary_owner ilike '%CORP%')::int as corp,
    count(*) filter (where primary_owner ~ '^[0-9]')::int as starts_with_number
  from order_properties where nullif(trim(primary_owner),'') is not null`));
console.log('\n-- sample owners starting with a digit (the "6607 DE LONGPRE LLC" shape) --');
console.table(await sql.unsafe(`
  select primary_owner from order_properties where primary_owner ~ '^[0-9]' limit 8`));
console.log('\n-- is borrowers_vesting ever populated? --');
console.table(await sql.unsafe(`
  select count(*)::int as rows, count(*) filter (where nullif(trim(borrowers_vesting),'') is not null)::int as has_vesting
  from order_properties`));
await sql.end();
