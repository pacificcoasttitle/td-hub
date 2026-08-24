import { describe, expect, it } from 'vitest';
import { convertPlatMap, toDataUri } from './platmap';

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
      expect(toDataUri(r.png).startsWith('data:image/png;base64,')).toBe(true);
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
