ALTER TABLE "products" ADD COLUMN "held_back" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "incomplete_product_data" text DEFAULT 'let-through' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_incomplete_product_data_check" CHECK ("shops"."incomplete_product_data" in ('let-through', 'hold-back'));