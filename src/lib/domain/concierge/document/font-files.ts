import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Which font files must exist, and whether they do ───────────────────────
//
// SEPARATE FROM fonts.ts ON PURPOSE. fonts.ts imports @react-pdf/renderer to
// call Font.register, so anything importing it pulls the whole PDF renderer
// into its bundle. /api/health wants to answer "are the TTFs here?" and has no
// business carrying a renderer to do it.
//
// Nothing here imports anything but node:fs and node:path.

export const FONT_DIR = join(process.cwd(), 'src', 'lib', 'domain', 'concierge', 'document', 'fonts');

export const HEADING = 'Montserrat';
export const BODY = 'Work Sans';

/** Every file the document registers, as (family, weight, filename). */
export const FONT_FILES = [
  // Mutation-checked: pointing these at Montserrat-Variable.ttf turns both the
  // naming guard and the advance-width measurement in fonts.test.ts red.
  { family: HEADING, weight: 600, file: 'Montserrat-600.ttf' },
  { family: HEADING, weight: 700, file: 'Montserrat-700.ttf' },
  { family: HEADING, weight: 800, file: 'Montserrat-800.ttf' },
  { family: HEADING, weight: 900, file: 'Montserrat-900.ttf' },
  { family: BODY, weight: 500, file: 'WorkSans-500.ttf' },
  { family: BODY, weight: 600, file: 'WorkSans-600.ttf' },
  { family: BODY, weight: 700, file: 'WorkSans-700.ttf' },
] as const;

/** Which required files are absent. Empty means all present. */
export function missingFonts(): string[] {
  return FONT_FILES.filter((f) => !existsSync(join(FONT_DIR, f.file))).map((f) => f.file);
}

export function fontsAvailable(): boolean {
  return missingFonts().length === 0;
}
