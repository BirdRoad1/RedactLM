CREATE TYPE "detection_outcome" AS ENUM('ignored', 'warned', 'blocked');--> statement-breakpoint
ALTER TYPE "message_action" ADD VALUE 'warned' BEFORE 'redacted';--> statement-breakpoint
CREATE TABLE "checker_policies" (
	"checker" varchar(64) PRIMARY KEY,
	"warn_at" real,
	"block_at" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detection_policy" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"warn_at" real DEFAULT 0.3,
	"block_at" real DEFAULT 0.5,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_policy_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "message_detections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "message_detections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"checker" varchar(64) NOT NULL,
	"user_facing_reason" text NOT NULL,
	"confidence" real NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"outcome" "detection_outcome" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_detector" DROP COLUMN "min_confidence";--> statement-breakpoint
CREATE INDEX "message_detections_message_idx" ON "message_detections" ("message_id");--> statement-breakpoint
ALTER TABLE "message_detections" ADD CONSTRAINT "message_detections_message_id_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;