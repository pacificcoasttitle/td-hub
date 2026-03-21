ALTER TABLE "title_point_data" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "title_point_data" ALTER COLUMN "file_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "title_point_data" ADD COLUMN "session_id" varchar(100);--> statement-breakpoint
CREATE INDEX "title_point_data_session_idx" ON "title_point_data" USING btree ("session_id");