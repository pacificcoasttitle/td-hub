ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "is_title_company" boolean DEFAULT false NOT NULL;

UPDATE "companies" AS c
SET
  "is_title_company" = true,
  "company_type" = 'title_company',
  "updated_at" = NOW()
WHERE EXISTS (
  SELECT 1
  FROM "orders" AS o
  WHERE o."title_company_id" = c."id"
)
  AND (c."company_type" IS NULL OR c."company_type" = 'title_company');
