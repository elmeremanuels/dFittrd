CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fit_signatures" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"vector" real[] NOT NULL,
	"quality" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"shop_id" uuid,
	"product_external_id" text,
	"kind" text NOT NULL,
	"payload_summary" jsonb NOT NULL,
	"inputs" text[],
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid,
	"order_id_hmac" text NOT NULL,
	"size" text,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairings" (
	"device_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"pseudonym" text NOT NULL,
	"source" text DEFAULT 'link' NOT NULL,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairings_device_id_shop_id_pk" PRIMARY KEY("device_id","shop_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"width" integer,
	"height" integer,
	"processed_url" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"payload" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"category" text,
	"price_eur" double precision,
	"primary_color_hex" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"missing_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"size" text NOT NULL,
	"tier" text DEFAULT 'heroOptIn' NOT NULL,
	"consent_acknowledged_at" timestamp with time zone NOT NULL,
	"video_seconds" integer,
	"provider" text,
	"model" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"person_path" text,
	"result_path" text,
	"video_path" text,
	"retention_hours" real DEFAULT 24 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"shop_domain" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"scope" text,
	"is_online" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"api_key_prefix" text,
	"api_key_hash" text,
	"api_key_enc" text,
	"previous_key_hash" text,
	"previous_key_enc" text,
	"previous_key_valid_until" timestamp with time zone,
	"plan" text DEFAULT 'free' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"billing_ref" text,
	"period_start" date,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connect_token_hash" text,
	"connect_token_expires_at" timestamp with time zone,
	"connect_state" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swipe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid,
	"item_id" text NOT NULL,
	"client_id" text NOT NULL,
	"action" text NOT NULL,
	"size_recommended" text,
	"fit_score" real,
	"reasons" text[],
	"deal_index" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "try_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_jti" text NOT NULL,
	"intent_token" text NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"device_id" uuid,
	"surface" text DEFAULT 'button' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"billed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"shop_id" uuid NOT NULL,
	"day" date NOT NULL,
	"fit_sessions" integer DEFAULT 0 NOT NULL,
	"hero_renders" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"pushed_at" timestamp with time zone,
	"pushed_sessions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_shop_id_day_pk" PRIMARY KEY("shop_id","day")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"device_id" uuid,
	"product_id" uuid,
	"kind" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wardrobe_items" (
	"device_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"size" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wardrobe_items_device_id_shop_id_product_id_pk" PRIMARY KEY("device_id","shop_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"shop_id" uuid,
	"shop_domain" text,
	"topic" text NOT NULL,
	"external_id" text,
	"event_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fit_signatures" ADD CONSTRAINT "fit_signatures_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_outcomes" ADD CONSTRAINT "order_outcomes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_outcomes" ADD CONSTRAINT "order_outcomes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_sessions" ADD CONSTRAINT "shopify_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_events" ADD CONSTRAINT "swipe_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_events" ADD CONSTRAINT "swipe_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_events" ADD CONSTRAINT "swipe_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_sessions" ADD CONSTRAINT "try_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_sessions" ADD CONSTRAINT "try_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_sessions" ADD CONSTRAINT "try_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wardrobe_items" ADD CONSTRAINT "wardrobe_items_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wardrobe_items" ADD CONSTRAINT "wardrobe_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_log" ADD CONSTRAINT "webhook_log_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_device_at_idx" ON "ledger_entries" USING btree ("device_id","at");--> statement-breakpoint
CREATE INDEX "ledger_shop_kind_idx" ON "ledger_entries" USING btree ("shop_id","kind","at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_outcomes_uq" ON "order_outcomes" USING btree ("shop_id","order_id_hmac","product_id");--> statement-breakpoint
CREATE INDEX "pairings_shop_pseudonym_idx" ON "pairings" USING btree ("shop_id","pseudonym");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_shop_external_uq" ON "products" USING btree ("shop_id","external_id");--> statement-breakpoint
CREATE INDEX "products_shop_status_idx" ON "products" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "products_payload_gin" ON "products" USING gin ("payload");--> statement-breakpoint
CREATE INDEX "render_jobs_device_idx" ON "render_jobs" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "render_jobs_expires_idx" ON "render_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_domain_uq" ON "shops" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_api_key_prefix_uq" ON "shops" USING btree ("api_key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "swipe_events_device_client_uq" ON "swipe_events" USING btree ("device_id","client_id");--> statement-breakpoint
CREATE INDEX "swipe_events_shop_at_idx" ON "swipe_events" USING btree ("shop_id","at");--> statement-breakpoint
CREATE INDEX "swipe_events_device_idx" ON "swipe_events" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "try_sessions_jti_uq" ON "try_sessions" USING btree ("token_jti");--> statement-breakpoint
CREATE UNIQUE INDEX "try_sessions_intent_uq" ON "try_sessions" USING btree ("intent_token");--> statement-breakpoint
CREATE INDEX "try_sessions_shop_created_idx" ON "try_sessions" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_idem_uq" ON "usage_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_events_shop_at_idx" ON "usage_events" USING btree ("shop_id","at");--> statement-breakpoint
CREATE INDEX "wardrobe_product_idx" ON "wardrobe_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_log_event_uq" ON "webhook_log" USING btree ("platform","event_id");--> statement-breakpoint
CREATE INDEX "webhook_log_shop_topic_idx" ON "webhook_log" USING btree ("shop_id","topic");