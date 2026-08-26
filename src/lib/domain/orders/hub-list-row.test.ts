import { describe, expect, it } from 'vitest';
import {
  dayDividerLabel, describeMissing, fullAddress, fullDateTime, groupByDay,
  isIncomplete, listAddress, missingFields, nextIncompleteIndex, pacificDayKey,
  timeOfDay, typeChip, type HubListOrder,
} from './hub-list-row';

function row(over: Partial<HubListOrder> = {}): HubListOrder {
  return {
    id: 1,
    fileNumber: '20021375-OCT',
    propertyStreet: '118 Trafalgar Ln',
    propertyCity: 'Anaheim',
    propertyState: 'CA',
    propertyZip: '92807',
    clientName: 'Lupe Vidaca',
    clientCompany: null,
    transactionType: 'Refinance',
    operationalStatus: 'in_process',
    openedAtIso: '2026-08-25T01:37:53.000Z',
    syncStatus: 'synced',
    county: 'Orange',
    apn: '123-456-789',
    softproStatus: 'In Process',
    createdByName: null,
    ...over,
  };
}

describe('pacific day boundaries', () => {
  it('puts a late-evening Pacific instant on the Pacific day, not the UTC one', () => {
    // 2026-08-25T01:37Z is 6:37pm on the 24th in Pacific. The naive answer
    // (slice the ISO string) would file it under the 25th and the order would
    // vanish from "opened today" hours before midnight.
    expect(pacificDayKey('2026-08-25T01:37:53.000Z')).toBe('2026-08-24');
  });

  it('is right on the spring-forward day, when the offset changes at 2am', () => {
    // 2026-03-08 is the DST transition. 09:30Z is 01:30 PST — still the 8th.
    expect(pacificDayKey('2026-03-08T09:30:00.000Z')).toBe('2026-03-08');
    // 11:30Z is 04:30 PDT, after the jump — still the 8th.
    expect(pacificDayKey('2026-03-08T11:30:00.000Z')).toBe('2026-03-08');
    // 07:30Z is 23:30 PST on the 7th.
    expect(pacificDayKey('2026-03-08T07:30:00.000Z')).toBe('2026-03-07');
  });

  it('returns null rather than a guess for a missing or unparseable date', () => {
    expect(pacificDayKey(null)).toBeNull();
    expect(pacificDayKey('not a date')).toBeNull();
  });
});

describe('timeOfDay', () => {
  it('renders the Pacific clock with a single-letter meridiem', () => {
    expect(timeOfDay('2026-08-24T17:47:00.000Z')).toBe('10:47a');
    expect(timeOfDay('2026-08-24T23:12:00.000Z')).toBe('4:12p');
  });

  it('is null when there is no instant — never 12:00a', () => {
    expect(timeOfDay(null)).toBeNull();
  });
});

describe('dayDividerLabel', () => {
  it('marks today and keeps the weekday for other days', () => {
    expect(dayDividerLabel('2026-08-24', '2026-08-24')).toBe('TODAY · MON AUG 24');
    expect(dayDividerLabel('2026-08-21', '2026-08-24')).toBe('FRI · AUG 21');
  });
});

describe('fullDateTime', () => {
  it('is the absolute stamp the list no longer shows', () => {
    expect(fullDateTime('2026-08-24T17:47:00.000Z')).toBe('Mon Aug 24, 10:47a');
  });
});

describe('groupByDay', () => {
  const now = new Date('2026-08-24T20:00:00.000Z');

  it('groups consecutive runs and counts each day', () => {
    const groups = groupByDay([
      row({ id: 1, openedAtIso: '2026-08-24T18:00:00.000Z' }),
      row({ id: 2, openedAtIso: '2026-08-24T17:00:00.000Z' }),
      row({ id: 3, openedAtIso: '2026-08-22T17:00:00.000Z' }),
    ], now);
    expect(groups.map((g) => [g.dayKey, g.count])).toEqual([
      ['2026-08-24', 2],
      ['2026-08-22', 1],
    ]);
    expect(groups[0]!.label).toBe('TODAY · MON AUG 24');
  });

  it('does not sort — the server owns the order', () => {
    // Out-of-order input produces two separate groups for the same day rather
    // than being silently rearranged. A client-side re-sort here would make the
    // list disagree with the Sort control.
    const groups = groupByDay([
      row({ id: 1, openedAtIso: '2026-08-24T18:00:00.000Z' }),
      row({ id: 2, openedAtIso: '2026-08-22T17:00:00.000Z' }),
      row({ id: 3, openedAtIso: '2026-08-24T17:00:00.000Z' }),
    ], now);
    expect(groups.map((g) => g.dayKey)).toEqual(['2026-08-24', '2026-08-22', '2026-08-24']);
  });

  it('keeps dateless orders instead of dropping them', () => {
    const groups = groupByDay([row({ id: 9, openedAtIso: null })], now);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('NO DATE');
    expect(groups[0]!.orders[0]!.id).toBe(9);
  });

  it('returns nothing for no rows', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('missing fields', () => {
  it('lists them address, client, order type — the order the banner reads in', () => {
    const o = row({ propertyStreet: null, clientName: null, clientCompany: null, transactionType: null });
    expect(missingFields(o)).toEqual(['address', 'client', 'order type']);
    expect(describeMissing(missingFields(o))).toBe('no address, no client and no order type');
  });

  it('treats whitespace as absent', () => {
    expect(missingFields(row({ propertyStreet: '   ' }))).toEqual(['address']);
  });

  it('falls back to the client company before calling the client missing', () => {
    const o = row({ clientName: null, clientCompany: 'Freedom Escrow' });
    expect(missingFields(o)).toEqual([]);
    expect(isIncomplete(o)).toBe(false);
  });

  it('reads naturally for one and two missing fields', () => {
    expect(describeMissing(['address'])).toBe('no address');
    expect(describeMissing(['address', 'client'])).toBe('no address and no client');
    expect(describeMissing([])).toBe('');
  });
});

describe('address', () => {
  it('shows the street alone in the list and the whole line in the pane', () => {
    const o = row();
    expect(listAddress(o)).toBe('118 Trafalgar Ln');
    expect(fullAddress(o)).toBe('118 Trafalgar Ln, Anaheim, CA 92807');
  });

  it('omits the parts it does not have rather than printing empty commas', () => {
    expect(fullAddress(row({ propertyCity: null, propertyZip: null })))
      .toBe('118 Trafalgar Ln, CA');
    expect(fullAddress(row({
      propertyStreet: null, propertyCity: null, propertyState: null, propertyZip: null,
    }))).toBeNull();
  });
});

describe('typeChip', () => {
  it('maps the three known types and marks the rest Other', () => {
    expect(typeChip('Purchase').letter).toBe('P');
    expect(typeChip('refinance').letter).toBe('R');
    expect(typeChip('Equity').letter).toBe('O');
  });

  it('uses a dash for unset, distinct from Other', () => {
    expect(typeChip(null).letter).toBe('–');
    expect(typeChip('  ').letter).toBe('–');
    expect(typeChip(null).label).toBe('Type not set');
  });
});

describe('nextIncompleteIndex', () => {
  const complete = (id: number) => row({ id });
  const broken = (id: number) => row({ id, propertyStreet: null });

  it('walks forward and wraps at the end', () => {
    const rows = [complete(1), broken(2), complete(3), broken(4)];
    expect(nextIncompleteIndex(rows, -1)).toBe(1);
    expect(nextIncompleteIndex(rows, 1)).toBe(3);
    expect(nextIncompleteIndex(rows, 3)).toBe(1);
  });

  it('stays on the only incomplete row rather than reporting none', () => {
    const rows = [complete(1), broken(2), complete(3)];
    expect(nextIncompleteIndex(rows, 1)).toBe(1);
  });

  it('reports -1 when the queue is clean, and for an empty list', () => {
    expect(nextIncompleteIndex([complete(1), complete(2)], 0)).toBe(-1);
    expect(nextIncompleteIndex([], 0)).toBe(-1);
  });
});
