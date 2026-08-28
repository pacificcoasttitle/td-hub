/**
 * SoftPro AddDocuments FolderName strings, copied from legacy PHP.
 *
 * Legacy posts LV / grant deed / tax in one FileList with these exact folder
 * strings. 'Title Docs' and underscored category names are ours and are wrong.
 * CPL is 'CPL' — keep that when CPL generation is built; do not invent a replace.
 */
export const SOFTPRO_TITLE_DOC_CATEGORIES = ['legal_vesting', 'grant_deed', 'tax'] as const;
export type SoftProTitleDocCategory = (typeof SOFTPRO_TITLE_DOC_CATEGORIES)[number];

export const SOFTPRO_TITLE_FOLDER: Record<SoftProTitleDocCategory, string> = {
  legal_vesting: 'legal-vesting',
  grant_deed: 'grant-deed',
  tax: 'tax',
};

export function isTitleDocCategory(category: string): category is SoftProTitleDocCategory {
  return (SOFTPRO_TITLE_DOC_CATEGORIES as readonly string[]).includes(category);
}

export function softProFolderForCategory(category: string, override?: string): string {
  if (override) return override;
  if (category === 'cpl') return 'CPL';
  if (category === 'proposed_insured') return 'desk-file-upload';
  if (isTitleDocCategory(category)) return SOFTPRO_TITLE_FOLDER[category];
  return category;
}

/** Windows Path.GetFileName rejects ? and &. Last path segment must be a legal filename. */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

export function sanitizeSoftProFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '');
  if (!cleaned || !SAFE_FILENAME.test(cleaned) || cleaned === '.' || cleaned === '..') {
    throw new Error(`FileURL filename is not a legal Windows name: ${filename}`);
  }
  return cleaned;
}

/**
 * Strip query/hash so Path.GetFileName does not see `?token=...`.
 * Throws if the last path segment is not a safe filename.
 */
export function cleanSoftProFileUrl(raw: string): string {
  const url = new URL(raw);
  url.search = '';
  url.hash = '';
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  url.pathname = url.pathname.replace(/\/[^/]*$/, `/${sanitizeSoftProFilename(last)}`);
  return url.toString();
}

export function attachedNamesFromGetAttached(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const names: string[] = [];
  for (const item of data) {
    if (typeof item === 'string') {
      try {
        const last = new URL(item).pathname.split('/').filter(Boolean).pop();
        if (last) names.push(decodeURIComponent(last));
      } catch {
        const last = item.split('/').filter(Boolean).pop();
        if (last) names.push(last);
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      const name = [row.FileName, row.DocumentName, row.fileName, row.documentName]
        .find((v) => typeof v === 'string' && v.trim());
      if (typeof name === 'string') names.push(name.trim());
    }
  }
  return names;
}

export function countSentAmongAttached(sentNames: string[], attachedNames: string[]): number {
  const attached = new Set(attachedNames.map((n) => n.toLowerCase()));
  return sentNames.filter((n) => attached.has(n.toLowerCase())).length;
}
