/**
 * SoftPro holds no email for a recipient a document must go to.
 *
 * Kept in its own dependency-free module so callers can recognise it with
 * `instanceof` even where the send module itself is mocked in tests.
 *
 * It is not a failure to send: by the pre-send rule we do not substitute our own
 * address for one SoftPro does not have, so the document is held on the
 * existing fail-closed path — unresolved, internal alert, no send.
 */
export class PreSendRecipientUnresolvedError extends Error {
  readonly role: string;

  constructor(role: string, fileNumber: string) {
    super(`SoftPro holds no ${role} email for ${fileNumber}, so the document was not sent. Our address was not used in its place.`);
    this.name = 'PreSendRecipientUnresolvedError';
    this.role = role;
  }
}
