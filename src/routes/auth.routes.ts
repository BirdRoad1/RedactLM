import { Hono } from "hono";
import { login } from "../controllers/auth.controller";

// Public: this is how users get a token in the first place
export const authRoutes = new Hono().post("/login", login);
