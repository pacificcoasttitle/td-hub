import { describe, expect, it } from 'vitest';
import { resolveSoftProNoteIsInternal } from './note-visibility';

describe('resolveSoftProNoteIsInternal', () => {
  it('defaults to internal when SoftPro payload has no flag', () => {
    expect(resolveSoftProNoteIsInternal({})).toBe(true);
    expect(resolveSoftProNoteIsInternal(null)).toBe(true);
    expect(resolveSoftProNoteIsInternal(undefined, false)).toBe(false);
  });

  it('reads SoftPro Internal / InternalOnly aliases', () => {
    expect(resolveSoftProNoteIsInternal({ Internal: true })).toBe(true);
    expect(resolveSoftProNoteIsInternal({ Internal: false })).toBe(false);
    expect(resolveSoftProNoteIsInternal({ InternalOnly: false })).toBe(false);
    expect(resolveSoftProNoteIsInternal({ IsInternal: 'false' })).toBe(false);
    expect(resolveSoftProNoteIsInternal({ isInternal: 0 })).toBe(false);
  });
});
