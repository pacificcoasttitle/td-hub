ALTER TYPE "public"."profile_role" ADD VALUE 'sales_manager' BEFORE 'sales_rep';--> statement-breakpoint
ALTER TYPE "public"."profile_role" ADD VALUE 'title_production' BEFORE 'client';--> statement-breakpoint
CREATE TABLE "order_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"subject" varchar(255),
	"body" text NOT NULL,
	"author_name" varchar(255),
	"author_id" varchar(64),
	"is_synced_to_softpro" boolean DEFAULT false NOT NULL,
	"softpro_note_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_production_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" varchar(100) NOT NULL,
	"document_name" varchar(255) NOT NULL,
	"filename" varchar(500) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"public_url" text,
	"uploaded_by" varchar(64),
	"is_synced" boolean DEFAULT false NOT NULL,
	"sync_reason" text,
	"vendor_log_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"order_id" integer,
	"channel" varchar(20) NOT NULL,
	"recipient_email" varchar(255),
	"recipient_phone" varchar(50),
	"recipient_name" varchar(255),
	"recipient_role" varchar(100),
	"subject" varchar(500),
	"template_used" varchar(100),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"provider" varchar(50),
	"provider_id" varchar(255),
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notification_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"channels" text[] DEFAULT '{"{email}"}' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"recipient_roles" text[],
	"internal_cc" text[],
	"template_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prelim_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"document_id" integer,
	"file_number" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"triggered_by" varchar(20) NOT NULL,
	"pdf_text" text,
	"pdf_char_count" integer,
	"facts_json" jsonb,
	"extraction_json" jsonb,
	"summary_text" text,
	"complexity_score" integer,
	"complexity_level" varchar(20),
	"complexity_reasons" text[],
	"requirement_count" integer DEFAULT 0,
	"blocker_count" integer DEFAULT 0,
	"lien_count" integer DEFAULT 0,
	"tax_count" integer DEFAULT 0,
	"tax_default_count" integer DEFAULT 0,
	"other_finding_count" integer DEFAULT 0,
	"foreclosure_detected" boolean DEFAULT false NOT NULL,
	"extraction_model" varchar(100),
	"summary_model" varchar(100),
	"error_message" text,
	"error_step" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "manager_id" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "notify_recording_confirm" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "notify_disburse_funds" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "lender_policy_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "owner_policy_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "supplement_statement_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "recording_confirmation_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_production_uploads" ADD CONSTRAINT "title_production_uploads_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prelim_analyses" ADD CONSTRAINT "prelim_analyses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prelim_analyses" ADD CONSTRAINT "prelim_analyses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_order_idx" ON "order_notes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "title_production_uploads_order_idx" ON "title_production_uploads" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "notification_logs_order_idx" ON "notification_logs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notification_logs_type_idx" ON "notification_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "notification_logs_status_idx" ON "notification_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_types_slug_idx" ON "notification_types" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "prelim_analyses_order_idx" ON "prelim_analyses" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "prelim_analyses_document_idx" ON "prelim_analyses" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "prelim_analyses_status_idx" ON "prelim_analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_manager_idx" ON "contacts" USING btree ("manager_id");