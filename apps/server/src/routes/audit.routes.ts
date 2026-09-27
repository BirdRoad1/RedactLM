import { Hono } from "hono";
import { exportAuditLog, listAuditLog } from "../controllers/audit.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const auditRoutes = new Hono<AuthEnv>()
  .use(requireRole("view_audit"))
  .get("/", listAuditLog)
  .get("/export.csv", rateLimit("audit export", 20, "user"), exportAuditLog);
