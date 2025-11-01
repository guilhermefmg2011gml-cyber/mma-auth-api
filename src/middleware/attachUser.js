import { db } from "../db.js";

const PERMS = {
  admin: ["*", "users:read", "users:create", "users:update", "users:delete", "roles:assign", "logs:read"],
  gestor: ["users:read", "users:create", "users:update", "logs:read"],
  colab: [],
};

export default function attachUser(req, res, next) {
  const u = db.prepare("SELECT id, email, role FROM users WHERE id=?").get(req.auth.id);
  if (!u) return res.status(401).json({ error: "USER_NOT_FOUND" });
  req.user = { ...u, permissions: PERMS[u.role] || [] };
  next();
}