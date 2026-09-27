import { Hono } from "hono";
import { login } from "../controllers/auth.controller";
import { finishSignIn, listSignInOptions, startSignIn } from "../controllers/sso.controller";

// Public: this is how users get a token in the first place
export const authRoutes = new Hono()
  .post("/login", login)
  .get("/sso", listSignInOptions)
  .get("/sso/:slug/start", startSignIn)
  .get("/sso/:slug/callback", finishSignIn);
