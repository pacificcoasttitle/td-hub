/**
 * Policy type comes from GetAttachedDocumentsPolicy, already classified.
 * Filename guessing is how we used to mis-file a lender's policy as an
 * owner's. If the vendor row has no type, we do not invent one.
 */

export const POLICY_KINDS = ['lender_policy', 'owner_policy', 'supplement'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

const TYPE_ALIASES: Record<string, PolicyKind> = {
  lender: 'lender_policy',
  lenders: 'lender_policy',
  lender_policy: 'lender_policy',
  lenderpolicy: 'lender_policy',
  owner: 'owner_policy',
  owners: 'owner_policy',
  owner_policy: 'owner_policy',
  ownerpolicy: 'owner_policy',
  supplement: 'supplement',
  supplemental: 'supplement',
  supplement_statement: 'supplement',
};

function normalizeType(value: string): PolicyKind | null {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TYPE_ALIASES[key] ?? null;
}

export function classifyPolicyFromVendor(
  row: Record<string, unknown>,
  requestedDocType?: string,
): PolicyKind | null {
  const fromRow = [row.DocType, row.Type, row.DocumentType, row.docType, row.type]
    .find((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (fromRow) return normalizeType(fromRow);
  if (requestedDocType) return normalizeType(requestedDocType);
  return null;
}

export const POLICY_LABELS: Record<PolicyKind, string> = {
  lender_policy: "Lender's policy",
  owner_policy: "Owner's policy",
  supplement: 'Supplement',
};

export const POLICY_REQUIRED_ROLES: Record<PolicyKind, readonly string[]> = {
  lender_policy: ['escrow', 'lender'],
  owner_policy: ['owner'],
  supplement: ['escrow'],
};
