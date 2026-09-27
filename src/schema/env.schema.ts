import z from "zod";

export const envSchema = z.object({
    DATABASE_URL: z.url({ error: "invalid database url" }),
    JWT_SECRET: z.string(),
    NODE_ENV: z.string().default("development"),
    // How long a login token is valid, in seconds (default 8 hours)
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),
    // Where the web app is, for sending people back after single sign-on
    APP_URL: z.url().default("http://localhost:5173"),
    // This API's address as browsers see it (behind the web app's /api proxy
    // by default); SSO providers redirect here
    PUBLIC_API_URL: z.url().optional(),
    // Behind a proxy we run (the web container's nginx): take the client's
    // address from the last X-Forwarded-For entry, for rate limits and logs
    TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    // Scales every rate limit: 2 doubles them, 0 turns them off (load tests)
    RATE_LIMIT_MULTIPLIER: z.coerce.number().min(0).default(1),
}).transform((env) => ({ ...env, PUBLIC_API_URL: (env.PUBLIC_API_URL ?? `${env.APP_URL}/api`).replace(/\/$/, "") }))