/* eslint-env node */
import db from '../db.js';

export default function requirePermission(key) {
  return (req, res, next) => {
    const user = db.prepare('SELECT role, permissions FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    if (user.role === 'admin') return next();

    const perms = JSON.parse(user.permissions || '{}');
    if (perms[key]) return next();

    return res.status(403).json({ error: 'forbidden' });
  };
}