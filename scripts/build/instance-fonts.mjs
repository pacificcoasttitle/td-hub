/**
 * Generates the static TTF weights the Concierge document registers, from the
 * official Google Fonts variable sources.
 *
 * WHY THIS EXISTS. The official repo (github.com/google/fonts) ships ONLY
 * variable fonts for both families — Montserrat[wght].ttf and
 * WorkSans[wght].ttf, no static instances. And @react-pdf/renderer 4.8 does
 * not honour fontWeight against a variable file: measured, the string
 * "HAMBURGEFONS" has an advance width of 361.28 at weight 400 and 361.28 at
 * weight 900. Registering the variable file per weight would render every
 * heading at the default and look plausible while being wrong.
 *
 * So each weight is instanced out with fontTools varLib.instancer, which is the
 * upstream tool for exactly this.
 *
 * PROVENANCE IS THE POINT. The source files are committed alongside the
 * generated ones and their SHA-256 is asserted here before anything is
 * generated: if the source has been swapped, this refuses rather than quietly
 * producing different fonts. A reader can verify the chain end to end —
 * download from the URL below, compare to SOURCES, re-run, compare outputs.
 *
 *   node scripts/build/instance-fonts.mjs            # generate + report
 *   node scripts/build/instance-fonts.mjs --check    # verify only, no writes
 *
 * Needs fontTools on PATH as `fonttools`, or FONTTOOLS_PYTHON pointing at a
 * python that has it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src', 'lib', 'domain', 'concierge', 'document', 'fonts');

/**
 * The upstream files, with the digest they had when they were taken.
 *
 * Downloaded 2026-09-29 from
 *   https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf
 *   https://raw.githubusercontent.com/google/fonts/main/ofl/worksans/WorkSans%5Bwght%5D.ttf
 * Licence: SIL Open Font License 1.1, committed as OFL-Montserrat.txt and
 * OFL-WorkSans.txt beside them.
 */
const SOURCES = {
  'Montserrat-Variable.ttf': {
    sha256: '0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7',
    bytes: 744936,
    weights: [600, 700, 800, 900],
    out: (w) => `Montserrat-${w}.ttf`,
  },
  'WorkSans-Variable.ttf': {
    sha256: 'f50f61f2ba738e239442d40bf1069adb195c224b6a5a73a581fc2f3ed62a9f63',
    bytes: 361072,
    weights: [500, 600, 700],
    out: (w) => `WorkSans-${w}.ttf`,
  },
};

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function fonttools(args) {
  const py = process.env.FONTTOOLS_PYTHON;
  if (py) return execFileSync(py, ['-m', 'fontTools.varLib.instancer', ...args], { stdio: 'pipe' });
  return execFileSync('fonttools', ['varLib.instancer', ...args], { stdio: 'pipe' });
}

const checkOnly = process.argv.includes('--check');
let failed = false;

for (const [src, spec] of Object.entries(SOURCES)) {
  const srcPath = join(DIR, src);
  if (!existsSync(srcPath)) {
    console.error(`MISSING SOURCE: ${srcPath}`);
    failed = true;
    continue;
  }
  const got = sha256(srcPath);
  const size = readFileSync(srcPath).length;
  if (got !== spec.sha256 || size !== spec.bytes) {
    console.error(`SOURCE CHANGED: ${src}`);
    console.error(`  expected ${spec.sha256} (${spec.bytes} bytes)`);
    console.error(`  found    ${got} (${size} bytes)`);
    console.error('  Refusing to generate. Update SOURCES deliberately if this is intended.');
    failed = true;
    continue;
  }
  console.log(`${src}  sha256 ok, ${size} bytes`);

  for (const w of spec.weights) {
    const outName = spec.out(w);
    const outPath = join(DIR, outName);
    if (checkOnly) {
      console.log(`  ${outName.padEnd(24)} ${existsSync(outPath) ? `${sha256(outPath)}  ${readFileSync(outPath).length} bytes` : 'MISSING'}`);
      if (!existsSync(outPath)) failed = true;
      continue;
    }
    // instancer pins the wght axis and drops the variation tables, which is
    // what makes the result a real static face rather than a default instance.
    fonttools([srcPath, `wght=${w}`, '-o', outPath]);
    console.log(`  ${outName.padEnd(24)} ${sha256(outPath)}  ${readFileSync(outPath).length} bytes`);
  }
}

if (!checkOnly) {
  const total = readdirSync(DIR).filter((f) => f.endsWith('.ttf'))
    .reduce((n, f) => n + readFileSync(join(DIR, f)).length, 0);
  console.log(`\nfonts/ total: ${(total / 1024 / 1024).toFixed(2)} MB across ${readdirSync(DIR).filter((f) => f.endsWith('.ttf')).length} ttf files`);
}

process.exit(failed ? 1 : 0);
