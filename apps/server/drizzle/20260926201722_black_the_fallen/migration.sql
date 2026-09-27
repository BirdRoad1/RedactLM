DROP INDEX "messages_history_hash_idx";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "history_hash";