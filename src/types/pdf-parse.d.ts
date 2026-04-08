declare module 'pdf-parse/lib/pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    text: string;
    version?: string;
  }

  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => Promise<string>;
    max?: number;
    version?: string;
  }

  export default function pdf(
    dataBuffer: Buffer | Uint8Array,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
}
