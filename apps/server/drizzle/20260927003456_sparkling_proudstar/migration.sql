CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"conversation_id" uuid,
	"event" varchar(64) NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_detector" ADD COLUMN "max_chars" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" ("created_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL;