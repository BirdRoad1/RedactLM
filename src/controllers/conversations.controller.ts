import type { Context } from "hono";
import type { AuthEnv } from "../middleware/auth";
import * as conversationsService from "../services/conversations.service";

export async function listConversations(c: Context<AuthEnv>) {
  return c.json(await conversationsService.listConversations(c.get("userId")));
}

export async function getConversation(c: Context<AuthEnv>) {
  const convo = await conversationsService.getConversation(c.get("userId"), c.req.param("id")!);
  return convo ? c.json(convo) : c.json({ error: "Conversation not found" }, 404);
}

export async function deleteConversation(c: Context<AuthEnv>) {
  const deleted = await conversationsService.deleteConversation(c.get("userId"), c.req.param("id")!);
  return deleted ? c.body(null, 204) : c.json({ error: "Conversation not found" }, 404);
}
