import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type DatabaseInstance = ReturnType<typeof Database>;
type StatementInstance = ReturnType<DatabaseInstance["prepare"]>;

export interface LocalMemoryRecord {
  id: number;
  texto: string;
  tipo: string;
  clienteId: string | null;
  processoId: string | null;
  criadoEm: string;
}

export interface SaveMemoryInput {
  texto: string;
  tipo: string;
  clienteId?: string | null;
  processoId?: string | null;
}

export interface ListMemoryFilters {
  clienteId?: string;
  processoId?: string;
  limit?: number;
  tipo?: string;
}

function resolveDatabasePath(): string {
  const configured = process.env.MEMORIA_DB_PATH;
  if (configured && configured.trim()) {
    return path.resolve(process.cwd(), configured.trim());
  }
  return path.resolve(process.cwd(), "storage", "memoria_juridica.db");
}

class LocalMemoryService {
  private db: DatabaseInstance;
  private insertStmt: StatementInstance;
  private listByClienteStmt: StatementInstance;
  private listByProcessoStmt: StatementInstance;

  constructor(private readonly dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.createTable();

    this.insertStmt = this.db.prepare(
      `INSERT INTO memoria (texto, tipo, cliente_id, processo_id) VALUES (@texto, @tipo, @clienteId, @processoId)`
    );
    this.listByClienteStmt = this.db.prepare(
      `SELECT id, texto, tipo, cliente_id AS clienteId, processo_id AS processoId, criado_em AS criadoEm
         FROM memoria
        WHERE cliente_id = ?
        ORDER BY criado_em DESC
        LIMIT ?`
    );
    this.listByProcessoStmt = this.db.prepare(
      `SELECT id, texto, tipo, cliente_id AS clienteId, processo_id AS processoId, criado_em AS criadoEm
         FROM memoria
        WHERE processo_id = ?
        ORDER BY criado_em DESC
        LIMIT ?`
    );
  }

  private createTable(): void {
    this.db
      .prepare(`
        CREATE TABLE IF NOT EXISTS memoria (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          texto TEXT NOT NULL,
          tipo TEXT NOT NULL,
          cliente_id TEXT,
          processo_id TEXT,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)
      .run();
  }

  salvar({ texto, tipo, clienteId, processoId }: SaveMemoryInput): number {
    if (!texto || !texto.trim()) {
      throw new Error("Texto obrigatório para salvar memória");
    }

    const payload = {
      texto: texto.trim(),
      tipo: tipo?.trim() || "desconhecido",
      clienteId: clienteId?.trim?.() ? clienteId.trim() : null,
      processoId: processoId?.trim?.() ? processoId.trim() : null,
    };

    const result = this.insertStmt.run(payload);
    return Number(result.lastInsertRowid);
  }

  listarPorCliente(clienteId: string, limit = 50): LocalMemoryRecord[] {
    if (!clienteId?.trim()) {
      return [];
    }
    return this.listByClienteStmt.all(clienteId.trim(), Math.max(1, limit)) as LocalMemoryRecord[];
  }

  listarPorProcesso(processoId: string, limit = 50): LocalMemoryRecord[] {
    if (!processoId?.trim()) {
      return [];
    }
    return this.listByProcessoStmt.all(processoId.trim(), Math.max(1, limit)) as LocalMemoryRecord[];
  }

  listar({ clienteId, processoId, limit = 50, tipo }: ListMemoryFilters = {}): LocalMemoryRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (clienteId?.trim()) {
      conditions.push("cliente_id = ?");
      params.push(clienteId.trim());
    }
    if (processoId?.trim()) {
      conditions.push("processo_id = ?");
      params.push(processoId.trim());
    }
    if (tipo?.trim()) {
      conditions.push("tipo = ?");
      params.push(tipo.trim());
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT id, texto, tipo, cliente_id AS clienteId, processo_id AS processoId, criado_em AS criadoEm
                   FROM memoria
                  ${whereClause}
                  ORDER BY criado_em DESC
                  LIMIT ?`;

    const stmt = this.db.prepare(sql);
    const max = Math.max(1, limit);
    const rows = stmt.all(...params, max) as LocalMemoryRecord[];
    return rows;
  }
}

const service = new LocalMemoryService(resolveDatabasePath());

export function saveMemoryEntry(input: SaveMemoryInput): number {
  return service.salvar(input);
}

export function listMemoryByCliente(clienteId: string, limit?: number): LocalMemoryRecord[] {
  return service.listarPorCliente(clienteId, limit);
}

export function listMemoryByProcesso(processoId: string, limit?: number): LocalMemoryRecord[] {
  return service.listarPorProcesso(processoId, limit);
}

export function listMemoryEntries(filters?: ListMemoryFilters): LocalMemoryRecord[] {
  return service.listar(filters);
}

export function getLocalMemoryDatabasePath(): string {
    return resolveDatabasePath();
}