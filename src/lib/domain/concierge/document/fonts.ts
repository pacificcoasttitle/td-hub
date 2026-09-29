import { join } from 'node:path';
import { Font } from '@react-pdf/renderer';
import { BODY, FONT_DIR, FONT_FILES, HEADING, missingFonts } from './font-files';

// ─── Montserrat and Work Sans, from local files ──────────────────────────────
//
// NO RUNTIME FETCH. A production deploy died once on a Google Fonts download,
// so these are committed TTFs read from disk. The licence is SIL OFL 1.1, which
// permits embedding and redistribution; OFL-Montserrat.txt and OFL-WorkSans.txt
// sit beside the files.
//
// THEY ARE STATIC INSTANCES, NOT THE VARIABLE FILES. The official Google Fonts
// repo ships only Montserrat[wght].ttf and WorkSans[wght].ttf, and
// @react-pdf/renderer 4.8 does not honour fontWeight against a variable file —
// measured, "HAMBURGEFONS" is 361.28 wide at weight 400 and 361.28 at weight
// 900. Every heading would have rendered at the default and looked deliberate.
// scripts/build/instance-fonts.mjs pins each weight with fontTools and records
// the source digests.
//
// PATHS ARE THE RISK. Next only traces files it sees imported, and these are
// read from a path built at runtime, so next.config.ts adds them to
// outputFileTracingIncludes. An <Image> with a bad src renders empty; a missing
// FONT throws at register time — which is better, but only if somebody sees it.
//
// The file list and the presence check live in font-files.ts, which imports
// nothing but node:fs, so /api/health can answer "are they here?" without
// pulling the PDF renderer into its bundle.

export { BODY, HEADING, FONT_FILES, missingFonts, fontsAvailable } from './font-files';

let registered = false;

/**
 * Register both families. Safe to call repeatedly.
 *
 * THROWS when a file is missing, naming the files and the directory. The
 * alternative is falling back to Helvetica, which produces a document that
 * looks fine, ships, and is silently off-brand — the failure mode this whole
 * module is arranged to avoid.
 */
export function registerDocumentFonts(): void {
  if (registered) return;
  const missing = missingFonts();
  if (missing.length > 0) {
    throw new Error(
      `Concierge document fonts missing from ${FONT_DIR}: ${missing.join(', ')}. `
      + 'Run `node scripts/build/instance-fonts.mjs`, and check '
      + 'outputFileTracingIncludes in next.config.ts if this is a deployed build.',
    );
  }
  for (const family of [HEADING, BODY]) {
    Font.register({
      family,
      fonts: FONT_FILES.filter((f) => f.family === family)
        .map((f) => ({ src: join(FONT_DIR, f.file), fontWeight: f.weight })),
    });
  }
  registered = true;
}
