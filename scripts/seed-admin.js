// scripts/seed-admin.js
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const db = new Database("./mma_auth.db");

const USERS_TABLE = "users";
const EMAIL_COL = "email";
const PASS_COL = "password_hash";
const ROLE_COL = "role";

const ADMIN_EMAIL = "administrador@mouramartinsadvogados.com.br";
const ADMIN_PASS = "Direito94@";

const hash = bcrypt.hashSync(ADMIN_PASS, 10);

// Se não existir tabela (dev), cria uma genérica compatível:
if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(USERS_TABLE)) {
  let ddl = `CREATE TABLE ${USERS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${EMAIL_COL} TEXT UNIQUE NOT NULL,
    ${PASS_COL} TEXT NOT NULL`;
  if (ROLE_COL) ddl += `, ${ROLE_COL} TEXT DEFAULT 'admin'`;
  ddl += `);`;
  db.exec(ddl);
  console.log(`(Tabela ${USERS_TABLE} criada para ambiente vazio)`);
}

const existing = db.prepare(
  `SELECT * FROM ${USERS_TABLE} WHERE ${EMAIL_COL}=?`
).get(ADMIN_EMAIL);

if (existing) {
  console.log("Admin já existe. Atualizando senha…");
  const updateSql = `UPDATE ${USERS_TABLE} SET ${PASS_COL}=?${ROLE_COL ? ", " + ROLE_COL + "='admin'" : ''} WHERE ${EMAIL_COL}=?`;
  db.prepare(updateSql).run(hash, ADMIN_EMAIL);
} else {
  console.log("Inserindo admin…");
  const cols = [EMAIL_COL, PASS_COL];
  const vals = [ADMIN_EMAIL, hash];
  if (ROLE_COL) {
    cols.push(ROLE_COL);
    vals.push('admin');
  }
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO ${USERS_TABLE} (${cols.join(',')}) VALUES (${placeholders})`
  ).run(...vals);
}

const roleSelect = ROLE_COL ? `, ${ROLE_COL}` : '';
const rows = db.prepare(
  `SELECT ${EMAIL_COL}${roleSelect} FROM ${USERS_TABLE} WHERE ${EMAIL_COL}=?`
).get(ADMIN_EMAIL);

console.log("✅ Admin pronto:", rows);