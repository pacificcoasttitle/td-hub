CREATE INDEX "order_status_history_changed_at_idx" ON "order_status_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "doc_audit_performed_at_idx" ON "document_audit" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "title_point_data_order_idx" ON "title_point_data" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "title_point_data_created_at_idx" ON "title_point_data" USING btree ("created_at");