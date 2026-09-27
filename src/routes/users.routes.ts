import { Hono } from "hono";
import { createUser, listUsers, setUserRoles } from "../controllers/users.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

export const usersRoutes = new Hono<AuthEnv>()
  .use(requireRole("manage_users"))
  .get("/", listUsers)
  .post("/", createUser)
  .put("/:id/roles", setUserRoles);
