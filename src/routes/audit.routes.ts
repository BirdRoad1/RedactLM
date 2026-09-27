import { Hono } from "hono";
import { exportAuditLog, listAuditLog } from "../controllers/audit.controller";
import { requireRole, type AuthEnv } from "../middleware/auth";

export const auditRoutes = new Hono<AuthEnv>()
  .use(requireRole("view_audit"))
  .get("/", listAuditLog)
  .get("/export.csv", exportAuditLog);
