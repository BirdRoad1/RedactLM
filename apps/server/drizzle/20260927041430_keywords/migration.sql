ALTER TYPE "user_role" ADD VALUE 'manage_keywords';--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "keywords_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"keyword" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_keyword_idx" ON "keywords" ("keyword");--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;