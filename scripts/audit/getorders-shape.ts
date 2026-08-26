import { getOrders } from '../../src/lib/integrations/softpro/client';

(async () => {
const day = new Date().toISOString().slice(0,10);
const prev = new Date(Date.now()-86400000).toISOString().slice(0,10);
const r = await getOrders({ dateFrom: prev, dateTo: day });
const list = (r.success && Array.isArray(r.data) ? r.data : []) as Record<string,unknown>[];
console.log(`success=${r.success} records=${list.length}`);
console.log('KEYS on record[0]:', Object.keys(list[0] ?? {}).join(', '));
console.log('\nfirst 3 records verbatim:');
for (const x of list.slice(0,3)) console.log(JSON.stringify(x));
console.log('\nlooking for our two known-created order numbers:');
for (const on of ['20021376-OCT','20021378-GLT']) {
  const hit = list.find(o => JSON.stringify(o).includes(on));
  console.log(`  ${on}: ${hit ? 'FOUND -> ' + JSON.stringify(hit) : 'NOT in this list'}`);
}
console.log('\nany record mentioning the Visalia address or APN:');
for (const needle of ['1434 N ELM','ELM ST','090-142-021','VISALIA']) {
  const hits = list.filter(o => JSON.stringify(o).toUpperCase().includes(needle.toUpperCase()));
  console.log(`  "${needle}": ${hits.length} hit(s)` + (hits.length ? ' -> ' + hits.map(h=>JSON.stringify(h)).join(' | ') : ''));
}


  process.exit(0);
})();
