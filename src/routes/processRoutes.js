import express, { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db.js";
import { normalizeCNJ } from "../services/pdpjClient.js";
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

const cleanText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
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
    court TEXT,
    jurisdiction TEXT,
    area TEXT,
    status TEXT,
    origin TEXT,
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

  run(`CREATE TABLE IF NOT EXISTS process_parties (
    id TEXT PRIMARY KEY,
    process_id INTEGER NOT NULL,
    role TEXT,
    name TEXT,
    doc TEXT,
    oab TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE
  );`);

  const ensureColumn = (name, def) => {
    try {
      run(`ALTER TABLE processes ADD COLUMN ${name} ${def}`);
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate")) {
        console.error(`[processes] erro ao criar coluna ${name}:`, error);
      }
    }
  };

  ensureColumn("court", "TEXT");
  ensureColumn("jurisdiction", "TEXT");
  ensureColumn("area", "TEXT");
  ensureColumn("status", "TEXT");
  ensureColumn("origin", "TEXT");
  ensureColumn("cnj_number", "TEXT");
  ensureColumn("subject", "TEXT");
  ensureColumn("situation", "TEXT");
  ensureColumn("tribunal", "TEXT");
  ensureColumn("grau", "TEXT");
  ensureColumn("classeCodigo", "TEXT");
  ensureColumn("classeNome", "TEXT");
  ensureColumn("orgaoCodigo", "TEXT");
  ensureColumn("orgaoNome", "TEXT");
  ensureColumn("dataAjuizamento", "TEXT");
  ensureColumn("nivelSigilo", "TEXT");
  ensureColumn("fonte", "TEXT");
  ensureColumn("last_seen_at", "INTEGER");

  const ensureEventColumn = (name, def) => {
    try {
      run(`ALTER TABLE process_events ADD COLUMN ${name} ${def}`);
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate")) {
        console.error(`[process_events] erro ao criar coluna ${name}:`, error);
      }
    }
  };

  ensureEventColumn("codigo", "TEXT");
  ensureEventColumn("nome", "TEXT");
  ensureEventColumn("dataHora", "TEXT");
  ensureEventColumn("raw", "TEXT");
}

ensureTables();

router.use(requireAuth, attachUser);

router.post("/processes/manual", requirePermission("processes:write"), (req, res) => {
  const {
    cnj_number,
    court,
    jurisdiction,
    area,
    subject,
    situation = "Em andamento",
    status = "ativo",
    parties = [],
  } = req.body || {};

  const cnj = normalizeCNJ(cnj_number || "");
  if (!cnj) return res.status(400).json({ error: "invalid_cnj" });

  const digits = cnj.replace(/\D+/g, "");
  const exists = get(
    `SELECT id FROM processes WHERE cnj = ? OR REPLACE(REPLACE(REPLACE(REPLACE(cnj, '.', ''), '-', ''), '/', ''), ' ', '') = ?`,
    [cnj, digits]
  );
  if (exists) return res.status(409).json({ error: "already_exists", id: exists.id });

  const insertParty = db.prepare(
    `INSERT INTO process_parties (id, process_id, role, name, doc, oab)
     VALUES (@id, @process_id, @role, @name, @doc, @oab)`
  );

  const createProcess = db.transaction(() => {
    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO processes (
        cnj, titulo, classe, assunto, comarca, uf, polo, cliente, oab, situacao,
        data_distribuicao, court, jurisdiction, area, status, origin, created_at, updated_at
      ) VALUES (
        @cnj, @titulo, @classe, @assunto, @comarca, NULL, NULL, NULL, NULL, @situacao,
        NULL, @court, @jurisdiction, @area, @status, @origin, @now, @now
      )`
    ).run({
      cnj,
      titulo: cleanText(subject) || cleanText(area),
      classe: cleanText(area),
      assunto: cleanText(subject),
      comarca: cleanText(court),
      situacao: cleanText(situation) || "Em andamento",
      court: cleanText(court),
      jurisdiction: cleanText(jurisdiction),
      area: cleanText(area),
      status: cleanText(status) || "ativo",
      origin: "manual",
      now,
    });

    const processId = info.lastInsertRowid;
    const list = Array.isArray(parties) ? parties : [];
    for (const party of list) {
      insertParty.run({
        id: randomUUID(),
        process_id: processId,
        role: cleanText(party?.role),
        name: cleanText(party?.name),
        doc: cleanText(party?.doc),
        oab: cleanText(party?.oab),
      });
    }
    db.prepare(
      `UPDATE processes SET
         cnj_number = COALESCE(cnj_number, @cnj),
         subject = COALESCE(subject, @subject),
         situation = COALESCE(situation, @situation),
         fonte = COALESCE(fonte, 'manual'),
         last_seen_at = COALESCE(last_seen_at, @last_seen_at)
       WHERE id = @id`
    ).run({
      id: processId,
      cnj,
      subject: cleanText(subject) || cleanText(area),
      situation: cleanText(situation) || "Em andamento",
      last_seen_at: Date.now(),
    });
    return processId;
  });

  try {
    const id = createProcess();
    return res.status(201).json({ id });
  } catch (error) {
    console.error("[processes] manual insert error", error);
    return res.status(500).json({ error: "insert_failed" });
  }
});

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
    const parties = q(
      `SELECT id, role, name, doc, oab
       FROM process_parties
       WHERE process_id = ?
       ORDER BY created_at ASC, id ASC`,
      [row.id]
    );

    return res.json({
      ...row,
      parties,
      court: row.court ?? row.comarca ?? null,
      jurisdiction: row.jurisdiction ?? null,
      area: row.area ?? row.classe ?? null,
      subject: row.assunto ?? null,
      situation: row.situacao ?? null,
    });
  } catch (error) {
    console.error("[processes] detail error", error);
    return res.status(500).json({ error: "Erro ao carregar processo" });
  }
});

router.patch("/processes/:id", requirePermission("processes:write"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }

  const row = get("SELECT id FROM processes WHERE id = ?", [id]);
  if (!row) return res.status(404).json({ error: "not_found" });

  const { court, jurisdiction, area, subject, situation, status } = req.body || {};
  const updates = [];
  const params = { id, now: new Date().toISOString() };

  if (court !== undefined) {
    const text = cleanText(court);
    updates.push("court = @court");
    params.court = text;
    updates.push("comarca = @comarca");
    params.comarca = text;
  }

  if (jurisdiction !== undefined) {
    updates.push("jurisdiction = @jurisdiction");
    params.jurisdiction = cleanText(jurisdiction);
  }

  if (area !== undefined) {
    const text = cleanText(area);
    updates.push("area = @area");
    params.area = text;
    updates.push("classe = @classe");
    params.classe = text;
  }

  if (subject !== undefined) {
    const text = cleanText(subject);
    updates.push("assunto = @assunto");
    params.assunto = text;
  }

  if (situation !== undefined) {
    updates.push("situacao = @situacao");
    params.situacao = cleanText(situation);
  }

  if (status !== undefined) {
    updates.push("status = @status");
    params.status = cleanText(status);
  }

  if (!updates.length) {
    db.prepare("UPDATE processes SET updated_at = @now WHERE id = @id").run(params);
    return res.sendStatus(204);
  }

  updates.push("updated_at = @now");
  db.prepare(`UPDATE processes SET ${updates.join(", ")} WHERE id = @id`).run(params);

  return res.sendStatus(204);
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
      const mapped = rows.map((ev) => {
        let detail = null;
        if (ev.payload) {
          try {
            const parsed = JSON.parse(ev.payload);
            detail = parsed?.detail ?? parsed?.descricao ?? parsed ?? ev.payload;
          } catch {
            detail = ev.payload;
          }
        }
        return {
          ...ev,
          title: ev.descricao,
          detail,
        };
      });
      return res.json(mapped);
    } catch (error) {
      console.error("[processes] events error", error);
      return res.status(500).json({ error: "Erro ao carregar eventos" });
    }
  }
);

router.post("/processes/:id/events", requirePermission("processes:write"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }

  const { title, detail, at } = req.body || {};
  const main = cleanText(title);
  if (!main) return res.status(400).json({ error: "title_required" });

  const exists = get("SELECT id FROM processes WHERE id = ?", [id]);
  if (!exists) return res.status(404).json({ error: "not_found" });

  const timestamp = at !== undefined && at !== null ? Number(at) : Date.now();
  const parsedDate = new Date(timestamp);
  const when = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  db.prepare(
    `INSERT INTO process_events (process_id, tipo, descricao, data_evento, origem, payload)
     VALUES (@process_id, @tipo, @descricao, @data_evento, @origem, @payload)`
  ).run({
    process_id: id,
    tipo: "manual",
    descricao: main,
    data_evento: when.toISOString(),
    origem: "manual",
    payload: detail !== undefined && detail !== null && String(detail).trim().length
      ? JSON.stringify({ detail: String(detail) })
      : null,
  });

  db.prepare(`UPDATE processes SET updated_at = @now WHERE id = @id`).run({
    id,
    now: new Date().toISOString(),
  });

  return res.sendStatus(201);
});

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