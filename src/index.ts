import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDoc } from "./docs/openapi";
import { env } from "./env/env";
import { logRequests } from "./middleware/logger";
import { authRoutes } from "./routes/auth.routes";
import { v1Routes } from "./routes/v1.routes";
import { usersRoutes } from "./routes/users.routes";
import { backendsRoutes } from "./routes/backends.routes";
import { settingsRoutes } from "./routes/settings.routes";

const app = new Hono();

app.use(logRequests);

app.get("/", (c) => c.text("OK"));

app.route("/auth", authRoutes);
app.route("/v1", v1Routes);
app.route("/users", usersRoutes);
app.route("/backends", backendsRoutes);
app.route("/settings", settingsRoutes);

// API docs for development only
if (env.NODE_ENV !== "production") {
  app.get("/openapi.json", (c) => c.json(openApiDoc));
  app.get("/docs", swaggerUI({ url: "/openapi.json", persistAuthorization: true }));
}

export default {
  fetch: app.fetch,
  // Bun's default of 10s would cut off slow generations and streams that
  // pause while the model thinks; 255 is the max
  idleTimeout: 255,
};
