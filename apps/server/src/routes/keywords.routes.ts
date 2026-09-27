import { Hono } from "hono";
import { addKeywords, deleteKeyword, listKeywords } from "../controllers/keywords.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

// The custom keyword list: seeing it and changing it take the same role
export const keywordsRoutes = new Hono<AuthEnv>()
  .use(requireRole("manage_keywords"))
  .get("/", listKeywords)
  .post("/", addKeywords)
  .delete("/:id", deleteKeyword);
