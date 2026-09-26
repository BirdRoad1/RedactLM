import z from "zod";

export const envSchema = z.object({
    DATABASE_URL: z.url({ error: "invalid database url" })
})