import { db } from "./db.js";
import bcrypt from "bcryptjs";

export async function seedAdminIfEnabled() {
  if (process.env.SEED_ADMIN !== "true") return;

  const T = process.env.USERS_TABLE || "users";
  const E = process.env.EMAIL_COL || "email";
  const P = process.env.PASS_COL || "password_hash";
  const R = process.env.ROLE_COL || "role";

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${T} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${E} TEXT UNIQUE NOT NULL,
      ${P} TEXT NOT NULL,
      ${R} TEXT DEFAULT 'colab'
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      diff_json TEXT,
      ip TEXT,
      ua TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
    );
  `);

  const email = process.env.ADMIN_EMAIL || "administrador@mouramartinsadvogados.com.br";
  const pass = process.env.ADMIN_PASSWORD || "Direito94@";

  const hash = bcrypt.hashSync(pass, 10);

  const u = db.prepare(`SELECT * FROM ${T} WHERE ${E}=?`).get(email);
  if (u) {
    db.prepare(`UPDATE ${T} SET ${P}=?, ${R}='admin' WHERE ${E}=?`).run(hash, email);
    console.log("Seed: admin atualizado.");
  } else {
    const cols = [E, P, R];
    const vals = [email, hash, "admin"];
    db.prepare(`INSERT INTO ${T} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
    console.log("Seed: admin inserido.");
  }
}