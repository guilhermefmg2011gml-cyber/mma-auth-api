import { Router } from 'express';
import db from '../db.js';
import { comparePassword, hashPassword, signToken } from '../auth.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Credenciais ausentes' });

  const row = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
  if (!row) return res.status(401).json({ error: 'Credenciais inválidas' });

  const ok = await comparePassword(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

  const permissions = JSON.parse(row.permissions || '{}');
  const token = signToken({ id: row.id, email: row.email, role: row.role });
  res.json({
    token,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      isFirstLogin: !!row.is_first_login,
      permissions,
    },
  });
});

/** POST /api/auth/first-change-password */
router.post('/first-change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Senha fraca' });

  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });

  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash=?, is_first_login=0 WHERE id=?').run(hash, row.id);

  res.json({ ok: true });
});

/** POST /api/auth/change-password */
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Dados ausentes' });

  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });

  const ok = await comparePassword(currentPassword, row.password_hash);
  if (!ok) return res.status(400).json({ error: 'Senha atual incorreta' });

  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, row.id);

  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT id, email, role, is_first_login, permissions FROM users WHERE id = ?')
    .get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });

  res.json({
    id: row.id,
    email: row.email,
    role: row.role,
    isFirstLogin: !!row.is_first_login,
    permissions: JSON.parse(row.permissions || '{}'),
  });
});

export default router;