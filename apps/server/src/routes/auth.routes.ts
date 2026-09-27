import { Hono } from "hono";
import { login } from "../controllers/auth.controller";
import { finishSignIn, listSignInOptions, startSignIn } from "../controllers/sso.controller";
import { rateLimit } from "../middleware/rate-limit";

// Public: this is how users get a token in the first place
export const authRoutes = new Hono()
  .post("/login", rateLimit("sign-in", 30, "ip"), login)
  .get("/sso", listSignInOptions)
  .get("/sso/:slug/start", rateLimit("sso", 30, "ip"), startSignIn)
  .get("/sso/:slug/callback", rateLimit("sso", 30, "ip"), finishSignIn);
