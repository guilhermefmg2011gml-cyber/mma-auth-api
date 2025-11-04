/* eslint-env node */
import Database from "better-sqlite3";
import crypto from "crypto";
import "dotenv/config";

const dbPath = process.env.DATABASE_PATH || "./mma_auth.db";
export const db = new Database(dbPath, { fileMustExist: false });

db.pragma("journal_mode = WAL");

// Campos extras para Datajud (ignora erro se a coluna já existir)
for (const ddl of [
  "ALTER TABLE processes ADD COLUMN tribunal TEXT;",
  "ALTER TABLE processes ADD COLUMN grau TEXT;",
  "ALTER TABLE processes ADD COLUMN classeCodigo TEXT;",
  "ALTER TABLE processes ADD COLUMN classeNome TEXT;",
  "ALTER TABLE processes ADD COLUMN orgaoCodigo TEXT;",
  "ALTER TABLE processes ADD COLUMN orgaoNome TEXT;",
  "ALTER TABLE processes ADD COLUMN dataAjuizamento TEXT;",
  "ALTER TABLE processes ADD COLUMN nivelSigilo TEXT;",
  "ALTER TABLE processes ADD COLUMN fonte TEXT;",
  "ALTER TABLE processes ADD COLUMN last_seen_at INTEGER;"
]) {
  try { db.exec(ddl); } catch (_) {}
}

// Índices úteis
for (const ddl of [
  "CREATE INDEX IF NOT EXISTS ix_proc_num   ON processes(cnj_number);",
  "CREATE INDEX IF NOT EXISTS ix_proc_fonte ON processes(fonte);",
  "CREATE INDEX IF NOT EXISTS ix_events_unique ON process_events(process_id, codigo, dataHora);"
]) {
  try {
    db.exec(ddl);
  } catch (error) {
    if (!String(error).toLowerCase().includes("no such table")) {
      console.error("[db] erro ao criar índice:", error?.message || error);
    }
  }
}

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

  CREATE TABLE IF NOT EXISTS processos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,
    classe TEXT,
    assunto TEXT,
    instancia TEXT,
    situacao TEXT,
    foro TEXT,
    vara TEXT,
    polo_ativo TEXT,
    polo_passivo TEXT,
    origem TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS andamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    processo_id INTEGER NOT NULL,
    data_mov TEXT,
    movimento TEXT,
    complemento TEXT,
    origem TEXT,
    hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (processo_id) REFERENCES processos(id)
  );

  CREATE TABLE IF NOT EXISTS vinculacoes_oab (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    oab TEXT NOT NULL,
    uf TEXT NOT NULL DEFAULT 'GO',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

try {
  db.exec(`ALTER TABLE andamentos ADD COLUMN hash TEXT`);
} catch (error) {
  if (!String(error).includes("duplicate column")) {
    console.error("[db] erro ao adicionar coluna hash em andamentos:", error);
  }
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS ux_processos_numero ON processos(numero);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_andamentos_hash ON andamentos(hash);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_vinculos_oab ON vinculacoes_oab(oab, uf);
`);

function sanitizeText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => sanitizeText(v)).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function normalizeParties(value) {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeText(v)).filter(Boolean).join("; ");
  }
  return sanitizeText(value);
}

export function upsertProcessoFromDTO(dto = {}) {
  const numero = sanitizeText(dto.numero);
  if (!numero) return null;

  const record = {
    numero,
    classe: sanitizeText(dto.classe),
    assunto: sanitizeText(dto.assunto),
    instancia: sanitizeText(dto.instancia),
    situacao: sanitizeText(dto.situacao || "em andamento"),
    foro: sanitizeText(dto.foro),
    vara: sanitizeText(dto.vara),
    polo_ativo: normalizeParties(dto.polo_ativo),
    polo_passivo: normalizeParties(dto.polo_passivo),
    origem: sanitizeText(dto.origem || "manual"),
    updated_at: new Date().toISOString(),
  };

  const existing = db.prepare(`SELECT id FROM processos WHERE numero = ?`).get(numero);
  if (existing?.id) {
    db.prepare(`
      UPDATE processos
      SET classe=@classe,
          assunto=@assunto,
          instancia=@instancia,
          situacao=@situacao,
          foro=@foro,
          vara=@vara,
          polo_ativo=@polo_ativo,
          polo_passivo=@polo_passivo,
          origem=COALESCE(NULLIF(@origem,''), origem),
          updated_at=@updated_at
      WHERE id=@id
    `).run({ ...record, id: existing.id });
    return existing.id;
  }

  const stmt = db.prepare(`
    INSERT INTO processos (
      numero, classe, assunto, instancia, situacao, foro,
      vara, polo_ativo, polo_passivo, origem, created_at, updated_at
    ) VALUES (
      @numero, @classe, @assunto, @instancia, @situacao, @foro,
      @vara, @polo_ativo, @polo_passivo, @origem, @created_at, @updated_at
    )
  `);
  const nowIso = new Date().toISOString();
  const info = stmt.run({ ...record, created_at: nowIso });
  return info.lastInsertRowid;
}

export function insertAndamentos(processId, numero, movimentos = [], origem = "manual") {
  if (!processId || !Array.isArray(movimentos)) return 0;

  const stmt = db.prepare(`
    INSERT INTO andamentos (processo_id, data_mov, movimento, complemento, origem)
    VALUES (@pid, @data_mov, @movimento, @complemento, @origem)
  `);

  let inserted = 0;
  for (const mov of movimentos) {
    const dataMov = mov?.data_mov || mov?.data || null;
    const principal = sanitizeText(mov?.movimento || mov?.evento || mov?.descricao || mov?.tipo);
    const detalhe = sanitizeText(mov?.complemento || mov?.detalhe || mov?.observacao);
    stmt.run({
      pid: processId,
      data_mov: dataMov,
      movimento: principal,
      complemento: detalhe,
      origem,
    });
    inserted += 1;
  }
  return inserted;
}

// Gera hash canônico do evento (nup+data+movimento+complemento+origem)
export function eventHash({ numero, data_mov, movimento, complemento, origem }) {
  const basis = [
    sanitizeText(numero),
    sanitizeText(data_mov),
    sanitizeText(movimento),
    sanitizeText(complemento),
    sanitizeText(origem),
  ].join("|");
  return crypto.createHash("sha256").update(basis, "utf8").digest("hex");
}

// Versão com dedup (usa a coluna hash única)
export function insertAndamentosDedup(processId, numero, movimentos = [], origem = "pdpj") {
  if (!processId || !Array.isArray(movimentos)) return 0;

  const stmt = db.prepare(`
    INSERT INTO andamentos (processo_id, data_mov, movimento, complemento, origem, hash)
    VALUES (@pid, @data_mov, @movimento, @complemento, @origem, @hash)
  `);

  let inserted = 0;
  for (const mov of movimentos) {
    const dataMov = mov?.data_mov || mov?.data || mov?.timestamp || null;
    const principal = sanitizeText(mov?.movimento || mov?.evento || mov?.tipo || mov?.descricao);
    const detalhe = sanitizeText(mov?.complemento || mov?.detalhe || mov?.observacao);
    const hash = eventHash({ numero, data_mov: dataMov, movimento: principal, complemento: detalhe, origem });
    try {
      stmt.run({
        pid: processId,
        data_mov: dataMov,
        movimento: principal,
        complemento: detalhe,
        origem,
        hash,
      });
      inserted += 1;
    } catch (error) {
      if (!String(error).includes("UNIQUE")) {
        throw error;
      }
    }
  }
  return inserted;
}

export default db;