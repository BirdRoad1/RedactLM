import { Hono } from "hono";
import {
  deleteCheckerPolicy,
  getDetectionPolicy,
  getLlmDetector,
  setCheckerPolicy,
  updateDetectionDefaults,
  updateLlmDetector,
} from "../controllers/settings.controller";
import { requireAdmin, type AuthEnv } from "../middleware/auth";

export const settingsRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)
  .get("/llm-detector", getLlmDetector)
  .patch("/llm-detector", updateLlmDetector)
  .get("/detection-policy", getDetectionPolicy)
  .patch("/detection-policy", updateDetectionDefaults)
  .put("/detection-policy/checkers/:checker", setCheckerPolicy)
  .delete("/detection-policy/checkers/:checker", deleteCheckerPolicy);
