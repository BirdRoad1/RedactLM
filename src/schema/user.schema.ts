import z from "zod";
import { userRoles } from "../db/schema";

export const roleSchema = z.enum(userRoles);

export const passwordSchema = z.string().min(8, "Passwords need at least 8 characters").max(200);

export const createUserSchema = z.object({
  email: z.email().max(255),
  username: z.string().max(255),
  // leave out for someone who only signs in with single sign-on
  password: passwordSchema.optional(),
  roles: z.array(roleSchema).default([]),
});

export const setRolesSchema = z.object({
  roles: z.array(roleSchema),
});

export const setPasswordSchema = z.object({
  password: passwordSchema,
});
