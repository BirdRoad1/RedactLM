import { Hono } from "hono";
import {
  getLlmDetector,
  updateLlmDetector,
} from "../controllers/settings.controller";
import { requireAdmin, type AuthEnv } from "../middleware/auth";

export const settingsRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)
  .get("/llm-detector", getLlmDetector)
  .patch("/llm-detector", updateLlmDetector);
