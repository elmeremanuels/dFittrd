CREATE TABLE "console_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "console_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "console_links" ADD CONSTRAINT "console_links_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "console_links_token_hash_uq" ON "console_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "console_links_shop_created_idx" ON "console_links" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "console_sessions_token_hash_uq" ON "console_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "console_sessions_shop_idx" ON "console_sessions" USING btree ("shop_id");