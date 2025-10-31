import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();

const permissionsShape = {
  processos: z.boolean().optional(),
  atendimentos: z.boolean().optional(),
  financeiro: z.boolean().optional(),
  pecas: z.boolean().optional(),
  docs: z.boolean().optional(),
};

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  permissions: z.object(permissionsShape).default({}),
});

router.post("/users", requireAuth("admin"), (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.issues);

  const { email, password, permissions } = parsed.data;
  const hash = bcrypt.hashSync(password, 10);

  try {
    const stmt = db.prepare(
      "INSERT INTO users (email, password_hash, role, permissions, is_first_login, active, created_at) VALUES (?, ?, 'user', ?, 1, 1, datetime('now'))"
    );
    const info = stmt.run(email, hash, JSON.stringify(permissions || {}));
    res.status(201).json({ id: info.lastInsertRowid, email, permissions });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "E-mail já cadastrado" });
    return res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

router.get("/users", requireAuth("admin"), (req, res) => {
  const rows = db.prepare("SELECT id, email, role, permissions FROM users").all();
  res.json(
    rows.map((row) => ({
      ...row,
      permissions: JSON.parse(row.permissions || "{}"),
    }))
  );
});

router.patch("/users/:id/permissions", requireAuth("admin"), (req, res) => {
  const permsSchema = z.object(permissionsShape).partial();
  const parsed = permsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.issues);

  const user = db.prepare("SELECT id, permissions FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

  const current = JSON.parse(user.permissions || "{}");
  const merged = { ...current, ...parsed.data };
  db.prepare("UPDATE users SET permissions = ? WHERE id = ?").run(JSON.stringify(merged), req.params.id);

  res.json({ id: user.id, permissions: merged });
});

router.patch('/users/:id/reset-password', requireAuth('admin'), (req, res) => {
  const schema = z.object({ newPassword: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.issues);

  const hash = bcrypt.hashSync(parsed.data.newPassword, 10);
  const info = db
    .prepare("UPDATE users SET password_hash = ?, is_first_login = 1 WHERE id = ?")
    .run(hash, req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json({ ok: true });
});

router.delete("/users/:id", requireAuth("admin"), (req, res) => {
  const info = db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json({ ok: true });
});

export default router;