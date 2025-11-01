import express from "express";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";
import { db } from "../db.js";

const router = express.Router();
router.use(requireAuth, attachUser, requirePermission("logs:read"));

router.get("/audit", (req, res) => {
  const { q = "", limit = 50, offset = 0 } = req.query;
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, u.email AS user_email, a.action, a.entity, a.entity_id,
              a.diff_json, a.ip, a.ua, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE (a.action LIKE ? OR a.entity LIKE ? OR u.email LIKE ?)
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, Number(limit), Number(offset));
  res.json(rows);
});

export default router;