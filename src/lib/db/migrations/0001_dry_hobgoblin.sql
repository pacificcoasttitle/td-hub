CREATE TYPE "public"."doc_request_status" AS ENUM('pending', 'fulfilled', 'canceled');--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"request_type" varchar(100) NOT NULL,
	"message" text,
	"status" "doc_request_status" DEFAULT 'pending' NOT NULL,
	"fulfilled_document_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_fulfilled_document_id_documents_id_fk" FOREIGN KEY ("fulfilled_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_requests_order_idx" ON "document_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "doc_requests_status_idx" ON "document_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "doc_requests_user_idx" ON "document_requests" USING btree ("requested_by");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_roles_idx" ON "contacts" USING gin ("roles");