import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapProfile } from './parsers';
import { deriveOwnerKind } from './owner-kind';
import { parseSiteXOwners } from '@/lib/domain/orders/names/sitex-owner-names';

const LIVE = 'C:/Users/gerar/Desktop/TransactionDeskV2/outputs/sitex-entity/entity-owner-100001-raw.json';

// The chain this feature exists to build. Each link is tested on its own
// elsewhere; this asserts they are actually connected, because three correct
// links and one missing call is exactly how the deed signal sat unused.
describe('deed -> mapProfile -> parseSiteXOwners', () => {
  it.runIf(existsSync(LIVE))('an LLC reaches the parser as entity-deed, not entity-marker', () => {
    const raw = JSON.parse(readFileSync(LIVE, 'utf8'));
    const mapped = mapProfile(raw.Feed.PropertyProfile, deriveOwnerKind(raw));
    expect(mapped.ownerKind).toBe('entity');

    const owners = parseSiteXOwners(mapped.primaryOwner, mapped.secondaryOwner, mapped.ownerKind ?? 'unknown');
    // The point: the VENDOR decided this, not the suffix list.
    expect(owners.branch).toBe('entity-deed');
    expect(owners.primary).toEqual({ firstName: '', middleName: '', lastName: '5558 RIVERTON LLC' });
  });

  it('the form passes ownerKind through — the call site takes three arguments', () => {
    const src = readFileSync(
      join(__dirname, '../../../components/admin/quick-entry/use-quick-entry.ts'), 'utf8');
    expect(src).toContain("parseSiteXOwners(p.primaryOwner, p.secondaryOwner, p.ownerKind ?? 'unknown')");
  });

  it('with no deed the same owner still abstains, via the marker list', () => {
    const owners = parseSiteXOwners('5558 RIVERTON LLC', null, 'unknown');
    expect(owners.branch).toBe('entity-marker');
    expect(owners.primary!.lastName).toBe('5558 RIVERTON LLC');
  });
});
