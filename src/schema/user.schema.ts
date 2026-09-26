import z from "zod";

export const createUserSchema = z.object({
  email: z.email().max(255),
  username: z.string().max(255),
  password: z.string(),
  isAdmin: z.boolean().default(false),
});
