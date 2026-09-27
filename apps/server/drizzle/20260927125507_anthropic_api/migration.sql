CREATE TYPE "backend_api" AS ENUM('openai', 'anthropic');--> statement-breakpoint
ALTER TABLE "backends" ADD COLUMN "api" "backend_api" DEFAULT 'openai'::"backend_api" NOT NULL;