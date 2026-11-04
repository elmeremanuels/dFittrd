ALTER TABLE "shops" ADD COLUMN "api_key_lookup" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "previous_key_lookup" text;--> statement-breakpoint
CREATE INDEX "shops_api_key_lookup_idx" ON "shops" USING btree ("api_key_lookup");--> statement-breakpoint
CREATE INDEX "shops_previous_key_lookup_idx" ON "shops" USING btree ("previous_key_lookup");