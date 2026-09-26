import { Hono } from "hono";
import { checkText } from "../controllers/check.controller";
import { requireUser, type AuthEnv } from "../middleware/auth";

export const checkRoutes = new Hono<AuthEnv>().use(requireUser).post("/", checkText);
