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

/**
 * The entity name, unsplit, in one field.
 *
 * `lastName` is '-' rather than empty because the payload builder substitutes
 * 'TBD' for an empty last name on a non-organization party, and SoftPro
 * concatenates the parts — so an empty last name stores
 * "PACIFIC HOLDINGS LLC TBD". Measured on staging: the same name with '-'
 * stores as "PACIFIC HOLDINGS LLC -".
 */
function orgPerson(raw: string): PersonName {
  return { firstName: raw.trim(), middleName: '', lastName: '-' };
}

// ─── THE ORGANIZATION FLAG IS OFF, AND THIS IS NOT A STYLE CHOICE ───────────
//
// `IsOrganization: true` makes SoftPro drop the party's name. Measured against
// staging, four creates, same entity name, one variable at a time:
//
//   legacy shape   First PACIFIC / Middle HOLDINGS / Last LLC, "true"  -> ""
//   our shape      First "PACIFIC HOLDINGS LLC" / Last "-",    "true"  -> ""
//   boolean true   identical to the above but a real boolean           -> ""
//   CONTROL        identical, IsOrganization "false"    -> "PACIFIC HOLDINGS LLC -"
//
// So it is not the name layout and not string-versus-boolean. It is the flag.
//
// CONFIRMED IN PRODUCTION, same call, same orders:
//
//   20021656-GLT  seller[ORG] "Properties Llc Ahava"       READ ""
//   20021674-GLT  seller[ORG] "Antonio S (co-Tr) Godoy"    READ ""
//   20021756-GLT  seller[ORG] "Ramon And Judith Trs …"     READ ""
//   20021757-GLT  seller NOT org "Walter E Dancsecs"       READ "Walter E Dancsecs"
//
// An organization BUYER is worse: the entire contacts block comes back null.
//
// THE FLAG HAS ALWAYS DONE THIS. Eight of the ten affected orders pre-date this
// module — operators ticking the box by hand. Auto-ticking made it frequent and
// fed it cleaner names; it did not cause it.
//
// So: keep the classification, keep the UNSPLIT NAME (that part is a real
// improvement over the person parser's "Huisje | Nevada Llc | Leuk"), and stop
// setting the flag. A visible seller with a slightly wrong name beats an
// invisible one.
//
// `kind` and `orgType` are still returned. They are correct, they cost nothing,
// and they are what the flag will be restored from once the vendor explains how
// createOrder maps three name parts onto pfm.Contact.Name — see
// docs/tickets/SOFTPRO_ORGANIZATION_FLAG_DROPS_THE_NAME.md.
const SET_SOFTPRO_ORGANIZATION_FLAG = false;

function classifyOne(raw: string | null | undefined): ClassifiedOwner | null {
  const name = (raw ?? '').trim();
  if (!name) return null;
  const kind = classifyPartyName(name);
  if (kind === 'company' || kind === 'trust') {
    return {
      kind,
      isOrg: SET_SOFTPRO_ORGANIZATION_FLAG,
      orgType: orgTypeFor(kind, name),
      person: orgPerson(name),
    };
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
