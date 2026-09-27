import { Hono } from "hono";
import {
  createBackend,
  deleteBackend,
  listBackends,
} from "../controllers/backends.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

export const backendsRoutes = new Hono<AuthEnv>()
  .use(requireRole("manage_backends"))
  .get("/", listBackends)
  .post("/", createBackend)
  .delete("/:id", deleteBackend);
