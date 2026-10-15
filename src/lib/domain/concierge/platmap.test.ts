import { describe, expect, it } from 'vitest';
import { convertPlatMap, imageMime, toDataUri } from './platmap';

/** A genuine TIFF, produced by sharp so the happy path is exercised for real. */
async function realTiff(): Promise<string> {
  const sharp = (await import('sharp')).default;
  const buf = await sharp({ create: { width: 240, height: 180, channels: 3, background: { r: 27, g: 42, b: 74 } } })
    .tiff().toBuffer();
  return buf.toString('base64');
}

describe('plat map conversion', () => {
  it('converts a real TIFF to PNG', async () => {
    const r = await convertPlatMap({ filename: 'x.tif', status: 'Available', content: await realTiff() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.width).toBe(240);
      expect(r.height).toBe(180);
      // PNG magic number — proves it is genuinely re-encoded, not passed through.
      expect(r.png.subarray(0, 4).toString('hex')).toBe('89504e47');
      expect(toDataUri(r.png)?.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  describe('every failure is an outcome, never a placeholder image', () => {
    it('no PlatMap section at all', async () => {
      const r = await convertPlatMap(null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not_supplied');
    });

    it('provider says the plat map is not available', async () => {
      const r = await convertPlatMap({ filename: null, status: 'Unavailable', content: 'irrelevant' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('not_available');
        // The reason is quoted back so the page can explain itself.
        expect(r.detail).toContain('Unavailable');
      }
    });

    it('status Available but no content', async () => {
      const r = await convertPlatMap({ filename: 'x.tif', status: 'Available', content: '' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('no_content');
    });

    it('content that is not a decodable image', async () => {
      // This is the shape the SiteX SAMPLE ships: a placeholder, not a TIFF.
      const r = await convertPlatMap({ filename: 'x.tif', status: 'Available', content: 'AKSDqweasdfqwe/==' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['decode_failed', 'no_content']).toContain(r.reason);
    });
  });

  it('treats status case-insensitively', async () => {
    const r = await convertPlatMap({ filename: 'x.tif', status: 'available', content: await realTiff() });
    expect(r.ok).toBe(true);
  });
});

// ─── The MIME comes from the BYTES ──────────────────────────────────────────
//
// toDataUri hardcoded image/png for a year, which was true by accident because
// everything it placed was a PNG. Then the MyNHD hazard sheet began choosing
// between PNG and JPEG by measuring which was smaller: profile 42 stored a
// good 2479x3508 JPEG, this handed the document a data URI claiming PNG, and
// react-pdf renders an <Image> it cannot decode as EMPTY RATHER THAN FAILING.
//
// Page 4 came out with its footnote, its footer and its page number, and
// nothing in the middle. Nothing threw. Nothing logged. The row said ready and
// it was — the image was simply mislabelled.

describe('toDataUri labels what it was actually given', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  // A real JPEG: SOI, a minimal APP0/JFIF header, EOI.
  const JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);

  it('says png for a PNG', () => {
    expect(imageMime(PNG)).toBe('image/png');
    expect(toDataUri(PNG)).toMatch(/^data:image\/png;base64,/);
  });

  it('says jpeg for a JPEG — the case that shipped a blank page', () => {
    expect(imageMime(JPEG)).toBe('image/jpeg');
    expect(toDataUri(JPEG)).toMatch(/^data:image\/jpeg;base64,/);
    // The specific bug: JPEG bytes must never be announced as PNG.
    expect(toDataUri(JPEG)).not.toContain('image/png');
  });

  it('returns null rather than guessing, so the absence is visible', () => {
    // The old behaviour labelled anything PNG, which is how a mislabelled
    // image became an invisible blank page. Every caller treats null as "no
    // image" and renders the gap — worse looking, far better to debug.
    expect(imageMime(Buffer.from('not an image'))).toBeNull();
    expect(toDataUri(Buffer.from('not an image'))).toBeNull();
    expect(toDataUri(Buffer.alloc(0))).toBeNull();
    // A PDF is the realistic wrong input: the bridge archives one beside the
    // raster and the two keys differ by one column.
    expect(toDataUri(Buffer.from('%PDF-1.4 ...'))).toBeNull();
  });

  it('carries the bytes through unchanged', () => {
    const uri = toDataUri(JPEG)!;
    const back = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    expect(back.equals(JPEG)).toBe(true);
  });
});
