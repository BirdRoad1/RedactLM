CREATE TYPE "block_mode" AS ENUM('block', 'replace');--> statement-breakpoint
ALTER TYPE "detection_outcome" ADD VALUE 'redacted' BEFORE 'blocked';--> statement-breakpoint
ALTER TABLE "detection_policy" ADD COLUMN "mode" "block_mode" DEFAULT 'block'::"block_mode" NOT NULL;