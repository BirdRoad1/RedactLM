import z from "zod";

export const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(1024),
});

export const loginResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});

export type LoginResponse = z.infer<typeof loginResponse>;
