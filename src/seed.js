import { db } from "./db.js";
import bcrypt from "bcryptjs";

export async function seedAdminIfEnabled() {
  if (process.env.SEED_ADMIN !== "true") return;

  const T = process.env.USERS_TABLE || "users";
  const E = process.env.EMAIL_COL || "email";
  const P = process.env.PASS_COL  || "password_hash";
  const R = process.env.ROLE_COL  || "role";

  const email = process.env.ADMIN_EMAIL || "administrador@mouramartinsadvogados.com.br";
  const pass  = process.env.ADMIN_PASSWORD || "Direito94@";

  const hash = bcrypt.hashSync(pass, 10);

  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(T);
  if (!exists) {
    let ddl = `CREATE TABLE ${T} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${E} TEXT UNIQUE NOT NULL, ${P} TEXT NOT NULL`;
    if (R) ddl += `, ${R} TEXT DEFAULT 'admin'`;
    ddl += `);`;
    db.exec(ddl);
  }

  const u = db.prepare(`SELECT * FROM ${T} WHERE ${E}=?`).get(email);
  if (u) {
    db.prepare(`UPDATE ${T} SET ${P}=? ${R ? `, ${R}='admin'` : ""} WHERE ${E}=?`).run(hash, email);
    console.log("Seed: admin atualizado.");
  } else {
    const cols = [E, P].concat(R ? [R] : []);
    const vals = [email, hash].concat(R ? ["admin"] : []);
    db.prepare(`INSERT INTO ${T} (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).run(...vals);
    console.log("Seed: admin inserido.");
  }
}