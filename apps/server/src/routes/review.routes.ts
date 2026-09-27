import { Hono } from "hono";
import { listAllConversations, reviewConversation } from "../controllers/review.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

// Everyone's chat history, read-only
export const reviewRoutes = new Hono<AuthEnv>()
  .use(requireRole("review_chats"))
  .get("/conversations", listAllConversations)
  .get("/conversations/:id", reviewConversation);
