import { Hono } from "hono";
import { logRequests } from "./middleware/logger";
import { authRoutes } from "./routes/auth.routes";
import { v1Routes } from "./routes/v1.routes";
import { usersRoutes } from "./routes/users.routes";
import { backendsRoutes } from "./routes/backends.routes";

const app = new Hono();

app.use(logRequests);

app.get("/", (c) => c.text("OK"));

app.route("/auth", authRoutes);
app.route("/v1", v1Routes);
app.route("/users", usersRoutes);
app.route("/backends", backendsRoutes);

export default {
  fetch: app.fetch,
  // Bun's default of 10s would cut off slow generations and streams that
  // pause while the model thinks; 255 is the max
  idleTimeout: 255,
};
