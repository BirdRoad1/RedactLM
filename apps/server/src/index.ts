import { swaggerUI } from "@hono/swagger-ui";
import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contextStorage } from "hono/context-storage";
import { openApiDoc } from "./docs/openapi";
import { env } from "./env/env";
import { logRequests } from "./middleware/logger";
import { rateLimit } from "./middleware/rate-limit";
import { authRoutes } from "./routes/auth.routes";
import { meRoutes } from "./routes/me.routes";
import { checkRoutes } from "./routes/check.routes";
import { conversationsRoutes } from "./routes/conversations.routes";
import { auditRoutes } from "./routes/audit.routes";
import { v1Routes } from "./routes/v1.routes";
import { usersRoutes } from "./routes/users.routes";
import { backendsRoutes } from "./routes/backends.routes";
import { settingsRoutes } from "./routes/settings.routes";
import { reviewRoutes } from "./routes/review.routes";
import { keywordsRoutes } from "./routes/keywords.routes";

// The API: every route, mounted twice below
const api = new Hono();
api.route("/auth", authRoutes);
api.route("/me", meRoutes);
api.route("/check", checkRoutes);
api.route("/conversations", conversationsRoutes);
api.route("/v1", v1Routes);
api.route("/users", usersRoutes);
api.route("/backends", backendsRoutes);
api.route("/settings", settingsRoutes);
api.route("/audit-log", auditRoutes);
api.route("/review", reviewRoutes);
api.route("/keywords", keywordsRoutes);

// API docs for development only
if (env.NODE_ENV !== "production") {
  api.get("/openapi.json", (c) => c.json(openApiDoc));
  api.get("/docs", swaggerUI({ url: "/openapi.json", persistAuthorization: true }));
}

const app = new Hono();

// lets code deep in a request (audit logging) see who made it
app.use(contextStorage());
app.use(logRequests);
// a backstop for every route, per address; tighter limits sit on the
// expensive ones
app.use(rateLimit("everything", 3000, "ip"));

app.get("/health", (c) => c.text("OK"));

// The API at the root (OpenAI-style clients use …/v1) and under /api (the
// web app, from the same address)
app.route("/api", api);
app.route("/", api);

// The built web app: STATIC_DIR if set, or in production the monorepo's own
// apps/web/dist next to this server (where the Docker image puts it). In
// development Vite serves the app instead. Files are served as they are;
// any other page path gets index.html, since the app routes on the client
// (/chat/…, /admin/…). Unknown API paths keep their 404.
const builtWebApp = fileURLToPath(new URL("../../web/dist", import.meta.url));
const staticDir = env.STATIC_DIR ?? (env.NODE_ENV === "production" && existsSync(builtWebApp) ? builtWebApp : undefined);
if (staticDir) {
  const root = staticDir;
  const headers = (cache: string) => (_path: string, c: Context) => {
    c.header("Cache-Control", cache);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
  };
  // built files have content hashes in their names, so they never change
  app.use("/assets/*", serveStatic({ root, onFound: headers("public, max-age=31536000, immutable") }));
  app.use("*", serveStatic({ root, onFound: headers("no-cache") }));
  // (via root, like the files above: `path` is taken relative to the
  // working directory, so an absolute STATIC_DIR like the image's breaks it)
  const page = serveStatic({ root, rewriteRequestPath: () => "/index.html", onFound: headers("no-cache") });
  app.get("*", (c, next) => (/^\/(api|v1)(\/|$)/.test(c.req.path) ? next() : page(c, next)));
} else {
  // development: the web app runs on Vite's dev server
  app.get("/", (c) => c.text("OK"));
}

export default {
  fetch: app.fetch,
  // Bun's default of 10s would cut off slow generations and streams that
  // pause while the model thinks; 255 is the max
  idleTimeout: 255,
};
