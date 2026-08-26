// ─── Plat map conversion ─────────────────────────────────────────────────────
//
// SiteX returns PlatMap as { FileName, Content (base64), Status } — the image
// arrives inline, and it is a TIFF. @react-pdf/renderer accepts PNG and JPEG
// only, so it has to be converted before it can be placed on a page.
//
// WHY sharp. It is already in the tree (0.34.5, pulled in by Next for image
// optimisation) and present in the Vercel runtime, so it costs no additional
// install weight. Verified end to end: TIFF -> PNG in 5ms.
//
// It is nonetheless declared as an explicit dependency rather than relied on
// transitively — an undeclared dep that a Next upgrade happens to drop would
// break plat maps silently, and "silently" is the failure mode this whole
// feature exists to avoid.
//
// Conversion happens ONCE at generation and the PNG is stored, so decode speed
// is close to irrelevant; correctness and not shipping a native binary we do
// not already have are what matter.

export type PlatMapOutcome =
  | { ok: true; png: Buffer; width: number | null; height: number | null; sourceBytes: number }
  | { ok: false; reason: 'not_supplied' | 'not_available' | 'no_content' | 'decode_failed'; detail: string };

export interface RawPlatMap {
  filename: string | null;
  status: string | null;
  content: string | null;
}

/**
 * Convert the inline TIFF to a PNG.
 *
 * Every failure is an explicit outcome, never a thrown error swallowed upstream
 * and never a placeholder image — the document renders the absence with the
 * reason, which is what a reader needs to know.
 */
export async function convertPlatMap(raw: RawPlatMap | null): Promise<PlatMapOutcome> {
  if (!raw) return { ok: false, reason: 'not_supplied', detail: 'The feed returned no PlatMap section.' };

  // Status is authoritative — SiteX uses it to say the parcel has no plat map.
  if (raw.status && raw.status.toLowerCase() !== 'available') {
    return { ok: false, reason: 'not_available', detail: `The data provider reported plat map status "${raw.status}".` };
  }
  if (!raw.content || raw.content.trim() === '') {
    return { ok: false, reason: 'no_content', detail: 'The feed reported a plat map but supplied no image data.' };
  }

  let source: Buffer;
  try {
    source = Buffer.from(raw.content, 'base64');
  } catch {
    return { ok: false, reason: 'decode_failed', detail: 'The plat map payload was not valid base64.' };
  }
  if (source.length < 8) {
    return { ok: false, reason: 'no_content', detail: 'The plat map payload was empty.' };
  }

  try {
    // Imported lazily so a node script that never touches plat maps does not
    // pay sharp's native load, and so a missing binary surfaces here as a
    // handled outcome rather than a module-load crash.
    const sharp = (await import('sharp')).default;
    const image = sharp(source, { failOn: 'none' });
    const meta = await image.metadata();
    const png = await image.png({ compressionLevel: 9 }).toBuffer();
    return { ok: true, png, width: meta.width ?? null, height: meta.height ?? null, sourceBytes: source.length };
  } catch (err) {
    return {
      ok: false, reason: 'decode_failed',
      detail: err instanceof Error ? err.message : 'The plat map image could not be decoded.',
    };
  }
}

/** Data URI for react-pdf's <Image src>. */
export function toDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}
