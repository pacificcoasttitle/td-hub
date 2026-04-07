// ============================================================
// TESSA™ PDF Text Extraction — Server-side (Node.js / Vercel)
// pdfjs-dist evaluates `new DOMMatrix()` at module load; Node has no
// DOMMatrix unless @napi-rs/canvas is installed. Polyfill MUST run
// before any import of pdf.mjs.
// Fake worker still imports pdf.worker.mjs — resolve an absolute path.
// ============================================================

import { createRequire } from 'node:module';

const MAX_CHARS = 50_000;
const require = createRequire(import.meta.url);

/**
 * Minimal DOMMatrix stand-in for pdfjs module init and transform helpers.
 * Text extraction does not rely on accurate matrix math for layout.
 */
function ensureDomMatrixPolyfill(): void {
  if (typeof globalThis.DOMMatrix !== 'undefined') return;

  class DOMMatrixPolyfill {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    m11 = 1;
    m12 = 0;
    m21 = 0;
    m22 = 1;
    m41 = 0;
    m42 = 0;
    is2D = true;
    isIdentity = true;

    constructor(init?: unknown) {
      if (init == null) return;
      if (Array.isArray(init) && init.length >= 6) {
        this.set6(init as number[]);
        return;
      }
      if (init instanceof Float32Array || init instanceof Float64Array) {
        this.set6(Array.from(init));
        return;
      }
      if (typeof init === 'object' && init !== null && 'a' in init) {
        const o = init as Record<string, number>;
        this.a = o.a ?? 1;
        this.b = o.b ?? 0;
        this.c = o.c ?? 0;
        this.d = o.d ?? 1;
        this.e = o.e ?? 0;
        this.f = o.f ?? 0;
        this.syncM();
      }
    }

    private set6(v: number[]) {
      this.a = v[0] ?? 1;
      this.b = v[1] ?? 0;
      this.c = v[2] ?? 0;
      this.d = v[3] ?? 1;
      this.e = v[4] ?? 0;
      this.f = v[5] ?? 0;
      this.syncM();
    }

    private syncM() {
      this.m11 = this.a;
      this.m12 = this.b;
      this.m21 = this.c;
      this.m22 = this.d;
      this.m41 = this.e;
      this.m42 = this.f;
    }

    multiplySelf() {
      return this;
    }
    preMultiplySelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    translate() {
      return this;
    }
    scaleSelf() {
      return this;
    }
    scale(_x?: number, _y?: number) {
      return this;
    }
    rotateSelf() {
      return this;
    }
    invertSelf() {
      return this;
    }
    setMatrixValue() {
      return this;
    }

    static fromMatrix() {
      return new DOMMatrixPolyfill();
    }
    static fromFloat32Array(arr: Float32Array) {
      return new DOMMatrixPolyfill(arr);
    }
    static fromFloat64Array(arr: Float64Array) {
      return new DOMMatrixPolyfill(arr);
    }
  }

  (globalThis as unknown as { DOMMatrix: typeof DOMMatrixPolyfill }).DOMMatrix =
    DOMMatrixPolyfill;
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  ensureDomMatrixPolyfill();

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, GlobalWorkerOptions } = pdfjsLib;
  GlobalWorkerOptions.workerSrc = require.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );

  const data = new Uint8Array(pdfBuffer);
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;

  let fullText = '';
  const totalPages = pdf.numPages;

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    let pageText = '';
    for (const item of textContent.items) {
      const chunk = (item as { str?: string; hasEOL?: boolean }).str || '';
      pageText += chunk;
      if ((item as { hasEOL?: boolean }).hasEOL) {
        pageText += '\n';
      } else {
        pageText += ' ';
      }
    }

    // Heuristic: force a newline before "NN. " bullets if they got flattened
    pageText = pageText.replace(/(\s{2,})(\d{1,3})\.\s/g, '\n$2. ');
    fullText += pageText + '\n\n';
  }

  const trimmed = fullText.trim();

  if (trimmed.length < 100) {
    throw new Error(
      'Unable to extract sufficient text from PDF. The document may be image-based or corrupted.',
    );
  }

  return trimmed.length > MAX_CHARS ? trimmed.substring(0, MAX_CHARS) : trimmed;
}
