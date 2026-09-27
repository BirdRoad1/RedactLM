import { Hono } from "hono";
import { createCompletion } from "../controllers/completions.controller";
import { listModels } from "../controllers/models.controller";
import { requireUser, type AuthEnv } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

// OpenAI-compatible API
export const v1Routes = new Hono<AuthEnv>()
  .use(requireUser)
  .post("/chat/completions", rateLimit("chat", 120, "user"), createCompletion)
  // asks every backend for its list
  .get("/models", rateLimit("models", 60, "user"), listModels);
