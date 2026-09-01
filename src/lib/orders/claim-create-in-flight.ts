/**
 * Exclusive claim for one create-submit. React `submitting` is too late —
 * a second click can fire before the re-render, and that second fetch
 * creates a duplicate in SoftPro and the hub.
 *
 * The ref is the source of truth; the button's disabled attribute is not.
 * Caller must release in `finally` after `/api/orders/create` (or the
 * client create route) settles — that request includes the post-abort
 * SoftPro lookup. `foundDoNotReenter` / lookup-failed then keep Create
 * locked via `submitLocked`; this flag only covers the in-flight window.
 */
export function claimCreateInFlight(inFlight: { current: boolean }): boolean {
  if (inFlight.current) return false;
  inFlight.current = true;
  return true;
}

export function releaseCreateInFlight(inFlight: { current: boolean }): void {
  inFlight.current = false;
}
