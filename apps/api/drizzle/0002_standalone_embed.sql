ALTER TABLE "try_sessions" ADD COLUMN "page_origin" text;--> statement-breakpoint
ALTER TABLE "try_sessions" ADD COLUMN "fit_shown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "try_sessions" ADD COLUMN "recommended_size" text;--> statement-breakpoint
ALTER TABLE "try_sessions" ADD COLUMN "fit_confidence" real;