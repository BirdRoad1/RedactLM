import { Hono } from "hono";
import { requireAdmin, type AuthEnv } from "../middleware/auth";
import { listAudit } from "../services/audit.service";

export const auditRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)
  .get("/", async (c) => c.json(await listAudit({ event: c.req.query("event") || undefined })));
