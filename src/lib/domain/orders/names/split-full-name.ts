// ─── splitFullName — Order.php:6332-6350 ────────────────────────────────────
//
// Runs on BOTH paths. It takes a name that is ALREADY in natural order
// (first ... last) and never reorders anything. That is the whole contract, and
// it is why the SiteX flip lives in a different module: this function must be
// safe to call on something a human typed.
//
//   $nameParts  = preg_split('/\s+/', trim($fullName));
//   $firstName  = $nameParts[0] ?? '';
//   $lastName   = $nameParts[count($nameParts) - 1] ?? '';
//   $middleName = count($nameParts) > 2 ? implode(' ', array_slice($nameParts, 1, -1)) : '';
//
// Suffixes land in the middle name — "Sergio Jr Sanchez" gives middle "Jr".
// That is legacy's behaviour and it is matched deliberately; legacy has no
// suffix handling at all and inventing some here was explicitly not sanctioned.

export interface PersonName {
  firstName: string;
  middleName: string;
  lastName: string;
}

export interface SplitResult extends PersonName {
  /**
   * The input was a single token, so there is no way to know whether it is a
   * given name or a surname. See the note on the single-token case below.
   */
  singleToken: boolean;
}

export function splitFullName(fullName: string): SplitResult {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', middleName: '', lastName: '', singleToken: false };
  }

  // SINGLE TOKEN — a deliberate departure from legacy.
  //
  // Legacy's arithmetic makes parts[0] and parts[len-1] the same token, so
  // "SMITH" comes out first="Smith" last="Smith" and the order carries a
  // person named Smith Smith. Duplicating a token into two name fields
  // fabricates a given name that was never in the data.
  //
  // A lone token on a title order is a surname (or a company that lost its
  // suffix). It goes to lastName, firstName stays empty, and singleToken says
  // so, so a caller can flag it rather than print it.
  if (parts.length === 1) {
    return { firstName: '', middleName: '', lastName: parts[0]!, singleToken: true };
  }

  return {
    firstName: parts[0]!,
    lastName: parts[parts.length - 1]!,
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    singleToken: false,
  };
}
