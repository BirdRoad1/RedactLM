import { Hono } from "hono";
import {
  createBackend,
  deleteBackend,
  listBackends,
} from "../controllers/backends.controller";
import { requireAdmin, type AuthEnv } from "../middleware/auth";

export const backendsRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)
  .get("/", listBackends)
  .post("/", createBackend)
  .delete("/:id", deleteBackend);
