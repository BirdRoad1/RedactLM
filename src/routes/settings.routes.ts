import { Hono } from "hono";
import {
  deleteCheckerPolicy,
  getDetectionPolicy,
  getLlmDetector,
  listDetectorBackends,
  setCheckerPolicy,
  updateDetectionDefaults,
  updateLlmDetector,
} from "../controllers/settings.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

export const settingsRoutes = new Hono<AuthEnv>()
  .use(requireRole("manage_settings"))
  .get("/llm-detector", getLlmDetector)
  .patch("/llm-detector", updateLlmDetector)
  .get("/llm-detector/backends", listDetectorBackends)
  .get("/detection-policy", getDetectionPolicy)
  .patch("/detection-policy", updateDetectionDefaults)
  .put("/detection-policy/checkers/:checker", setCheckerPolicy)
  .delete("/detection-policy/checkers/:checker", deleteCheckerPolicy);
