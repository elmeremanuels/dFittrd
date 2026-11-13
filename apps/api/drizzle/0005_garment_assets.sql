CREATE TABLE "garment_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"qa" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base_size" text NOT NULL,
	"sizes" text[] DEFAULT '{}'::text[] NOT NULL,
	"bundle_path" text NOT NULL,
	"bytes" integer NOT NULL,
	"input_hash" text,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "active_asset_version" text;--> statement-breakpoint
ALTER TABLE "garment_assets" ADD CONSTRAINT "garment_assets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garment_assets" ADD CONSTRAINT "garment_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garment_assets_product_version_uq" ON "garment_assets" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "garment_assets_shop_idx" ON "garment_assets" USING btree ("shop_id");