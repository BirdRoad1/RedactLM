import z from "zod";

export const envSchema = z.object({
    DATABASE_URL: z.url({ error: "invalid database url" }),
    JWT_SECRET: z.string(),
    // How long a login token is valid, in seconds (default 8 hours)
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60)
})