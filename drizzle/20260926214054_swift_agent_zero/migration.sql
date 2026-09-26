CREATE TYPE "backend_trust" AS ENUM('local', 'cloud');--> statement-breakpoint
CREATE TABLE "backends" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backends_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL UNIQUE,
	"base_url" text NOT NULL,
	"api_key" varchar(255),
	"trust" "backend_trust" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"supports_streaming" boolean DEFAULT true NOT NULL,
	"strip_params" jsonb DEFAULT '[]' NOT NULL,
	"extra_headers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
