// Lists the test files that read a .ts/.tsx source file with bare readFileSync.
// Used once to seed the baseline in src/test-support/source-readers.test.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const READS_SOURCE = /readFileSync\(([^)]*\.tsx?['"][^)]*)\)/g;

const hits = [];
for (const file of walk(SRC).filter((f) => /\.test\.tsx?$/.test(f))) {
  const src = readFileSync(file, 'utf8');
  if ([...src.matchAll(READS_SOURCE)].length > 0) {
    hits.push(relative(SRC, file).split('\\').join('/'));
  }
}

console.log(JSON.stringify(hits.sort(), null, 2));
console.error(`count: ${hits.length}`);
