/**
 * Find comments that name a test file which does not exist.
 *
 * EVIDENCE_RULES rule 9. embed-brand-assets.ts claimed "brand-assets.test.ts
 * checks the committed file matches the PNG on disk" for a week, and there was
 * no such file. A comment asserting a guard exists is worse than no comment,
 * because it stops the next person from looking.
 *
 * This only catches the checkable half — a named file that is missing. A
 * comment that says "this is tested" without naming anything is unfalsifiable
 * and is exactly what rule 9 asks people to stop writing.
 *
 *   node scripts/audit/detect-claimed-guards.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['src', 'scripts'].map((d) => join(ROOT, d)).filter(existsSync);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** A test filename mentioned anywhere in a file. */
const NAMES = /\b([\w.-]+\.test\.(?:tsx?|mts|mjs))\b/g;

const files = ROOTS.flatMap((r) => walk(r))
  .filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f));

// Every test file that actually exists, by basename — a comment rarely gives
// a full path, and the same basename in another directory still means the
// guard is real and findable.
const existing = new Set(
  files.filter((f) => /\.test\.(tsx?|mts|mjs)$/.test(f)).map((f) => f.split(/[\\/]/).pop()),
);

const claims = [];
for (const file of files) {
  if (/\.test\.(tsx?|mts|mjs)$/.test(file)) continue; // a test naming itself is fine
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(NAMES)) {
    const named = m[1];
    if (existing.has(named)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    claims.push({ file: relative(ROOT, file).split('\\').join('/'), line, named });
  }
}

if (claims.length === 0) {
  console.log(`\nNo file names a test that does not exist. Checked ${files.length} files against ${existing.size} test files.\n`);
  process.exit(0);
}

console.log(`\n${claims.length} comment(s) name a test file that does not exist:\n`);
for (const c of claims) {
  console.log(`  ${c.file}:${c.line}  names  ${c.named}`);
}
console.log('\nEither write the test or delete the claim. A named guard that is');
console.log('missing reads as coverage and stops the next person checking.\n');
process.exit(1);
