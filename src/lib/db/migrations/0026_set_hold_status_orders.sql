-- FLAG: apply manually to prod AFTER 0025.
-- Corrects the 8 SoftPro Hold orders that were silently mapped to operational_status='open'.
UPDATE "orders"
SET
  "operational_status" = 'hold',
  "updated_at" = NOW()
WHERE "id" IN (81, 212, 558, 2359, 3660, 4181, 4853, 5778)
  AND "softpro_status" = 'hold';
