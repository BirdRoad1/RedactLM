import { Hono } from "hono";
import { createUser } from "../controllers/users.controller";
import { requireAdmin, type AuthEnv } from "../middleware/auth";

export const usersRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)
  .post("/", createUser);
