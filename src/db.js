import Database from "better-sqlite3";
import "dotenv/config";

export const db = new Database(process.env.DATABASE_PATH || "./mma_auth.db", {
  fileMustExist: false,
});

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'colaborador',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    user_id INTEGER,
    user_email TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    diff_json TEXT,
    ip TEXT,
    ua TEXT
  );
`);