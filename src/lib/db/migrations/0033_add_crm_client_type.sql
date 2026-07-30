-- 0033 — Add crm_clients.type (client classification).
--
-- Nullable business-source classification for a rep's client:
--   agent | lender | escrow | title | other
-- NULL is a valid state (unclassified). Derived automatically from transaction
-- party roles where known; the rep can always set or change it by hand.
--
-- Plain varchar + CHECK rather than a pg enum, so drizzle-kit's generate flow
-- and the migration journal are untouched. The application additionally
-- validates with a Zod union (CRM_CLIENT_TYPES in src/lib/domain/crm/types.ts).
--
-- Idempotent: safe to run more than once.
--
-- APPLY: hand-applied to production BEFORE the code that writes this column
--        deploys (migrations do not run automatically).
--
-- Reversible:
--   ALTER TABLE public.crm_clients DROP CONSTRAINT IF EXISTS crm_clients_type_check;
--   ALTER TABLE public.crm_clients DROP COLUMN IF EXISTS type;

ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS type varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_clients_type_check'
      AND conrelid = 'public.crm_clients'::regclass
  ) THEN
    ALTER TABLE public.crm_clients
      ADD CONSTRAINT crm_clients_type_check
      CHECK (type IS NULL OR type IN ('agent', 'lender', 'escrow', 'title', 'other'));
  END IF;
END $$;

-- Supports the server-side type filter, scoped per owner.
CREATE INDEX IF NOT EXISTS crm_clients_owner_type_idx
  ON public.crm_clients (owner_profile_id, type);
