import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { effectiveDpi, pngSize } from './png-size';

// ─── The two numbers the hazard sheet's layout depends on ───────────────────
//
// The spec says to measure the preview's real pixel dimensions before
// committing to a layout, because a preview sized for a web page may be too
// soft to print across a letter sheet. These are read off the PNG's own IHDR
// rather than assumed, and stored per profile, because the vendor is free to
// change them and a layout built on an assumption nobody can re-check is how a
// fuzzy image ships.

/** A real, structurally valid PNG of the given size. Not a hand-faked header. */
function png(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrBody = Buffer.alloc(13);
  ihdrBody.writeUInt32BE(width, 0);
  ihdrBody.writeUInt32BE(height, 4);
  ihdrBody[8] = 8;  // bit depth
  ihdrBody[9] = 2;  // colour type: truecolour
  const ihdr = chunk('IHDR', ihdrBody);
  // One all-zero scanline per row, filter byte 0. Enough to be a real image.
  const rawRows = Buffer.alloc(height * (1 + width * 3));
  const idat = chunk('IDAT', deflateSync(rawRows));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  // The CRC is not checked by pngSize and is not what these tests are about,
  // so it is present and zero rather than computed — stated, so nobody later
  // reads this helper as producing a file an image viewer will accept.
  return Buffer.concat([len, Buffer.from(type, 'latin1'), body, Buffer.alloc(4)]);
}

describe('reading a PNG\'s declared size', () => {
  it('reads width and height from the IHDR', () => {
    expect(pngSize(png(1700, 2200))).toEqual({ width: 1700, height: 2200 });
  });

  it('is null for bytes that are not a PNG', () => {
    // A decoded error string, which is the realistic case: Buffer.from(…,
    // 'base64') drops invalid characters and hands back whatever it managed.
    expect(pngSize(Buffer.from('{"error":"Missing required property fields"}'))).toBeNull();
  });

  it('is null for a truncated file rather than reading past the end', () => {
    expect(pngSize(png(100, 100).subarray(0, 20))).toBeNull();
    expect(pngSize(Buffer.alloc(0))).toBeNull();
  });

  it('is null when the first chunk is not IHDR', () => {
    // A PNG is required to put IHDR first. Something that does not is not a
    // file to make layout decisions from.
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const notIhdr = Buffer.concat([sig, chunk('tEXt', Buffer.alloc(13))]);
    expect(pngSize(notIhdr)).toBeNull();
  });

  it('is null for a zero dimension, which is illegal and would divide by nothing', () => {
    expect(pngSize(png(0, 500))).toBeNull();
    expect(pngSize(png(500, 0))).toBeNull();
  });

  it('handles a large image without overflowing', () => {
    expect(pngSize(png(5000, 20))).toEqual({ width: 5000, height: 20 });
  });
});

describe('will it print', () => {
  // The document's content width: letter 612pt less parts.ts's SIDE of 42 on
  // each edge. The number the verdict is about.
  const CONTENT_W = 528;

  it('computes dots per inch across a given width in points', () => {
    // 528pt is 7.333in, so 2200px across it is 300dpi.
    expect(effectiveDpi(2200, CONTENT_W)).toBe(300);
    expect(effectiveDpi(1100, CONTENT_W)).toBe(150);
    expect(effectiveDpi(528, CONTENT_W)).toBe(72);
  });

  it('shows why a screen-sized preview is the thing to worry about', () => {
    // A 1000px-wide image is unremarkable on a screen and 136dpi on paper —
    // under half the usual print floor. This is the measurement the layout
    // waits for, written down as a number rather than an opinion.
    expect(effectiveDpi(1000, CONTENT_W)).toBe(136);
    expect(effectiveDpi(1000, CONTENT_W)).toBeLessThan(300);
  });

  it('is zero rather than Infinity for a nonsense width', () => {
    expect(effectiveDpi(2200, 0)).toBe(0);
    expect(effectiveDpi(2200, -10)).toBe(0);
  });
});
