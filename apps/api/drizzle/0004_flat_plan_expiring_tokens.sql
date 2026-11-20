ALTER TABLE "shopify_sessions" ADD COLUMN "refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "shopify_sessions" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopify_sessions" ADD COLUMN "refreshed_at" timestamp with time zone;--> statement-breakpoint
-- D17: one flat plan. The retired paid plans become `curtain`; the old value is kept in
-- settings.legacyPlan so the admin can ask those shops to approve the new subscription. Any value
-- that is neither a known plan nor `free` (none expected) becomes `free` so the CHECK can be added.
-- Per-session billing is gone: the overage override and the usage line id are dropped from settings
-- (the nightly rollup then has nothing to push). Fair-use `includedSessions` overrides are kept.
UPDATE "shops" SET "plan" = 'curtain', "settings" = "settings" || jsonb_build_object('legacyPlan', "plan") WHERE "plan" IN ('starter', 'pro');--> statement-breakpoint
UPDATE "shops" SET "plan" = 'free', "settings" = "settings" || jsonb_build_object('legacyPlan', "plan") WHERE "plan" NOT IN ('free', 'curtain');--> statement-breakpoint
UPDATE "shops" SET "settings" = ("settings" - 'overageEurPerSession') - 'usageLineItemId' WHERE "settings" ? 'overageEurPerSession' OR "settings" ? 'usageLineItemId';--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_plan_check" CHECK ("shops"."plan" in ('free', 'curtain'));