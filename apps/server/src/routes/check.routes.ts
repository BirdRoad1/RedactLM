import { Hono } from "hono";
import { checkFile, checkText } from "../controllers/check.controller";
import { requireUser, type AuthEnv } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const checkRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  // as-you-type checks, debounced by the web app: a couple a second at most
  .post("/", rateLimit("live check", 600, "user"), checkText)
  // OCR is heavy
  .post("/file", rateLimit("file check", 60, "user"), checkFile);
