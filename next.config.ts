import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
