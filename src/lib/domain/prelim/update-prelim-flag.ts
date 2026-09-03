import { getSetting } from '@/lib/domain/settings/service';

export const UPDATE_PRELIM_ENABLED_SETTING = 'update_prelim_enabled';

/**
 * Kill switch for Update Prelim, default OFF.
 *
 * This writes a note, attaches a document and opens a task on a real SoftPro
 * file, and none of that can be deleted afterwards. It ships disabled and
 * stays disabled until staging on :8081 is proven and Gerard turns it on.
 *
 * Env backstop: UPDATE_PRELIM_ENABLED=false holds it off regardless of the DB
 * flag, so the feature can be stopped without a database round-trip.
 */
export async function isUpdatePrelimEnabled(): Promise<boolean> {
  if (process.env.UPDATE_PRELIM_ENABLED === 'false') return false;
  return (await getSetting(UPDATE_PRELIM_ENABLED_SETTING)) === 'true';
}
