import { getSetting } from '@/lib/domain/settings/service';

/**
 * The one switch for putting a buyer's agent on a client-facing email.
 *
 * Two paths can do it and they resolve recipients differently.
 * `order.confirmation` builds its own TO/CC line in `order-confirmation.ts`;
 * `order.closed` — and every other `notification_types`-driven send — resolves
 * through `resolveRecipients` reading `recipient_roles`. Both read this
 * constant, because two settings for one decision is how the two paths drift
 * apart and one of them ends up ungated.
 *
 * Registered in SETTINGS_REGISTRY with defaultValue 'false', so a missing row
 * reads as off. See docs/tickets/SOFTPRO_MISSING_BUYER.md §4 for why: mapping
 * SoftPro's `BuyersAgentBrokers` started producing `buyer_agent` rows for a
 * role that had none for the table's entire history, and a vendor-type
 * addition must not be what decides that the opposite side's agent starts
 * receiving PCT's client-facing mail.
 */
export const BUYER_AGENT_RECIPIENT_SETTING = 'confirmation_buyer_agent_recipient_enabled';

export async function isBuyerAgentRecipientEnabled(): Promise<boolean> {
  return (await getSetting(BUYER_AGENT_RECIPIENT_SETTING)) === 'true';
}
