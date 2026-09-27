import type { Context } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { audit } from "../services/audit.service";
import * as conversationsService from "../services/conversations.service";

export async function listAllConversations(c: Context<AuthEnv>) {
  return c.json(await conversationsService.listAllConversations({ q: c.req.query("q") || undefined }));
}

// Reading someone's conversation is logged, so reviewing is accountable too
export async function reviewConversation(c: Context<AuthEnv>) {
  const convo = await conversationsService.reviewConversation(c.req.param("id")!);
  if (!convo) return c.json({ error: "Conversation not found" }, 404);
  await audit("conversation_reviewed", { owner: convo.user, title: convo.title }, { conversationId: convo.id });
  return c.json(convo);
}
