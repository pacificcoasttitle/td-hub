/**
 * Enrich existing orders by calling SoftPro GetOrderDetails per order.
 * Fetches data from SoftPro API, generates COALESCE SQL, writes to stdout.
 *
 * Usage: node scripts/enrich-orders.mjs > scripts/enrich-output.sql
 * Then execute the SQL against the database.
 */

const SOFTPRO_BASE = 'http://100.29.181.61:3000/api/ordercreation/GetOrderDetails';
const DELAY_MS = 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mapTransactionType(raw) {
  if (!raw || !raw.trim()) return null;
  const n = raw.trim().toLowerCase();
  if (n === 'purchase') return 'Purchase';
  if (n === 'refinance' || n === 'refi') return 'Refinance';
  if (n === 'equity' || n === 'home equity') return 'Equity';
  return 'Other';
}

function parseSalesPrice(raw) {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num.toFixed(2);
}

function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// Title officers and sales reps from the database
const TITLE_OFFICERS = [
  { id: 5, name: 'Clive Virata' },
  { id: 6, name: 'Eddie LasMarias' },
  { id: 7, name: 'Jim Jean' },
  { id: 8, name: 'Kevin Cameron' },
  { id: 9, name: 'Rachel Barcena' },
  { id: 10, name: 'Susan Dana' },
  { id: 1, name: 'Jean, Jim' },
  { id: 2, name: 'Smith, Rachel' },
];

const SALES_REPS = [
  { id: 22116, name: 'Aashima Narang' }, { id: 22117, name: 'Angeline Wu' },
  { id: 22118, name: 'Anthony Zamora' }, { id: 22119, name: 'Christy Coffey' },
  { id: 22120, name: 'Chuck Cota' }, { id: 22121, name: 'Corey Velasquez' },
  { id: 22122, name: 'Dan Culnane' }, { id: 22123, name: 'David Gomez' },
  { id: 22124, name: 'Felicia Pantoja' }, { id: 22125, name: 'Gerardo Hernandez' },
  { id: 22126, name: 'Glendale  House Account' }, { id: 22127, name: 'Israel Lopez' },
  { id: 22128, name: 'Jane Phan' }, { id: 22129, name: 'Janelly Marquez' },
  { id: 22130, name: 'Jennifer Simms' }, { id: 22131, name: 'Jesse Lopez' },
  { id: 22132, name: 'Jorge Mesa' }, { id: 22133, name: 'Justin Nouri' },
  { id: 22134, name: 'Kevin Green' }, { id: 22135, name: 'Laurie Briggs' },
  { id: 22136, name: 'Linda Ruiz' }, { id: 22137, name: 'Lopez Team' },
  { id: 22138, name: 'Louis Morreale' }, { id: 22139, name: 'Maria Basilio' },
  { id: 22140, name: 'Mark Neveu' }, { id: 22141, name: 'Michael Nouri' },
  { id: 22142, name: 'Neil Torquato' }, { id: 22143, name: 'Nelson Torres' },
  { id: 22144, name: 'Nicholas Watt' }, { id: 22145, name: 'Nini Kerns' },
  { id: 22146, name: 'Orange County House Account' }, { id: 22147, name: 'Patrick Kane' },
  { id: 22148, name: 'Richard Bohn' }, { id: 22149, name: 'Ronnie Castillo' },
  { id: 22150, name: 'Rouanne Garcia' }, { id: 22151, name: 'Saeed Ghaffari' },
  { id: 22152, name: 'Sandra Millar' }, { id: 22153, name: 'Simon Wu' },
  { id: 22154, name: 'SoftPro Support' }, { id: 22155, name: 'Sonia Flores' },
  { id: 22156, name: 'Team Castaneda' }, { id: 22157, name: 'Team Meza' },
  { id: 22158, name: 'Title Gals' }, { id: 22159, name: 'Title Team' },
  { id: 22160, name: 'Tony Baumgartner' }, { id: 22161, name: 'Ventura House Account' },
  { id: 22162, name: 'Veronica Sanchez' }, { id: 22163, name: "Vito D'Alessandro" },
  { id: 22164, name: 'Zaccaria Ackad' },
  { id: 3, name: 'Hernandez, Jerry' }, { id: 4, name: 'Johnson, Mike' },
  { id: 8, name: 'Kevin Cameron' },
];

function resolveContact(name, contacts) {
  if (!name || !name.trim()) return null;
  const target = name.trim().toLowerCase();
  for (const c of contacts) {
    if (c.name.trim().toLowerCase() === target) return c.id;
  }
  for (const c of contacts) {
    if (c.name.trim().toLowerCase().includes(target) || target.includes(c.name.trim().toLowerCase())) return c.id;
  }
  return null;
}

const FILE_NUMBERS = [
  '20015183-GLT','20015184-GLT','20015185-GLT','20015186-GLT','20015187-OCT',
  '99100775','99100776','20015188-OCT','20015189-GLT','20015190-OCT',
  '20015191-OCT','20015192-GLT','20015193-GLT','20015194-OCT','20015195-GLT',
  '20015196-OCT','20015197-OCT','20015198-GLT','20015199-OCT','20015200-OCT',
  '20015201-OCT','20015202-OCT','20015203-GLT','20015204-OCT','20015205-GLT',
  '20015206-GLT','20015207-GLT','20015208-OCT','20015209-GLT','20015210-ONT',
  '20015211-OCT','20015212-GLT','20015213-OCT','20015214-OCT','20015215-GLT',
  '20015216-OCT','20015217-GLT','20015218-OCT','20015219-OCT','20015220-GLT',
  '20015221-OCT','20015222-OCT','20015223-GLT','20015757-GLT','20015761-GLT',
];

const ORDER_IDS = [
  7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,
  32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,
];

async function main() {
  const results = [];
  let enriched = 0, skipped = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < FILE_NUMBERS.length; i++) {
    const fileNumber = FILE_NUMBERS[i];
    const orderId = ORDER_IDS[i];
    process.stderr.write(`[${i + 1}/${FILE_NUMBERS.length}] Fetching ${fileNumber}...`);

    try {
      const url = `${SOFTPRO_BASE}?DateFrom=&DateTo=&OrderNumber=${encodeURIComponent(fileNumber)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const json = await response.json();

      if (json.Status !== 200 || !json.data || json.data.length === 0) {
        process.stderr.write(' no data\n');
        skipped++;
        if (i < FILE_NUMBERS.length - 1) await sleep(DELAY_MS);
        continue;
      }

      const d = json.data[0];
      results.push({ orderId, fileNumber, detail: d });
      process.stderr.write(` OK (${d.TransactionType || '-'}, ${d.SalesPrice || '-'}, ${d.TitleOfficer || '-'}, ${d.MarketingRep || '-'})\n`);
      enriched++;
    } catch (err) {
      process.stderr.write(` FAILED: ${err.message}\n`);
      failures.push({ fileNumber, error: err.message });
      failed++;
    }

    if (i < FILE_NUMBERS.length - 1) await sleep(DELAY_MS);
  }

  // Generate SQL
  console.log('-- Enrichment SQL generated by enrich-orders.mjs');
  console.log(`-- ${new Date().toISOString()}`);
  console.log(`-- Orders fetched: ${results.length}, skipped: ${skipped}, failed: ${failed}`);
  console.log('BEGIN;\n');

  for (const { orderId, fileNumber, detail: d } of results) {
    const txType = mapTransactionType(d.TransactionType);
    const salesPrice = parseSalesPrice(d.SalesPrice);
    const titleOfficerId = resolveContact(d.TitleOfficer, TITLE_OFFICERS);
    const salesRepId = resolveContact(d.MarketingRep, SALES_REPS);

    const setClauses = [];

    if (txType) setClauses.push(`transaction_type = COALESCE(transaction_type, ${esc(txType)})`);
    if (d.ProductType) setClauses.push(`product_type = COALESCE(product_type, ${esc(d.ProductType)})`);
    if (salesPrice) setClauses.push(`sales_price = COALESCE(sales_price, ${salesPrice})`);
    if (d.OrderType) setClauses.push(`order_type = COALESCE(order_type, ${esc(d.OrderType)})`);
    if (d.MarketingSource) setClauses.push(`marketing_source = COALESCE(marketing_source, ${esc(d.MarketingSource)})`);
    if (titleOfficerId) setClauses.push(`title_officer_id = COALESCE(title_officer_id, ${titleOfficerId})`);
    if (salesRepId) setClauses.push(`sales_rep_id = COALESCE(sales_rep_id, ${salesRepId})`);

    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length > 1) {
      console.log(`-- ${fileNumber} (order_id=${orderId})`);
      console.log(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = ${orderId};`);
    }

    // Property updates
    const propClauses = [];
    if (d.Address && d.Address.trim()) propClauses.push(`address = COALESCE(address, ${esc(d.Address.trim())})`);
    if (d.City && d.City.trim()) propClauses.push(`city = COALESCE(city, ${esc(d.City.trim())})`);
    if (d.State && d.State.trim()) propClauses.push(`state = COALESCE(state, ${esc(d.State.trim())})`);
    if (d.Zip && d.Zip.trim()) propClauses.push(`zip = COALESCE(zip, ${esc(d.Zip.trim())})`);
    if (d.Country && d.Country.trim()) propClauses.push(`county = COALESCE(county, ${esc(d.Country.trim())})`);

    if (propClauses.length > 0) {
      propClauses.push(`updated_at = NOW()`);
      console.log(`UPDATE order_properties SET ${propClauses.join(', ')} WHERE order_id = ${orderId};`);
      console.log(`INSERT INTO order_properties (order_id, address, city, state, zip, county)`);
      console.log(`  SELECT ${orderId}, ${esc(d.Address?.trim() || null)}, ${esc(d.City?.trim() || null)}, ${esc(d.State?.trim() || null)}, ${esc(d.Zip?.trim() || null)}, ${esc(d.Country?.trim() || null)}`);
      console.log(`  WHERE NOT EXISTS (SELECT 1 FROM order_properties WHERE order_id = ${orderId});`);
    }
    console.log('');
  }

  console.log('COMMIT;');

  // Summary to stderr
  process.stderr.write(`\n════════════════════════════════════════════\n`);
  process.stderr.write(`       ENRICHMENT REPORT\n`);
  process.stderr.write(`════════════════════════════════════════════\n`);
  process.stderr.write(`Total orders:  ${FILE_NUMBERS.length}\n`);
  process.stderr.write(`Data fetched:  ${results.length}\n`);
  process.stderr.write(`Skipped:       ${skipped} (no SoftPro data)\n`);
  process.stderr.write(`Failed:        ${failed}\n`);
  if (failures.length > 0) {
    process.stderr.write(`\nFailures:\n`);
    for (const f of failures) process.stderr.write(`  ${f.fileNumber}: ${f.error}\n`);
  }

  // Log unresolved officers/reps
  const unresolved = [];
  for (const { fileNumber, detail: d } of results) {
    if (d.TitleOfficer && !resolveContact(d.TitleOfficer, TITLE_OFFICERS)) {
      unresolved.push(`  TitleOfficer "${d.TitleOfficer}" (${fileNumber}) — no match`);
    }
    if (d.MarketingRep && !resolveContact(d.MarketingRep, SALES_REPS)) {
      unresolved.push(`  MarketingRep "${d.MarketingRep}" (${fileNumber}) — no match`);
    }
  }
  if (unresolved.length > 0) {
    process.stderr.write(`\nUnresolved contacts:\n`);
    for (const u of unresolved) process.stderr.write(u + '\n');
  }

  process.stderr.write(`════════════════════════════════════════════\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
