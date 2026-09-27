import z from "zod";
import { userRoles } from "../db/schema";

export const roleSchema = z.enum(userRoles);

export const createUserSchema = z.object({
  email: z.email().max(255),
  username: z.string().max(255),
  // leave out for someone who only signs in with single sign-on
  password: z.string().min(1).optional(),
  roles: z.array(roleSchema).default([]),
});

export const setRolesSchema = z.object({
  roles: z.array(roleSchema),
});
