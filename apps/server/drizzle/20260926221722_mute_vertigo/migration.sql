CREATE TYPE "detector_fail_mode" AS ENUM('block', 'allow');--> statement-breakpoint
CREATE TABLE "llm_detector" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"enabled" boolean DEFAULT false NOT NULL,
	"backend_id" integer,
	"model" text,
	"fail_mode" "detector_fail_mode" DEFAULT 'block'::"detector_fail_mode" NOT NULL,
	"min_confidence" real DEFAULT 0.5 NOT NULL,
	"timeout_ms" integer DEFAULT 15000 NOT NULL,
	"instructions" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_detector_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
ALTER TABLE "llm_detector" ADD CONSTRAINT "llm_detector_backend_id_backends_id_fkey" FOREIGN KEY ("backend_id") REFERENCES "backends"("id") ON DELETE SET NULL;