CREATE TYPE "public"."contact_type" AS ENUM('person', 'officer', 'company_contact');--> statement-breakpoint
CREATE TYPE "public"."profile_role" AS ENUM('super_admin', 'admin', 'cs_admin', 'sales_rep', 'title_officer', 'escrow_officer', 'client');--> statement-breakpoint
CREATE TYPE "public"."operational_status" AS ENUM('open', 'in_process', 'completed', 'closed', 'canceled', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('softpro_sync', 'manual_entry', 'web_form');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('buyer', 'seller', 'buyer_agent', 'listing_agent', 'lender', 'lender_contact', 'escrow_company', 'borrower', 'other');--> statement-breakpoint
CREATE TYPE "public"."status_change_source" AS ENUM('softpro_sync', 'manual', 'system', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('Purchase', 'Refinance', 'Equity', 'Other');--> statement-breakpoint
CREATE TYPE "public"."vendor_system" AS ENUM('softpro', 'titlepoint', 'westcor', 'fnf', 'natic', 'doma', 'black_knight');--> statement-breakpoint
CREATE TYPE "public"."doc_action" AS ENUM('uploaded', 'downloaded', 'viewed', 'deleted', 'attached_to_softpro', 'attach_failed', 'generated');--> statement-breakpoint
CREATE TYPE "public"."doc_category" AS ENUM('cpl', 'prelim', 'policy', 'legal_vesting', 'grant_deed', 'tax', 'general', 'user_upload', 'proposed_insured', 'curative');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('active', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."underwriter" AS ENUM('westcor', 'fnf', 'natic', 'doma');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'retrying');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"address" text,
	"city" varchar(100),
	"state" varchar(10) DEFAULT 'CA',
	"zip" varchar(20),
	"phone" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_system" varchar(50) DEFAULT 'softpro',
	"source_id" varchar(100),
	"name" varchar(200) NOT NULL,
	"company_type" varchar(100),
	"lookup_code" varchar(100),
	"address1" varchar(200),
	"address2" varchar(200),
	"city" varchar(100),
	"state" varchar(10),
	"zip" varchar(20),
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(200),
	"assignment_clause" text,
	"payee_name" varchar(200),
	"signature_line" text,
	"fee_transfer_ledger" varchar(200),
	"branch_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_company_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"relationship_type" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_system" varchar(50) DEFAULT 'softpro',
	"source_id" varchar(100),
	"type" "contact_type" DEFAULT 'person' NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"full_name" varchar(200),
	"company_name" varchar(200),
	"officer_name" varchar(200),
	"email" varchar(200),
	"phone" varchar(50),
	"cell" varchar(50),
	"fax" varchar(50),
	"address1" varchar(200),
	"address2" varchar(200),
	"city" varchar(100),
	"state" varchar(10),
	"zip" varchar(20),
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignment_clause" text,
	"license_no" varchar(50),
	"softpro_lookup_code" varchar(100),
	"softpro_flookup_code" varchar(100),
	"softpro_user_type" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(200),
	"email" varchar(200),
	"role" "profile_role" DEFAULT 'client' NOT NULL,
	"branch_id" integer,
	"contact_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_external_refs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"system" "vendor_system" NOT NULL,
	"ref_type" varchar(50) NOT NULL,
	"ref_value" varchar(200) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"role" "party_role" NOT NULL,
	"contact_id" integer,
	"external_name" varchar(200),
	"external_company" varchar(200),
	"external_email" varchar(200),
	"external_phone" varchar(50),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"full_address" text,
	"address" varchar(500),
	"city" varchar(100),
	"state" varchar(10) DEFAULT 'CA',
	"zip" varchar(20),
	"county" varchar(100),
	"apn" varchar(50),
	"legal_description" text,
	"property_type" varchar(50),
	"cpl_address" varchar(500),
	"cpl_city" varchar(100),
	"cpl_state" varchar(10),
	"cpl_zip" varchar(20),
	"primary_owner" text,
	"secondary_owner" text,
	"borrowers_vesting" text,
	"fips" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_properties_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"status" varchar(50) NOT NULL,
	"source" "status_change_source" NOT NULL,
	"notes" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_number" varchar(50) NOT NULL,
	"branch_id" integer,
	"operational_status" "operational_status" DEFAULT 'open' NOT NULL,
	"softpro_status" varchar(50),
	"transaction_type" "transaction_type",
	"product_type" varchar(100),
	"order_type" varchar(100),
	"source" "order_source" DEFAULT 'softpro_sync' NOT NULL,
	"sales_rep_id" integer,
	"title_officer_id" integer,
	"escrow_officer_id" integer,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"closed_at" timestamp,
	"sales_price" numeric(12, 2),
	"loan_amount" numeric(12, 2),
	"softpro_last_synced_at" timestamp,
	"is_imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"action" "doc_action" NOT NULL,
	"by_user_id" varchar(64),
	"meta" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"category" "doc_category" DEFAULT 'general' NOT NULL,
	"filename" varchar(500) NOT NULL,
	"original_filename" varchar(500),
	"storage_provider" varchar(20) DEFAULT 's3' NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"content_type" varchar(100) DEFAULT 'application/pdf',
	"size_bytes" bigint,
	"checksum" varchar(64),
	"status" "doc_status" DEFAULT 'active' NOT NULL,
	"description" text,
	"is_synced_to_softpro" boolean DEFAULT false NOT NULL,
	"softpro_synced_at" timestamp,
	"softpro_sync_error" text,
	"created_by" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpl_branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"underwriter" "underwriter" NOT NULL,
	"branch_code" varchar(100),
	"branch_name" varchar(200),
	"agency_name" varchar(200),
	"address" varchar(200),
	"city" varchar(100),
	"state" varchar(10) DEFAULT 'CA',
	"zip" varchar(20),
	"phone" varchar(50),
	"underwriter_code" varchar(50),
	"is_proposed_branch" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpl_error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"file_number" varchar(50),
	"underwriter" varchar(50),
	"error" text NOT NULL,
	"context" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_point_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"file_number" varchar(50) NOT NULL,
	"request_id" varchar(100),
	"service_id" varchar(100),
	"search_type" varchar(50),
	"status" varchar(50),
	"message" text,
	"fips" varchar(20),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_api_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" varchar(50) NOT NULL,
	"operation" varchar(100) NOT NULL,
	"order_id" integer,
	"request_id" varchar(100),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"success" boolean,
	"retryable" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"error_category" varchar(50),
	"request_meta" jsonb,
	"response_meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" varchar(50) NOT NULL,
	"token_type" varchar(50) NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"order_id" integer,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"fail_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" varchar(100) NOT NULL,
	"order_id" integer,
	"payload" jsonb,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" varchar(100),
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"subject" text,
	"body" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_links" ADD CONSTRAINT "contact_company_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_links" ADD CONSTRAINT "contact_company_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_external_refs" ADD CONSTRAINT "order_external_refs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_parties" ADD CONSTRAINT "order_parties_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_parties" ADD CONSTRAINT "order_parties_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_properties" ADD CONSTRAINT "order_properties_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_rep_id_contacts_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_title_officer_id_contacts_id_fk" FOREIGN KEY ("title_officer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_escrow_officer_id_contacts_id_fk" FOREIGN KEY ("escrow_officer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit" ADD CONSTRAINT "document_audit_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_lookup_code_idx" ON "companies" USING btree ("lookup_code");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ccl_contact_company_idx" ON "contact_company_links" USING btree ("contact_id","company_id");--> statement-breakpoint
CREATE INDEX "contacts_lookup_code_idx" ON "contacts" USING btree ("softpro_lookup_code");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_full_name_idx" ON "contacts" USING btree ("full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_unique_idx" ON "order_external_refs" USING btree ("order_id","system","ref_type");--> statement-breakpoint
CREATE INDEX "order_parties_order_role_idx" ON "order_parties" USING btree ("order_id","role");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_file_number_idx" ON "orders" USING btree ("file_number");--> statement-breakpoint
CREATE INDEX "orders_branch_id_idx" ON "orders" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("operational_status");--> statement-breakpoint
CREATE INDEX "orders_opened_at_idx" ON "orders" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "orders_sales_rep_idx" ON "orders" USING btree ("sales_rep_id");--> statement-breakpoint
CREATE INDEX "orders_title_officer_idx" ON "orders" USING btree ("title_officer_id");--> statement-breakpoint
CREATE INDEX "doc_audit_document_idx" ON "document_audit" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_order_id_idx" ON "documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "documents_category_idx" ON "documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "cpl_branches_uw_city_idx" ON "cpl_branches" USING btree ("underwriter","city");--> statement-breakpoint
CREATE INDEX "vendor_logs_vendor_idx" ON "vendor_api_logs" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "vendor_logs_order_idx" ON "vendor_api_logs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "vendor_logs_created_idx" ON "vendor_api_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "event_outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_type_idx" ON "jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "jobs_retry_idx" ON "jobs" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "admin_logs_user_idx" ON "admin_activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_logs_created_idx" ON "admin_activity_logs" USING btree ("created_at");