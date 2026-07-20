/**
 * SoftPro stores downloads under Windows paths (MAX_PATH 260).
 * Keep DocumentName short and stable; do not send long TD Hub filenames.
 */
const CATEGORY_PREFIX: Record<string, string> = {
  cpl: 'cpl',
  prelim: 'prelim',
  policy: 'policy',
  legal_vesting: 'vest',
  grant_deed: 'gd',
  tax: 'tax',
  general: 'doc',
  user_upload: 'up',
  proposed_insured: 'ppi',
  curative: 'cur',
};

export function softProDocumentName(params: {
  documentId: number;
  category: string;
  filename?: string | null;
}): string {
  const prefix = CATEGORY_PREFIX[params.category] ?? 'doc';
  const ext = (params.filename?.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  return `${prefix}-${params.documentId}.${ext}`;
}
