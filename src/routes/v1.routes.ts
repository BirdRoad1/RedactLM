import { Hono } from "hono";
import { createCompletion } from "../controllers/completions.controller";
import { listModels } from "../controllers/models.controller";
import { requireUser, type AuthEnv } from "../middleware/auth";

// OpenAI-compatible API
export const v1Routes = new Hono<AuthEnv>()
  .use(requireUser)
  .post("/chat/completions", createCompletion)
  .get("/models", listModels);
