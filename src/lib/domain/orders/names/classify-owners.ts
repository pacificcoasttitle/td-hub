import { classifyPartyName, type NameKind } from '@/lib/domain/cpl/borrower-resolution';
import { parseSiteXOwners } from '@/lib/domain/orders/names/sitex-owner-names';
import type { PersonName } from '@/lib/domain/orders/names/split-full-name';

export interface ClassifiedOwner {
  kind: NameKind;
  isOrg: boolean;
  orgType: string;
  /** Person parse, or the unsplit org/trust name in firstName. */
  person: PersonName;
}

export interface ClassifiedOwners {
  primary: ClassifiedOwner | null;
  secondary: ClassifiedOwner | null;
  warnings: string[];
}

function orgTypeFor(kind: NameKind, raw: string): string {
  if (kind === 'trust') return 'Trust';
  const u = raw.toUpperCase();
  if (/\bLLC\b/.test(u)) return 'LLC';
  if (/\bINC\b|\bCORP/.test(u)) return 'Corporation';
  if (/\bLLP\b|\b\sLP\b|\bPARTNERSHIP\b/.test(u)) return 'Partnership';
  return 'Other';
}

function orgPerson(raw: string): PersonName {
  return { firstName: raw.trim(), middleName: '', lastName: '' };
}

function classifyOne(raw: string | null | undefined): ClassifiedOwner | null {
  const name = (raw ?? '').trim();
  if (!name) return null;
  const kind = classifyPartyName(name);
  if (kind === 'company' || kind === 'trust') {
    return { kind, isOrg: true, orgType: orgTypeFor(kind, name), person: orgPerson(name) };
  }
  return null;
}

/**
 * SiteX owners for the open-order forms. Entities/trusts are never fed to
 * parseSiteXOwners (that is the person parser that produced
 * Real / Estate Investment Llc / B).
 */
export function classifySiteXOwners(
  primaryOwner: string | null | undefined,
  secondaryOwner?: string | null,
): ClassifiedOwners {
  const primaryEntity = classifyOne(primaryOwner);
  const secondaryEntity = classifyOne(secondaryOwner);

  if (primaryEntity || secondaryEntity) {
    const parsed = primaryEntity && secondaryEntity
      ? { primary: primaryEntity.person, secondary: secondaryEntity.person, warnings: [] as string[] }
      : parseSiteXOwners(
        primaryEntity ? '' : primaryOwner,
        secondaryEntity ? '' : secondaryOwner,
      );
    return {
      primary: primaryEntity ?? (parsed.primary
        ? { kind: 'person', isOrg: false, orgType: '', person: parsed.primary }
        : null),
      secondary: secondaryEntity ?? (parsed.secondary
        ? { kind: 'person', isOrg: false, orgType: '', person: parsed.secondary }
        : null),
      warnings: parsed.warnings,
    };
  }

  const parsed = parseSiteXOwners(primaryOwner, secondaryOwner);
  return {
    primary: parsed.primary
      ? { kind: 'person', isOrg: false, orgType: '', person: parsed.primary }
      : null,
    secondary: parsed.secondary
      ? { kind: 'person', isOrg: false, orgType: '', person: parsed.secondary }
      : null,
    warnings: parsed.warnings,
  };
}
