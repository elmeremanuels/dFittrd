CREATE TABLE "billing_anomalies" (
	"shop_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"billed_sessions" integer DEFAULT 0 NOT NULL,
	"denied_sessions" integer DEFAULT 0 NOT NULL,
	"threshold" integer DEFAULT 0 NOT NULL,
	"trailing_average" real DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_anomalies_shop_id_day_kind_pk" PRIMARY KEY("shop_id","day","kind")
);
--> statement-breakpoint
ALTER TABLE "billing_anomalies" ADD CONSTRAINT "billing_anomalies_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
