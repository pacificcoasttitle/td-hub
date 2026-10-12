/**
 * READ-ONLY. Extracts every CreateOrder-ish request body from the vendor's own
 * Postman collection (postman_collection.json, "PCTSoftProDotNet") so we can see
 * what shape the API owner's own examples use. No network calls.
 *
 * Usage: npx tsx scripts/audit/postman-createorder.ts > _scratch_untracked/te-postman.txt
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type AnyRec = Record<string, unknown>;

const file = resolve(process.cwd(), 'postman_collection.json');
const root = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as AnyRec;

interface Found {
  path: string[];
  method: string;
  url: string;
  raw: string;
}

const found: Found[] = [];

function urlToString(u: unknown): string {
  if (typeof u === 'string') return u;
  if (u && typeof u === 'object') {
    const o = u as AnyRec;
    if (typeof o.raw === 'string') return o.raw;
  }
  return '';
}

function walk(node: unknown, path: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, path);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const o = node as AnyRec;
  const name = typeof o.name === 'string' ? o.name : '';
  const nextPath = name ? [...path, name] : path;

  const req = o.request as AnyRec | undefined;
  if (req && typeof req === 'object') {
    const url = urlToString(req.url);
    const body = req.body as AnyRec | undefined;
    const raw = body && typeof body.raw === 'string' ? body.raw : '';
    const hay = `${name} ${url}`.toLowerCase();
    if (hay.includes('createorder') || hay.includes('create_order') || hay.includes('create order')) {
      found.push({
        path: nextPath,
        method: typeof req.method === 'string' ? req.method : '?',
        url,
        raw,
      });
    }
  }

  if (Array.isArray(o.item)) walk(o.item, nextPath);
  if (Array.isArray(o.response)) {
    // Saved example responses hang off the request; their originalRequest also
    // carries a body, which is often the most complete "known good" example.
    for (const r of o.response as unknown[]) {
      if (!r || typeof r !== 'object') continue;
      const rr = r as AnyRec;
      const orig = rr.originalRequest as AnyRec | undefined;
      if (!orig) continue;
      const url = urlToString(orig.url);
      const body = orig.body as AnyRec | undefined;
      const raw = body && typeof body.raw === 'string' ? body.raw : '';
      const exName = typeof rr.name === 'string' ? rr.name : 'example';
      const hay = `${name} ${exName} ${url}`.toLowerCase();
      if (hay.includes('createorder')) {
        found.push({
          path: [...nextPath, `example:${exName}`],
          method: typeof orig.method === 'string' ? orig.method : '?',
          url,
          raw,
        });
      }
    }
  }
}

walk(root.collection ?? root, []);

console.log('='.repeat(100));
console.log(`CreateOrder requests in postman_collection.json: ${found.length}`);
console.log('='.repeat(100));

for (const f of found) {
  console.log('');
  console.log('-'.repeat(100));
  console.log(`PATH   : ${f.path.join(' > ')}`);
  console.log(`METHOD : ${f.method}`);
  console.log(`URL    : ${f.url}`);
  console.log('-'.repeat(100));
  if (!f.raw) {
    console.log('(no raw body)');
    continue;
  }
  // Report the top-level keys first — that is the question we care about.
  try {
    const parsed = JSON.parse(f.raw) as AnyRec;
    console.log(`TOP-LEVEL KEYS: ${Object.keys(parsed).join(', ')}`);
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (v === null || typeof v !== 'object') {
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    }
  } catch {
    console.log('(body is not valid JSON — printing raw)');
  }
  console.log('RAW BODY:');
  console.log(f.raw);
}
