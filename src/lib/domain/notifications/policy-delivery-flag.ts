import { getSetting } from '@/lib/domain/settings/service';

/**
 * Master switch for sending a title policy to a named person.
 *
 * Same shape as `tessa_prelim_enabled`: settings row, default OFF, flipped
 * from Admin → Settings with no redeploy. The feature emails a legal document
 * and has never sent from the hub, so merge must not turn it on.
 *
 * `notification_types.is_enabled` is NOT this switch. Production already maps
 * policy webhooks to the `policy.delivery` slug; enabling that type before
 * this sender is live would start emails from the old generic document path.
 */
export const POLICY_DELIVERY_ENABLED_SETTING = 'policy_delivery_enabled';

export async function isPolicyDeliveryEnabled(): Promise<boolean> {
  return (await getSetting(POLICY_DELIVERY_ENABLED_SETTING)) === 'true';
}

export function isPolicyDispatchEvent(
  eventType: string,
  data?: Record<string, unknown>,
): boolean {
  if (eventType === 'policy.delivery' || eventType === 'policy.delivery.unresolved') return true;
  if (eventType === 'order.document.received') {
    const cat = data?.category;
    return cat === 'policy' || cat === 'supplement';
  }
  return false;
}
