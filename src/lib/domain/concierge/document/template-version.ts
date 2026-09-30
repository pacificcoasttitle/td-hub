/**
 * The Concierge document's template version, and nothing else.
 *
 * A LEAF MODULE ON PURPOSE. It imports nothing, so a client component can read
 * the constant without dragging the document in behind it.
 *
 * reports-list-page.tsx is a client component, and importing this constant
 * from profile-document.tsx pulled the whole PDF module into the BROWSER
 * bundle: @react-pdf/renderer, `node:fs` via fonts.ts, and ~670 KB of base64
 * in brand-assets.ts. The Turbopack build failed on it —
 *
 *   Code generation for chunk item errored
 *   [project]/src/components/admin/reports/reports-list-page.tsx [app-client]
 *
 * — which is the lucky outcome. Had it merely succeeded, every operator
 * loading /reports would have downloaded a PDF renderer and two inlined
 * images to render one version string.
 *
 * Same reason font-files.ts is split out of fonts.ts: the thing a light caller
 * needs must not live in the same module as the heavy thing.
 *
 * Bump it on any layout change. profile-document.tsx re-exports it, so the
 * document and the list cannot disagree about what a re-render produces.
 */
export const TEMPLATE_VERSION = 'v4';
