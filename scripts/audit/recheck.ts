/** READ-ONLY. Re-read the two orders created yesterday and show what changed. */
import { getOrderDetails } from '../../src/lib/integrations/softpro/client';
(async () => {
  for (const [on, day] of [['20021376-OCT','2026-08-24'],['20021378-GLT','2026-08-24'],['20021382-OCT','2026-08-24']] as const) {
    for (const range of [[day,day],[day,'2026-08-25']] as const) {
      const d = await getOrderDetails({ dateFrom: range[0], dateTo: range[1], orderNumber: on });
      const r = (d.success && Array.isArray(d.data) ? d.data[0] : null) as Record<string,unknown>|null;
      console.log(`${on}  range ${range[0]}..${range[1]}  ` +
        (r ? `Address="${r.Address}"  City="${r.City}"  Received=${r.ReceivedDate}  Modified=${r.ModifiedDate}` : 'no record'));
    }
  }
  process.exit(0);
})();
