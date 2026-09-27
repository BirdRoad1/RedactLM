import { Hono } from "hono";
import { createUser, deleteUser, listUsers, restoreUser, setUserPassword, setUserRoles } from "../controllers/users.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

export const usersRoutes = new Hono<AuthEnv>()
  .use(requireRole("manage_users"))
  .get("/", listUsers)
  .post("/", createUser)
  .put("/:id/roles", setUserRoles)
  .put("/:id/password", setUserPassword)
  .delete("/:id", deleteUser)
  .post("/:id/restore", restoreUser);
