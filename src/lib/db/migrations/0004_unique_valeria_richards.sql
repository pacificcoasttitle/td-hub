ALTER TABLE "companies" ADD COLUMN "state_of_incorporation" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "marketing_rep" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "special_instructions" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_address1" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_address2" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_city" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_state" varchar(10);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_zip" varchar(20);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_fax" varchar(50);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "home_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "represents" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "license_no" varchar(50);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sales_rep_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "title_officer_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "loan_underwriter" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sales_underwriter" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_escrow_company" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_lender" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_mortgage_broker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_selling_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_underwriter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lookup_code" varchar(100);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "flookup_code" varchar(100);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "courtesy_title" varchar(50);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "middle_name" varchar(100);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "suffix" varchar(50);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "title" varchar(100);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "closer_examiner" varchar(200);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "office_lookup_code" varchar(100);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "phone_ext" varchar(20);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "pager" varchar(50);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "gender_id" varchar(10);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "user_type" varchar(50);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_escrow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_escrow_officer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_lender" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_mortgage_broker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_selling_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_title_officer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_sales_rep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_underwriter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_new_user" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_mail_notification" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "lender_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "listing_agent_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "title_company_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "underwriter_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "marketing_source" varchar(200);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dup_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "email_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by" varchar(64);--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_sales_rep_id_contacts_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_title_officer_id_contacts_id_fk" FOREIGN KEY ("title_officer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lender_id_contacts_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_agent_id_contacts_id_fk" FOREIGN KEY ("listing_agent_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_title_company_id_companies_id_fk" FOREIGN KEY ("title_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_underwriter_id_companies_id_fk" FOREIGN KEY ("underwriter_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_lookup_code_new_idx" ON "contacts" USING btree ("lookup_code");--> statement-breakpoint
CREATE INDEX "contacts_flookup_code_idx" ON "contacts" USING btree ("flookup_code");--> statement-breakpoint
CREATE INDEX "contacts_closer_examiner_idx" ON "contacts" USING btree ("closer_examiner");