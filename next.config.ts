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
  outputFileTracingIncludes: {
    '/api/concierge/**': ['./src/lib/domain/concierge/document/fonts/**'],
    '/api/reports/**': ['./src/lib/domain/concierge/document/fonts/**'],
    // /api/health reports whether the TTFs are present, and tracing is PER
    // ROUTE — without this entry it would report them missing from its own
    // bundle while the Concierge routes had them, which is a false alarm that
    // costs more than the few hundred KB.
    '/api/health/**': ['./src/lib/domain/concierge/document/fonts/**'],
  },
};

export default nextConfig;
