// ─── A PNG's own idea of how big it is ───────────────────────────────────────
//
// Read from the IHDR chunk, which a PNG is required to carry first: an 8-byte
// signature, then a 4-byte length, then the type `IHDR`, then width and height
// as big-endian 32-bit integers.
//
// WHY THIS EXISTS AT ALL. The hazard sheet's layout depends on the preview's
// real pixel dimensions — a one-page image sized for a web view may be too soft
// to print across a letter page, and scaling it up to fill the sheet makes that
// worse rather than better. The spec says to measure the first real response
// before committing to a layout. So the number is read off the bytes and stored
// per profile, rather than being decided once by looking at one file: the
// vendor is free to change it, and a layout built on an assumption nobody can
// re-check is how a soft image ships.
//
// No image library. This is 20 lines of header parsing against a format that
// has not changed since 1996, and pulling in a decoder to learn two integers
// would add a dependency to the serverless bundle that renders every profile.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngSize {
  width: number;
  height: number;
}

/**
 * The declared dimensions, or null if these are not PNG bytes.
 *
 * Null rather than a throw, and null rather than a guess: a caller storing
 * these wants "we do not know" to be recordable. Everything downstream treats
 * absent dimensions as a reason not to make claims about print quality.
 */
export function pngSize(buf: Buffer): PngSize | null {
  // 8 signature + 4 length + 4 type + 8 dimensions.
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(SIGNATURE)) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  // Zero is illegal in a PNG and would otherwise divide by nothing later.
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/**
 * Dots per inch if this image is drawn across `widthPt` points.
 *
 * A PostScript point is 1/72 inch, so an image of `width` pixels drawn
 * `widthPt` points wide resolves at `width / (widthPt / 72)`.
 *
 * The number this answers is "will it print": 300 is the usual floor for
 * print, 150 is visibly soft on paper while looking fine on a screen, and 72 is
 * the screen itself. It is reported rather than enforced — what to do about a
 * soft preview is a decision for whoever is looking at it, not something to
 * resolve by silently shrinking the image.
 */
export function effectiveDpi(width: number, widthPt: number): number {
  if (widthPt <= 0) return 0;
  return Math.round(width / (widthPt / 72));
}
