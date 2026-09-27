import z from "zod";
import { env } from "../env/env";

// HTTPS, except a provider on this machine outside production (a local
// Keycloak, or a test provider)
const issuer = z.url().refine(
  (url) => {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(hostname));
  },
  "must be an https:// URL",
);

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a domain like example.com");

export const createSsoProviderSchema = z.object({
  name: z.string().trim().min(1).max(64),
  // in URLs: lowercase letters and digits separated by single hyphens
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64),
  issuer,
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
  allowedDomains: z.array(domain).default([]),
  enabled: z.boolean().default(true),
});

export const updateSsoProviderSchema = z.object({
  enabled: z.boolean().optional(),
  allowedDomains: z.array(domain).optional(),
});

export type CreateSsoProvider = z.infer<typeof createSsoProviderSchema>;
export type UpdateSsoProvider = z.infer<typeof updateSsoProviderSchema>;
