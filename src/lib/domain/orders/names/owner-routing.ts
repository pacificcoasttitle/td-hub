// ─── Where do SiteX record-owner names go, and who can see them? ────────────
//
// These two questions have to be answered by the SAME function, and this is the
// bug that proved it.
//
// The routing followed legacy — Purchase puts the record owners in the seller
// and the operator keys the buyer; anything else overwrites the borrower — but
// the form decided visibility separately, rendering owner fields only for
// Purchase, Refinance and Equity. On transaction type "Other", and on a type
// not yet chosen, the two disagreed: names were written to the borrower and
// then never shown.
//
// Before the routing fix those names were silently discarded. After it they
// were silently SENT — a legal name on a title order that the operator never
// saw. That is strictly worse, and it is why routing and visibility now come
// from one place.

/** Which party the SiteX record owners populate. */
export type OwnerTarget = 'seller' | 'borrower';

/**
 * Legacy: on a Purchase the people on record are the SELLERS, and the buyer is
 * whoever the operator keys. On anything else — refinance, equity, other, or a
 * type not chosen yet — the people on record ARE the borrower.
 */
export function ownerTarget(txType: string | null | undefined): OwnerTarget {
  return (txType ?? '').trim() === 'Purchase' ? 'seller' : 'borrower';
}

/** Seller fields are shown exactly when the owners land there. */
export function showsSellerFields(txType: string | null | undefined): boolean {
  return ownerTarget(txType) === 'seller';
}

/**
 * Borrower/buyer fields are shown for EVERY transaction type, including "Other"
 * and unset.
 *
 * On a Purchase this is the buyer the operator types. On everything else it is
 * where the SiteX owners land — so if it were ever hidden, a name would go to
 * SoftPro unseen. There is deliberately no transaction type for which this
 * returns false.
 */
export function showsBorrowerFields(txType: string | null | undefined): boolean {
  void txType; // deliberately unused — no transaction type makes this false
  return true;
}

/** The heading, which also tells the operator where the value came from. */
export function borrowerSectionLabel(txType: string | null | undefined): string {
  return ownerTarget(txType) === 'seller' ? 'Buyer' : 'Borrower (from property records)';
}

export function borrowerNoun(txType: string | null | undefined): string {
  return ownerTarget(txType) === 'seller' ? 'buyer' : 'borrower';
}
