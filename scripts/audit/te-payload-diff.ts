/**
 * READ-ONLY. Title & Escrow investigation, part 2: field-by-field diff of every
 * createOrder payload this system has ever sent.
 *
 * Three states per field, as logged: present (a value), empty ('' / null / 0),
 * absent (key not in payload at all). Groups the two failure sets separately —
 * March (Title only, branch PCT) and August (Title & Escrow, branch PRV) — so a
 * shared cause has to be demonstrated rather than assumed.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const SETS: Record<string, number[]> = {
  'AUG fail  (T&E / PRV)': [1077788, 1077673],
  'AUG ok    (Title only)': [1077398, 1077352],
  'MAR fail  (Title only / PCT)': [152, 149, 146],
  'MAR ok    (Title only / GLT)': [188, 164],
};

type State = 'present' | 'empty' | 'absent';

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    // propertyDetails is a single-element array in every payload we send.
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

function state(v: unknown, has: boolean): State {
  if (!has) return 'absent';
  if (v === null || v === '' || v === undefined) return 'empty';
  if (typeof v === 'number' && v === 0) return 'empty';
  return 'present';
}

function cell(v: unknown, has: boolean): string {
  const s = state(v, has);
  if (s === 'absent') return '—absent—';
  if (s === 'empty') return `(empty ${JSON.stringify(v)})`;
  return JSON.stringify(v);
}

(async () => {
  const ids = Object.values(SETS).flat();
  const rows = await sql.unsafe(
    `select id, created_at, success, request_meta->'payload' as payload
       from vendor_api_logs where id in (${ids.join(',')})`,
  );
  const byId = new Map<number, Record<string, unknown>>();
  for (const r of rows as unknown as Array<{ id: number; payload: unknown }>) {
    byId.set(Number(r.id), flatten(r.payload));
  }

  const allKeys = new Set<string>();
  for (const f of byId.values()) Object.keys(f).forEach((k) => allKeys.add(k));

  // Per-attempt table, grouped by set.
  console.log('='.repeat(120));
  console.log('EVERY createOrder PAYLOAD EVER SENT — field by field');
  console.log('='.repeat(120));

  const cols: Array<{ label: string; id: number }> = [];
  for (const [label, list] of Object.entries(SETS)) for (const id of list) cols.push({ label, id });

  const header = ['field'.padEnd(42), ...cols.map((c) => String(c.id).padEnd(26))].join(' ');
  console.log('\n' + header);
  console.log('  sets: ' + Object.entries(SETS).map(([l, v]) => `${l}=${v.join('/')}`).join('   '));
  console.log('-'.repeat(120));

  const differing: string[] = [];
  for (const k of Array.from(allKeys).sort()) {
    const cells = cols.map((c) => {
      const f = byId.get(c.id);
      return cell(f?.[k], !!f && k in f);
    });
    const uniq = new Set(cells);
    if (uniq.size > 1) differing.push(k);
    console.log([k.padEnd(42), ...cells.map((s) => s.slice(0, 25).padEnd(26))].join(' '));
  }

  // The question asked: what differs between a rejected payload and an accepted one?
  console.log('\n' + '='.repeat(120));
  console.log('AUGUST: rejected (1077788, T&E/PRV) vs accepted same day (1077398, Title only/GLT)');
  console.log('='.repeat(120));
  const af = byId.get(1077788)!;
  const ao = byId.get(1077398)!;
  for (const k of Array.from(allKeys).sort()) {
    const fs = state(af[k], k in af);
    const os = state(ao[k], k in ao);
    const same = cell(af[k], k in af) === cell(ao[k], k in ao);
    if (same) continue;
    const flag = fs !== os ? `  <<< STATE DIFF ${os} -> ${fs}` : '';
    console.log(`  ${k.padEnd(42)} accepted=${cell(ao[k], k in ao).slice(0, 28).padEnd(30)} rejected=${cell(af[k], k in af).slice(0, 28).padEnd(30)}${flag}`);
  }

  console.log('\n' + '='.repeat(120));
  console.log('MARCH: rejected (152, Title only/PCT) vs accepted next day (188, Title only/GLT)');
  console.log('='.repeat(120));
  const mf = byId.get(152)!;
  const mo = byId.get(188)!;
  for (const k of Array.from(allKeys).sort()) {
    if (cell(mf[k], k in mf) === cell(mo[k], k in mo)) continue;
    const fs = state(mf[k], k in mf);
    const os = state(mo[k], k in mo);
    const flag = fs !== os ? `  <<< STATE DIFF ${os} -> ${fs}` : '';
    console.log(`  ${k.padEnd(42)} accepted=${cell(mo[k], k in mo).slice(0, 28).padEnd(30)} rejected=${cell(mf[k], k in mf).slice(0, 28).padEnd(30)}${flag}`);
  }

  // Structural: which top-level sections each attempt carried at all.
  console.log('\n' + '='.repeat(120));
  console.log('TOP-LEVEL SECTIONS PRESENT PER ATTEMPT');
  console.log('='.repeat(120));
  for (const c of cols) {
    const f = byId.get(c.id);
    const sections = new Set(Object.keys(f ?? {}).map((k) => k.split(/[.[]/)[0]));
    console.log(`  ${String(c.id).padEnd(9)} ${c.label.padEnd(30)} ${Array.from(sections).sort().join(', ')}`);
  }

  console.log(`\nfields that differ anywhere: ${differing.length} of ${allKeys.size}`);
  await sql.end();
  process.exit(0);
})();
