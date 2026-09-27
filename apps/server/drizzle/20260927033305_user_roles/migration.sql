CREATE TYPE "user_role" AS ENUM('admin', 'override', 'no_check', 'review_chats', 'view_audit', 'manage_users', 'manage_backends', 'manage_settings');--> statement-breakpoint
ALTER TYPE "message_action" ADD VALUE 'overridden';--> statement-breakpoint
ALTER TYPE "message_action" ADD VALUE 'unchecked';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "roles" "user_role"[] DEFAULT '{}'::"user_role"[] NOT NULL;--> statement-breakpoint
-- existing admins keep full access
UPDATE "users" SET "roles" = '{admin}' WHERE "is_admin";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_admin";