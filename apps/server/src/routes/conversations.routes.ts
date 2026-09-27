import { Hono } from "hono";
import {
  deleteConversation,
  getConversation,
  listConversations,
} from "../controllers/conversations.controller";
import { requireUser, type AuthEnv } from "../middleware/auth";

// Each user's own chat history
export const conversationsRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get("/", listConversations)
  .get("/:id", getConversation)
  .delete("/:id", deleteConversation);
