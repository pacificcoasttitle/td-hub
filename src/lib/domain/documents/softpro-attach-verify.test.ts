import { describe, expect, it } from 'vitest';
import {
  SOFTPRO_ACCEPTED_NOT_CONFIRMED_COPY,
  classifyTitleDocAttach,
  softProSyncLabel,
} from './softpro-attach-verify';

describe('classifyTitleDocAttach', () => {
  it('200 + empty list → accepted, no retry', () => {
    const result = classifyTitleDocAttach({
      writeSuccess: true,
      writeError: null,
      listed: false,
    });
    expect(result).toEqual({
      state: 'accepted',
      isSyncedToSoftpro: true,
      listingConfirmed: false,
      acceptSource: 'add_documents_200',
      retry: false,
    });
  });

  it('already-exists → accepted, higher confidence, no retry', () => {
    const result = classifyTitleDocAttach({
      writeSuccess: false,
      writeError: 'An item already exists by that name.',
      listed: false,
    });
    expect(result).toEqual({
      state: 'accepted',
      isSyncedToSoftpro: true,
      listingConfirmed: false,
      acceptSource: 'already_exists',
      retry: false,
    });
    const bare200 = classifyTitleDocAttach({
      writeSuccess: true,
      writeError: null,
      listed: false,
    });
    expect(result.acceptSource).toBe('already_exists');
    expect(bare200.acceptSource).toBe('add_documents_200');
    expect(result.retry).toBe(false);
    expect(bare200.retry).toBe(false);
  });

  it('address 400 → failed, not accepted', () => {
    const result = classifyTitleDocAttach({
      writeSuccess: false,
      writeError: 'Property Address is required.;City is required.;State is required.;Zip is required.',
      listed: false,
    });
    expect(result).toEqual({
      state: 'failed',
      isSyncedToSoftpro: false,
      listingConfirmed: false,
      acceptSource: null,
      retry: true,
    });
  });

  it('listed names → confirmed', () => {
    const result = classifyTitleDocAttach({
      writeSuccess: true,
      writeError: null,
      listed: true,
    });
    expect(result).toEqual({
      state: 'confirmed',
      isSyncedToSoftpro: true,
      listingConfirmed: true,
      acceptSource: 'listed',
      retry: false,
    });
  });

  it('already-exists + listed names is still confirmed', () => {
    const result = classifyTitleDocAttach({
      writeSuccess: false,
      writeError: 'An item already exists by that name.',
      listed: true,
    });
    expect(result.state).toBe('confirmed');
    expect(result.listingConfirmed).toBe(true);
    expect(result.retry).toBe(false);
  });
});

describe('hub SoftPro sync copy', () => {
  it('uses the exact accepted-not-confirmed string', () => {
    expect(SOFTPRO_ACCEPTED_NOT_CONFIRMED_COPY).toBe('filed, listing not verifiable');
    expect(softProSyncLabel({
      isSyncedToSoftpro: true,
      softproListingConfirmed: false,
    })).toBe('filed, listing not verifiable');
  });

  it('keeps In SoftPro only when listing-confirmed', () => {
    expect(softProSyncLabel({
      isSyncedToSoftpro: true,
      softproListingConfirmed: true,
    })).toBe('In SoftPro');
    expect(softProSyncLabel({
      isSyncedToSoftpro: false,
      softproListingConfirmed: false,
    })).toBe('Not in SoftPro');
  });
});
