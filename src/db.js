/* eslint-env node */
/* global process */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const db = new Database('mma_auth.db');

// Tabela de usuários
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','user')),
    password_hash TEXT NOT NULL,
    is_first_login INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '{}'
  );
`);

// Adiciona a coluna permissions caso a tabela tenha sido criada antes dessa versão
const hasPermissionsColumn = db
  .prepare("PRAGMA table_info('users')")
  .all()
  .some((column) => column.name === 'permissions');

if (!hasPermissionsColumn) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}' ");
}

// Seed do ADMIN (se não existir)
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.warn('[SEED] ADMIN_EMAIL/ADMIN_PASSWORD ausentes no .env');
} else {
  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
  if (!exists) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare(`
      INSERT INTO users (email, role, password_hash, is_first_login, active, created_at)
      VALUES (?, 'admin', ?, 0, 1, datetime('now'))
    `).run(adminEmail, hash);
    console.log(`[SEED] Admin criado: ${adminEmail}`);
  }
}

export default db;