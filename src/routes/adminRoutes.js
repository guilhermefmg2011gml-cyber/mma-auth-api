import express from "express";
import { db } from "../db.js";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";
import bcrypt from "bcryptjs";
import { audit } from "../audit.js";

const router = express.Router();

router.use(requireAuth, attachUser, requirePermission("users:read"));

router.get("/users", (_req, res) => {
  const rows = db.prepare("SELECT id, email, role FROM users ORDER BY id DESC").all();
  res.json(rows);
});

router.post("/users", requirePermission("users:create"), (req, res) => {
  const { email, password, role = "colab" } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "EMAIL_PASSWORD_REQUIRED" });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?,?,?)").run(email, hash, role);
    audit({
      byUserId: req.user.id,
      action: "users:create",
      entity: "users",
      entityId: info.lastInsertRowid,
      diff: { email, role },
      ip: req.ip,
      ua: req.headers["user-agent"],
    });
    res.status(201).json({ id: info.lastInsertRowid, email, role });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "EMAIL_IN_USE" });
    throw e;
  }
});

router.put("/users/:id", requirePermission("users:update"), (req, res) => {
  const id = Number(req.params.id);
  const { email, password, role } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!user) return res.status(404).json({ error: "NOT_FOUND" });

  const diff = {};
  if (email && email !== user.email) diff.email = [user.email, email];
  if (role && role !== user.role) diff.role = [user.role, role];

  const fields = [];
  const values = [];
  if (email) {
    fields.push("email=?");
    values.push(email);
  }
  if (role) {
    fields.push("role=?");
    values.push(role);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    fields.push("password_hash=?");
    values.push(hash);
    diff.password = "[updated]";
  }
  if (!fields.length) return res.json({ ok: true });

  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(",")} WHERE id=?`).run(...values);

  audit({
    byUserId: req.user.id,
    action: "users:update",
    entity: "users",
    entityId: id,
    diff,
    ip: req.ip,
    ua: req.headers["user-agent"],
  });

  res.json({ ok: true });
});

router.delete("/users/:id", requirePermission("users:delete"), (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "NOT_FOUND" });
  db.prepare("DELETE FROM users WHERE id=?").run(id);

  audit({
    byUserId: req.user.id,
    action: "users:delete",
    entity: "users",
    entityId: id,
    diff: { email: u.email },
    ip: req.ip,
    ua: req.headers["user-agent"],
  });

  res.json({ ok: true });
});

export default router;