/**
 * What do this repo's .test.tsx files actually assert?
 *
 * 2C was a defect no assertion could have caught: the control rendered
 * correctly and only lost state when three events landed in one tick. The
 * question that raises is whether ANY UI test here can drive a component, or
 * whether files named *.test.tsx are source-reading tests wearing a component
 * test's filename — rule 9 at a scale that would change what we believe about
 * every UI test in the project.
 *
 * Three categories, by what the file imports and calls:
 *
 *   interactive  a real DOM: @testing-library, jsdom, happy-dom, fireEvent,
 *                userEvent, act, render() from a test renderer
 *   static       renderToStaticMarkup / renderToString — the component runs
 *                once and its initial HTML is read. Real rendering, no events,
 *                no state, no effects
 *   source       reads files and asserts on their text; renders nothing
 *   other        none of the above
 *
 *   node scripts/audit/what-do-tsx-tests-assert.mjs
 */
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

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const INTERACTIVE = /@testing-library|jsdom|happy-dom|fireEvent|userEvent|\bact\(|react-test-renderer|@vitejs\/plugin-react|\brender\(\s*</;
const STATIC = /renderToStaticMarkup|renderToString|renderToPipeableStream/;
const SOURCE = /readFileSync|readSource/;

const files = walk(SRC).filter((f) => /\.test\.tsx$/.test(f));
const rows = files.map((f) => {
  const src = strip(readFileSync(f, 'utf8'));
  return {
    file: relative(SRC, f).split('\\').join('/'),
    interactive: INTERACTIVE.test(src),
    static: STATIC.test(src),
    source: SOURCE.test(src),
  };
});

const cat = (r) => (r.interactive ? 'interactive' : r.static ? 'static' : r.source ? 'source' : 'other');
const counts = rows.reduce((m, r) => ({ ...m, [cat(r)]: (m[cat(r)] ?? 0) + 1 }), {});

console.log(`\n${rows.length} .test.tsx files\n`);
for (const k of ['interactive', 'static', 'source', 'other']) {
  console.log(`  ${k.padEnd(13)} ${counts[k] ?? 0}`);
}

console.log('\n── interactive (can drive events and state) ──');
const inter = rows.filter((r) => r.interactive);
if (inter.length === 0) console.log('  NONE. No test in this repo can click, type, or trigger a state update.');
for (const r of inter) console.log(`  ${r.file}`);

console.log('\n── static render only (initial HTML, no events) ──');
for (const r of rows.filter((r) => !r.interactive && r.static)) console.log(`  ${r.file}`);

console.log('\n── renders nothing (reads source) ──');
for (const r of rows.filter((r) => !r.interactive && !r.static && r.source)) console.log(`  ${r.file}`);

const other = rows.filter((r) => cat(r) === 'other');
if (other.length > 0) {
  console.log('\n── neither ──');
  for (const r of other) console.log(`  ${r.file}`);
}

console.log();
if (inter.length === 0) {
  console.log('No .test.tsx file can drive a component. A static render proves the');
  console.log('first paint is right and nothing about what happens when somebody');
  console.log('uses it — which is the class 2C belongs to.');
}
