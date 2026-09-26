ALTER TABLE "backends" DROP CONSTRAINT "backends_name_key";--> statement-breakpoint
ALTER TABLE "backends" ADD COLUMN "slug" varchar(64) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "backends_slug_idx" ON "backends" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "backends_single_default_idx" ON "backends" ("is_default") WHERE "is_default";