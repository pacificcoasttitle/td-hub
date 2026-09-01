import { softProAlreadyExistsByName } from './softpro-attach-retry';

/** Exact hub copy for write-accepted files GetAttachedDocuments cannot list. */
export const SOFTPRO_ACCEPTED_NOT_CONFIRMED_COPY = 'filed, listing not verifiable';

export type SoftProAttachVerifyState = 'accepted' | 'confirmed' | 'failed';

/** How we came to believe the file is in SoftPro. already_exists > add_documents_200. */
export type SoftProAcceptSource = 'listed' | 'already_exists' | 'add_documents_200';

export interface ClassifyTitleDocAttachInput {
  writeSuccess: boolean;
  writeError: string | null;
  /** This sent name appears on a listing we trust. */
  listed: boolean;
}

export interface ClassifyTitleDocAttachResult {
  state: SoftProAttachVerifyState;
  isSyncedToSoftpro: boolean;
  listingConfirmed: boolean;
  acceptSource: SoftProAcceptSource | null;
  retry: boolean;
}

/**
 * Split write-accepted from listing-confirmed.
 *
 * accepted  = AddDocuments 200 OR "already exists by that name", and the name
 *             is not on GetAttachedDocuments. Empty list is not failure.
 * confirmed = the sent name appears on the listing.
 * failed    = a real reject (address required, locked, HMAC, …).
 *
 * already-exists is higher confidence than a bare 200: SoftPro's write API
 * is confirming the name is already filed.
 */
export function classifyTitleDocAttach(
  input: ClassifyTitleDocAttachInput,
): ClassifyTitleDocAttachResult {
  const alreadyExists = softProAlreadyExistsByName(input.writeError ?? '');
  const writeAccepted = input.writeSuccess || alreadyExists;

  if (writeAccepted && input.listed) {
    return {
      state: 'confirmed',
      isSyncedToSoftpro: true,
      listingConfirmed: true,
      acceptSource: 'listed',
      retry: false,
    };
  }

  if (writeAccepted) {
    return {
      state: 'accepted',
      isSyncedToSoftpro: true,
      listingConfirmed: false,
      acceptSource: alreadyExists ? 'already_exists' : 'add_documents_200',
      retry: false,
    };
  }

  return {
    state: 'failed',
    isSyncedToSoftpro: false,
    listingConfirmed: false,
    acceptSource: null,
    retry: true,
  };
}

export function softProSyncDisplay(doc: {
  isSyncedToSoftpro?: boolean | null;
  softproListingConfirmed?: boolean | null;
}): 'not_in_softpro' | 'confirmed' | 'accepted' {
  if (!doc.isSyncedToSoftpro) return 'not_in_softpro';
  if (doc.softproListingConfirmed) return 'confirmed';
  return 'accepted';
}

export function softProSyncLabel(doc: {
  isSyncedToSoftpro?: boolean | null;
  softproListingConfirmed?: boolean | null;
}): string {
  const display = softProSyncDisplay(doc);
  if (display === 'not_in_softpro') return 'Not in SoftPro';
  if (display === 'confirmed') return 'In SoftPro';
  return SOFTPRO_ACCEPTED_NOT_CONFIRMED_COPY;
}
