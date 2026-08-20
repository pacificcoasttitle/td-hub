/**
 * Write HTML (and plain-text where available) for every system notification sample.
 *
 *   npx tsx scripts/export-notification-sample-html.ts
 *
 * Output: scripts/notification-samples/
 */

import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const { buildAllSampleEmails } = await import(
    '../src/lib/domain/notifications/sample-templates'
  );

  const outDir = resolve(process.cwd(), 'scripts/notification-samples');
  mkdirSync(outDir, { recursive: true });

  const samples = buildAllSampleEmails();
  const indexRows: { key: string; label: string; subject: string; file: string }[] = [];

  for (const sample of samples) {
    const file = `${sample.key}.html`;
    const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(sample.subject)}</title>
  <style>
    body { margin: 0; background: #e8ecf0; font-family: system-ui, sans-serif; }
    .banner { background: #1B2A4A; color: #fff; padding: 12px 20px; font-size: 13px; }
    .banner strong { color: #F26B2B; }
    .frame { max-width: 720px; margin: 24px auto; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  </style>
</head>
<body>
  <div class="banner"><strong>[SAMPLE]</strong> ${esc(sample.label)} — ${esc(sample.subject)}</div>
  <div class="frame">${sample.html}</div>
</body>
</html>
`;

    writeFileSync(resolve(outDir, file), page, 'utf8');
    if (sample.text) {
      writeFileSync(resolve(outDir, `${sample.key}.txt`), sample.text, 'utf8');
    }
    indexRows.push({ key: sample.key, label: sample.label, subject: sample.subject, file });
    console.log('wrote', file);
  }

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>TD Hub notification samples</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1B2A4A; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #526174; margin: 0 0 24px; }
    a { color: #1B2A4A; text-decoration: none; font-weight: 600; }
    a:hover { color: #F26B2B; }
    li { margin: 0 0 12px; line-height: 1.4; }
    .sub { display: block; font-weight: 400; color: #526174; font-size: 13px; margin-top: 2px; }
  </style>
</head>
<body>
  <h1>TD Hub notification samples</h1>
  <p>Generated sample HTML for every system email. Open any link below.</p>
  <ol>
    ${indexRows
      .map(
        (r) =>
          `<li><a href="${r.file}">${esc(r.label)}</a><span class="sub">${esc(r.subject)}</span></li>`,
      )
      .join('\n    ')}
  </ol>
</body>
</html>
`;

  writeFileSync(resolve(outDir, 'index.html'), indexHtml, 'utf8');
  console.log(`\nDone. ${samples.length} samples → ${outDir}`);
  console.log(`Open: ${resolve(outDir, 'index.html')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
