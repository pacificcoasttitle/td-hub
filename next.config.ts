import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * @napi-rs/canvas is a NATIVE module and must not be bundled.
   *
   * Turbopack refused the build outright:
   *
   *   ./node_modules/@napi-rs/canvas/js-binding.js
   *   asset is not placeable in ESM chunks, so it doesn't have a module id
   *
   * js-binding.js loads a platform-specific `.node` binary, which is not
   * JavaScript and cannot become part of an ESM chunk. Listing it here leaves
   * it as a real `require` at runtime and lets Next trace the binary into the
   * function instead.
   *
   * THIS IS THE RUNG BELOW verify. `npm run verify` typechecks and tests but
   * does not bundle — AGENTS.md says so, with a 2026-09-30 precedent where a
   * client component dragged @react-pdf into the browser bundle and only
   * Vercel saw it. Same shape here: 297 files and 3,110 tests green, and the
   * deploy was the first thing to object.
   *
   * pdfjs-dist is listed with it. It is plain JavaScript and builds fine, but
   * it is what loads the canvas and bundling the two apart is how a loader
   * ends up holding a copy the externalised binary is not in.
   */
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],

  /**
   * The Concierge document's fonts must be inside the serverless function.
   *
   * @react-pdf/renderer reads a TTF from the filesystem at render time. Next
   * only traces files it can see being imported, and these are read by a path
   * built at runtime, so without this they are absent from the deployed bundle
   * and every render throws "Font family not registered" — or worse, silently
   * falls back. A production deploy already died once on a Google Fonts
   * download, which is why they are local files rather than a runtime fetch.
   *
   * fonts.ts has a self-check that says which files it could not find, so a
   * tracing change that drops them fails loudly instead of changing how the
   * document looks.
   */
  /**
   * ─── AND pdfjs's WORKER, for the same reason ──────────────────────────────
   *
   * The hazard sheet rasterises MyNHD's PDF, and pdfjs loads its worker with a
   * DYNAMIC import of a path it builds at runtime. Nothing static points at
   * the file, so Next does not trace it, and the deployed function died on the
   * first real fetch:
   *
   *   Setting up fake worker failed: "Cannot find module
   *   '/var/task/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'"
   *
   * Exactly the shape of the fonts above — a file reached by a runtime path
   * rather than an import — which is why both live in one list per route.
   *
   * ONE ENTRY PER ROUTE, not two. The first version of this added a second
   * '/api/concierge/**' key below the first; in an object literal the later
   * one silently wins, so the fonts entry became dead and nothing said so.
   */
  outputFileTracingIncludes: {
    // /api/health is in this list because its rasteriser check does a REAL
    // rasterisation and its font check reads the TTFs, and tracing is PER
    // ROUTE — without its own entry it would report both broken on a deploy
    // where the Concierge routes work.
    '/api/health/**': [
      './src/lib/domain/concierge/document/fonts/**',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
    '/api/concierge/**': [
      './src/lib/domain/concierge/document/fonts/**',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
    // Reports renders the same document but never rasterises a vendor PDF.
    '/api/reports/**': ['./src/lib/domain/concierge/document/fonts/**'],
  },
};

export default nextConfig;
