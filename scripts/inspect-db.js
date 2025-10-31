// scripts/inspect-db.js
import Database from "better-sqlite3";

const db = new Database("./mma_auth.db");

const tables = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

console.log("== Tabelas ==");
for (const t of tables) {
  console.log(`\n[${t.name}]\n${t.sql}`);
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log("Colunas:", cols.map(c => `${c.name}(${c.type})${c.pk ? " [PK]" : ""}`).join(", "));
  const sample = db.prepare(`SELECT * FROM ${t.name} LIMIT 3`).all();
  console.log("Amostra de linhas:", sample);
}

// Tente adivinhar qual é a tabela de usuários:
const candidateTables = tables.filter(t =>
  /user|account|member/i.test(t.name)
);
console.log("\n== Candidatas a tabela de usuários ==");
console.log(candidateTables.map(t => t.name));

if (candidateTables.length) {
  for (const { name } of candidateTables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
    const guessEmail = cols.find(c => /email/i.test(c));
    const guessPass  = cols.find(c => /(password|pass|hash)/i.test(c));
    const guessRole  = cols.find(c => /role|perfil|type/i.test(c));
    console.log(`\n[${name}] possivel email=${guessEmail} senha=${guessPass} role=${guessRole}`);
  }
}

console.log("\n✅ Inspeção concluída.");