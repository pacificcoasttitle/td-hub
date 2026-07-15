CREATE TABLE IF NOT EXISTS "officer_cc_defaults" (
  "id" serial PRIMARY KEY,
  "officer_contact_id" integer NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "cc_name" varchar(200),
  "cc_email" varchar(200) NOT NULL,
  "cc_label" varchar(100),
  "created_by" varchar(64) REFERENCES "profiles"("id"),
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "officer_cc_defaults_officer_idx"
  ON "officer_cc_defaults" ("officer_contact_id");
