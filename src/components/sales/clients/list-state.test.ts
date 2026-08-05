import { describe, expect, it } from 'vitest';
import {
  decodeListState,
  encodeListState,
  EMPTY_LIST_STATE,
  profileHref,
  type ListState,
} from './list-state';

const FULL: ListState = {
  search: 'shalimar escrow',
  type: 'escrow',
  quietOnly: true,
  page: 3,
  repId: 22117,
};

describe('list state survives a round-trip to the profile and back', () => {
  it('restores search, filters, page and rep exactly', () => {
    expect(decodeListState(encodeListState(FULL))).toEqual(FULL);
  });

  it('round-trips a partially-filtered list', () => {
    const partial: ListState = { ...EMPTY_LIST_STATE, search: 'kw', page: 2 };
    expect(decodeListState(encodeListState(partial))).toEqual(partial);
  });

  it('round-trips the empty list without inventing state', () => {
    expect(encodeListState(EMPTY_LIST_STATE)).toBe('');
    expect(decodeListState('')).toEqual(EMPTY_LIST_STATE);
  });

  it('keeps a clean URL when nothing is filtered', () => {
    // A rep who has not searched should not get a query string at all.
    expect(profileHref(7, EMPTY_LIST_STATE)).toBe('/sales/clients/7');
  });

  it('carries the list state on the row link, and the rep scope separately', () => {
    const href = profileHref(42, FULL);
    expect(href.startsWith('/sales/clients/42?')).toBe(true);
    // repId is its own param because the profile fetch needs it directly.
    expect(href).toContain('repId=22117');

    const back = new URLSearchParams(href.split('?')[1]).get('back')!;
    expect(decodeListState(back)).toEqual(FULL);
  });

  it('survives characters that need encoding', () => {
    const s: ListState = { ...EMPTY_LIST_STATE, search: 'a&b c=d?e#f' };
    expect(decodeListState(encodeListState(s)).search).toBe('a&b c=d?e#f');
  });

  it('ignores junk rather than throwing', () => {
    const s = decodeListState('page=banana&rep=nope&quiet=maybe');
    expect(s.page).toBe(1);
    expect(s.repId).toBeNull();
    expect(s.quietOnly).toBe(false);
  });

  it('treats page=1 and rep-less as default so URLs stay short', () => {
    expect(encodeListState({ ...EMPTY_LIST_STATE, page: 1 })).toBe('');
  });
});
