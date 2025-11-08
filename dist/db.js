/* eslint-env node */
import Database from "better-sqlite3";
import "dotenv/config";
const dbPath = process.env.DATABASE_PATH || "./mma_auth.db";
export const db = new Database(dbPath, { fileMustExist: false });
db.pragma("journal_mode = WAL");
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

  CREATE TABLE IF NOT EXISTS lawyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    oab_numero TEXT,
    oab_uf TEXT,
    tipo TEXT NOT NULL CHECK(tipo IN ('pessoa_fisica', 'escritorio')),
    UNIQUE(oab_numero, oab_uf)
  );

  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_cnj TEXT NOT NULL,
    tribunal TEXT NOT NULL,
    orgao TEXT,
    classe TEXT,
    assunto TEXT,
    origem TEXT NOT NULL CHECK(origem IN ('automatico', 'manual')),
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(numero_cnj, tribunal)
  );

  CREATE TABLE IF NOT EXISTS case_lawyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    lawyer_id INTEGER NOT NULL REFERENCES lawyers(id) ON DELETE CASCADE,
    papel TEXT NOT NULL,
    UNIQUE(case_id, lawyer_id)
  );

  CREATE TABLE IF NOT EXISTS case_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    orgao TEXT,
    descricao TEXT NOT NULL,
    tipo TEXT NOT NULL,
    exige_acao INTEGER NOT NULL DEFAULT 0,
    prazo_dias INTEGER,
    prazo_final TEXT,
    status TEXT NOT NULL DEFAULT 'concluido',
    hash_conteudo TEXT NOT NULL,
    UNIQUE(case_id, hash_conteudo)
  );

  CREATE TABLE IF NOT EXISTS watch_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK(tipo IN ('lawyer', 'case')),
    valor TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    UNIQUE(tipo, valor)
  );

  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alvo TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fim TEXT NOT NULL,
    status TEXT NOT NULL,
    detalhes TEXT
  );
`);
export default db;
