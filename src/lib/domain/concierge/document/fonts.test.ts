import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import React from 'react';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { BODY, FONT_FILES, HEADING, missingFonts, registerDocumentFonts } from './fonts';

// ─── The fonts have to be there, and the weights have to be different ───────
//
// Two failures this guards, and the second is the one that nearly shipped.
//
// MISSING FILES. @react-pdf reads the TTF from disk at render time. Next only
// traces files it sees imported, and these are read from a runtime path, so a
// tracing change drops them from the deployed bundle. registerDocumentFonts
// throws rather than falling back to Helvetica, which would look fine.
//
// A VARIABLE FONT THAT IGNORES WEIGHT. The official Google Fonts repo ships
// only Montserrat[wght].ttf and WorkSans[wght].ttf. Registering those per
// weight renders EVERY weight at the default: measured before any of this was
// built, "HAMBURGEFONS" was 361.28 wide at weight 400 and 361.28 at weight
// 900. That is invisible in a page-count test, invisible in a text test, and
// invisible to anyone who has not seen the intended design — so it is asserted
// here by measuring advance widths, which is the only thing that can see it.

const DIR = join(process.cwd(), 'src', 'lib', 'domain', 'concierge', 'document', 'fonts');

registerDocumentFonts();

async function widthOf(family: string, weight: number): Promise<number> {
  const buf = await renderToBuffer(
    React.createElement(Document, null,
      React.createElement(Page, { size: 'LETTER' },
        React.createElement(Text, { style: { fontFamily: family, fontWeight: weight, fontSize: 40 } }, 'HAMBURGEFONS'))),
  );
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const c = await (await doc.getPage(1)).getTextContent();
  const item = c.items.find((i) => 'width' in i && 'str' in i && i.str.includes('HAMBURG'));
  if (!item || !('width' in item)) throw new Error(`no text rendered for ${family} ${weight}`);
  return item.width as number;
}

describe('the font files are present', () => {
  it('has every file the document registers', () => {
    expect(missingFonts()).toEqual([]);
  });

  it('registers without throwing', () => {
    expect(() => registerDocumentFonts()).not.toThrow();
  });

  it('ships the OFL licence text beside them', () => {
    // SIL OFL permits embedding and redistribution; it also requires the
    // licence to travel with the files.
    for (const name of ['OFL-Montserrat.txt', 'OFL-WorkSans.txt']) {
      const txt = readFileSync(join(DIR, name), 'utf8');
      expect(txt).toContain('SIL OPEN FONT LICENSE');
    }
  });

  it('registers static instances, not the variable sources', () => {
    // A [wght] file among the registered files means the instancing step was
    // skipped and every weight will render identically.
    for (const f of FONT_FILES) {
      expect(f.file).not.toMatch(/\[wght\]|Variable/);
    }
  });
});

describe('the registered weights actually differ', () => {
  it('Montserrat 600 and 900 have different advance widths', async () => {
    const [w600, w900] = await Promise.all([widthOf(HEADING, 600), widthOf(HEADING, 900)]);
    expect(w600).toBeGreaterThan(0);
    expect(w900).not.toBeCloseTo(w600, 1);
  });

  it('Work Sans 500 and 700 have different advance widths', async () => {
    const [w500, w700] = await Promise.all([widthOf(BODY, 500), widthOf(BODY, 700)]);
    expect(w500).toBeGreaterThan(0);
    expect(w700).not.toBeCloseTo(w500, 1);
  });

  it('the two families are not the same font', async () => {
    const [heading, body] = await Promise.all([widthOf(HEADING, 700), widthOf(BODY, 700)]);
    expect(heading).not.toBeCloseTo(body, 1);
  });
});
