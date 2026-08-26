-- 0034 — Add orders.loan_number and orders.escrow_number.
--
-- Both values are typed by the operator on the open-order form and sent to
-- SoftPro as transactionDetails.LoanNumber / EscrowNumber. Neither had anywhere
-- to live locally, so the confirmation email's "Loan number" row has rendered
-- an em dash on every confirmation ever sent, regardless of what was entered.
--
-- Persisted at create rather than read back from SoftPro on purpose: the
-- confirmation is queued from the create path and sends before any sync runs,
-- so a read-back would reproduce the exact bug it was meant to fix.
--
-- Nullable and additive — no backfill. Orders created before this ships keep
-- NULL, which renders as the same em dash they render today.
--
-- Idempotent: safe to run more than once.
--
-- APPLY: hand-applied to production BEFORE the code that writes these columns
--        deploys (migrations do not run automatically).
--
-- Reversible:
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS loan_number;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS escrow_number;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS loan_number varchar(100);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS escrow_number varchar(100);
