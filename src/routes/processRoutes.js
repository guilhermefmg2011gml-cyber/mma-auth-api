import express from "express";
import { db } from "../db.js";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";

const router = express.Router();

const q = (sql, params = []) => {
  const stmt = db.prepare(sql);
  if (Array.isArray(params)) {
    return stmt.all(...params);
  }
  return stmt.all(params);
};

const run = (sql, params = []) => {
  const stmt = db.prepare(sql);
  if (Array.isArray(params)) {
    return stmt.run(...params);
  }
  return stmt.run(params);
};

const get = (sql, params = []) => {
  const stmt = db.prepare(sql);
  if (Array.isArray(params)) {
    return stmt.get(...params);
  }
  return stmt.get(params);
};

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const headerLine = lines.shift();
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ";" : ",";

  const headers = splitCsvLine(headerLine, delimiter).map((h) => h.trim());
  const rows = [];

  for (const line of lines) {
    const cells = splitCsvLine(line, delimiter);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    rows.push(record);
  }

  return rows;
}

function ensureTables() {
  run(`CREATE TABLE IF NOT EXISTS processes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cnj TEXT UNIQUE NOT NULL,
    titulo TEXT,
    classe TEXT,
    assunto TEXT,
    comarca TEXT,
    uf TEXT,
    polo TEXT,
    cliente TEXT,
    oab TEXT,
    situacao TEXT,
    data_distribuicao TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`);

  run(`CREATE TABLE IF NOT EXISTS process_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id INTEGER NOT NULL,
    tipo TEXT,
    descricao TEXT NOT NULL,
    data_evento TEXT NOT NULL,
    origem TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(process_id) REFERENCES processes(id)
  );`);
}

ensureTables();

router.use(requireAuth, attachUser);

router.get("/processes", requirePermission("cases:read"), (req, res) => {
  const { q: term, uf, oab } = req.query;
  let sql = "SELECT * FROM processes WHERE 1=1";
  const params = [];

  if (term) {
    sql += " AND (cnj LIKE ? OR titulo LIKE ? OR assunto LIKE ?)";
    const like = `%${term}%`;
    params.push(like, like, like);
  }
  if (uf) {
    sql += " AND uf = ?";
    params.push(uf);
  }
  if (oab) {
    sql += " AND oab = ?";
    params.push(oab);
  }

  sql += " ORDER BY datetime(updated_at) DESC, id DESC LIMIT 200";

  try {
    const rows = q(sql, params);
    return res.json(rows);
  } catch (error) {
    console.error("[processes] list error", error);
    return res.status(500).json({ error: "Erro ao carregar processos" });
  }
});

router.get("/processes/:id", requirePermission("cases:read"), (req, res) => {
  try {
    const row = get("SELECT * FROM processes WHERE id = ?", [req.params.id]);
    if (!row) {
      return res.status(404).json({ error: "processo não encontrado" });
    }
    return res.json(row);
  } catch (error) {
    console.error("[processes] detail error", error);
    return res.status(500).json({ error: "Erro ao carregar processo" });
  }
});

router.get(
  "/processes/:id/events",
  requirePermission("cases:read"),
  (req, res) => {
    try {
      const rows = q(
        `SELECT id, tipo, descricao, data_evento, origem, payload, created_at
         FROM process_events
         WHERE process_id = ?
         ORDER BY datetime(data_evento) DESC, id DESC`,
        [req.params.id]
      );
      return res.json(rows);
    } catch (error) {
      console.error("[processes] events error", error);
      return res.status(500).json({ error: "Erro ao carregar eventos" });
    }
  }
);

const textParser = express.text({ type: "*/*", limit: "10mb" });

router.post(
  "/processes/import-csv",
  requirePermission("cases:write"),
  textParser,
  (req, res) => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Somente administradores podem importar CSV" });
    }

    try {
      const csvText = typeof req.body === "string" ? req.body : req.body?.toString?.() || "";
      if (!csvText.trim()) {
        return res.status(400).json({ error: "CSV vazio" });
      }

      const rows = parseCsv(csvText);

      if (!Array.isArray(rows) || !rows.length) {
        return res.json({ ok: true, rows: 0, created: 0, updated: 0, skipped: 0 });
      }

      const upsert = db.prepare(`
        INSERT INTO processes (
          cnj, titulo, classe, assunto, comarca, uf, polo, cliente, oab, situacao, data_distribuicao, updated_at
        ) VALUES (
          @cnj, @titulo, @classe, @assunto, @comarca, @uf, @polo, @cliente, @oab, @situacao, @data_distribuicao, datetime('now')
        )
        ON CONFLICT(cnj) DO UPDATE SET
          titulo = excluded.titulo,
          classe = excluded.classe,
          assunto = excluded.assunto,
          comarca = excluded.comarca,
          uf = excluded.uf,
          polo = excluded.polo,
          cliente = excluded.cliente,
          oab = excluded.oab,
          situacao = excluded.situacao,
          data_distribuicao = excluded.data_distribuicao,
          updated_at = datetime('now')
      `);

      const insertEvent = db.prepare(`
        INSERT INTO process_events (process_id, tipo, descricao, data_evento, origem, payload)
        VALUES (?, 'andamento', ?, ?, 'CSV', ?)
      `);

      const getByCnj = db.prepare("SELECT id FROM processes WHERE cnj = ?");

      let created = 0;
      let updated = 0;
      let skipped = 0;

      const trx = db.transaction(() => {
        for (const raw of rows) {
          const cnj = (raw?.cnj || "").trim();
          if (!cnj) {
            skipped += 1;
            continue;
          }

          const uf = raw.uf ? String(raw.uf).trim().toUpperCase() : null;
          const oab = raw.oab ? String(raw.oab).trim().toUpperCase() : null;

          const exists = getByCnj.get(cnj);
          upsert.run({
            cnj,
            titulo: raw.titulo ? String(raw.titulo).trim() : null,
            classe: raw.classe ? String(raw.classe).trim() : null,
            assunto: raw.assunto ? String(raw.assunto).trim() : null,
            comarca: raw.comarca ? String(raw.comarca).trim() : null,
            uf,
            polo: raw.polo ? String(raw.polo).trim() : null,
            cliente: raw.cliente ? String(raw.cliente).trim() : null,
            oab,
            situacao: raw.situacao ? String(raw.situacao).trim() : null,
            data_distribuicao: raw.data_distribuicao ? String(raw.data_distribuicao).trim() : null,
          });

          const record = getByCnj.get(cnj);
          if (!record?.id) {
            skipped += 1;
            continue;
          }

          if (exists?.id) updated += 1;
          else created += 1;

          if (raw.evento_descricao || raw.evento_data) {
            const descricao = raw.evento_descricao || "Evento importado (CSV)";
            let dataEvento = raw.evento_data || null;
            if (dataEvento) {
              const parsed = new Date(dataEvento);
              dataEvento = Number.isNaN(parsed.getTime()) ? dataEvento : parsed.toISOString();
            }
            if (!dataEvento) {
              dataEvento = new Date().toISOString();
            }
            const payload = JSON.stringify(raw ?? {});
            insertEvent.run(record.id, descricao, dataEvento, payload);
          }
        }
      });

      trx();

      return res.json({ ok: true, rows: rows.length, created, updated, skipped });
    } catch (error) {
      console.error("[processes] CSV import error", error);
      return res.status(500).json({ error: "falha ao importar CSV" });
    }
  }
);

export default router;