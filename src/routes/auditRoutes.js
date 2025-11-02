import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";
import { db } from "../db.js";

const router = Router();

router.use(requireAuth, attachUser);

router.get(
  "/audit/latest",
  requirePermission("audit:read"),
  (_req, res) => {
    try {
      const stmt = db.prepare(`
        SELECT id, created_at, user_email, action, entity, entity_id, diff_json, ip, ua
        FROM audit_logs
        ORDER BY id DESC
        LIMIT 20
      `);
      const rows = stmt.all();
      return res.json(rows);
    } catch (error) {
      console.error("audit/latest error:", error.message);
      return res.json([]);
    }
  }
);

router.get("/audit", requirePermission("audit:read"), (req, res) => {
  try {
    const { q = "", limit = 50, offset = 0 } = req.query;
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 200) : 50;
    const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;
    const stmt = db.prepare(`
      SELECT a.id, a.user_id, a.user_email, a.action, a.entity, a.entity_id,
             a.diff_json, a.ip, a.ua, a.created_at
      FROM audit_logs a
      WHERE (
        a.action LIKE @term OR
        a.entity LIKE @term OR
        IFNULL(a.user_email, "") LIKE @term
      )
      ORDER BY a.id DESC
      LIMIT @limit OFFSET @offset
    `);
    const rows = stmt.all({
      term: `%${q}%`,
      limit: safeLimit,
      offset: safeOffset,
    });
    return res.json(rows);
  } catch (error) {
    console.error("/audit error:", error.message);
    return res.json([]);
  }
});

export default router;