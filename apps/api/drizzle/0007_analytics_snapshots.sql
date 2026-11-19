CREATE TABLE "analytics_snapshots" (
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"period" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_snapshots_shop_id_kind_scope_period_pk" PRIMARY KEY("shop_id","kind","scope","period")
);
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_snapshots_kind_scope_idx" ON "analytics_snapshots" USING btree ("kind","scope");