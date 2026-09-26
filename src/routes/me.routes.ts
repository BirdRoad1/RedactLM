import { Hono } from "hono";
import { getMe } from "../controllers/auth.controller";
import { requireUser, type AuthEnv } from "../middleware/auth";

export const meRoutes = new Hono<AuthEnv>().use(requireUser).get("/", getMe);
