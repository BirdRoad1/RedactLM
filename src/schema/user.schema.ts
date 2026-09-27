import z from "zod";
import { userRoles } from "../db/schema";

export const roleSchema = z.enum(userRoles);

export const createUserSchema = z.object({
  email: z.email().max(255),
  username: z.string().max(255),
  password: z.string(),
  roles: z.array(roleSchema).default([]),
});

export const setRolesSchema = z.object({
  roles: z.array(roleSchema),
});
