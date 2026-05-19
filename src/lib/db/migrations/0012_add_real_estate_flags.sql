ALTER TABLE "contacts" ADD COLUMN "is_real_estate_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_real_estate_company" boolean DEFAULT false NOT NULL;
