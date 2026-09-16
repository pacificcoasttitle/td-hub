import { getAttachedDocumentsPolicy } from '@/lib/integrations/softpro';
import type { SoftProPolicyDocType } from '@/lib/integrations/softpro/client';
import { classifyPolicyFromVendor, type PolicyKind } from './policy-classify';

const DOC_TYPES: SoftProPolicyDocType[] = ['Lender', 'Owner', 'Supplement'];

export async function classifyPolicyFile(
  fileNumber: string,
  fileName: string,
): Promise<PolicyKind | null> {
  const all = await getAttachedDocumentsPolicy(fileNumber);
  if (all.success && Array.isArray(all.data)) {
    const match = all.data.find((row) => row.FileName === fileName);
    if (match) {
      const kind = classifyPolicyFromVendor(match);
      if (kind) return kind;
    }
  }

  for (const docType of DOC_TYPES) {
    const page = await getAttachedDocumentsPolicy(fileNumber, docType);
    if (!page.success || !Array.isArray(page.data)) continue;
    const match = page.data.find((row) => row.FileName === fileName);
    if (!match) continue;
    return classifyPolicyFromVendor(match, docType);
  }

  return null;
}
