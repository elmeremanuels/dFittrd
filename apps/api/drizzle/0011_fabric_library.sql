CREATE TABLE "fabric_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fabric" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fabric_library" ADD CONSTRAINT "fabric_library_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fabric_library_shop_name_uq" ON "fabric_library" USING btree ("shop_id","name");--> statement-breakpoint
CREATE INDEX "fabric_library_shop_idx" ON "fabric_library" USING btree ("shop_id");
