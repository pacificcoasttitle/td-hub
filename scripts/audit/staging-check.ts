/**
 * READ-ONLY separation check, per the standing rule: before anything is written
 * to :8081, prove it is not production by asking it for a known PRODUCTION
 * order and confirming it returns nothing.
 */
import { getOrderDetails } from '../../src/lib/integrations/softpro/client';
const PROD_ORDER = '20021378-GLT';
(async () => {
  for (const [label, url] of [['PROD :3000', 'http://100.29.181.61:3000/api/'], ['STAGING :8081', 'http://100.29.181.61:8081/api/']] as const) {
    process.env.SOFTPRO_API_URL = url;
    try {
      const d = await getOrderDetails({ dateFrom: '2026-08-24', dateTo: '2026-08-25', orderNumber: PROD_ORDER });
      const n = (d.success && Array.isArray(d.data)) ? d.data.length : -1;
      console.log(`${label.padEnd(14)} success=${d.success} records=${n} ${n > 0 ? '<-- RETURNS REAL DATA' : '<-- empty'}` +
        (d.success ? '' : ` err=${JSON.stringify(d.error)}`));
    } catch (e) {
      console.log(`${label.padEnd(14)} threw: ${(e as Error).message}`);
    }
  }
  console.log(`\nSOFTPRO_USER_ID present locally: ${process.env.SOFTPRO_USER_ID ? 'yes' : 'NO'}`);
  console.log(`SOFTPRO_TOKEN present locally:   ${process.env.SOFTPRO_TOKEN ? 'yes' : 'NO'}`);
  process.exit(0);
})();
