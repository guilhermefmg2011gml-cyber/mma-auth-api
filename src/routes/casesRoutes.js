import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";
import { db, upsertProcessoFromDTO } from "../db.js";
import { syncProcessesByOab } from "../services/syncService.js";

const router = Router();

function parseParties(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text;
  if (typeof text !== "string") return [];
  return text
    .split(/;|,|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

router.use(requireAuth, attachUser);

router.get("/processes", requirePermission("cases:read"), (req, res) => {
  const { q = "", situacao = "" } = req.query;

  const clauses = [];
  const params = {};
  if (q) {
    clauses.push("(numero LIKE @term OR classe LIKE @term OR assunto LIKE @term)");
    params.term = `%${q}%`;
  }
  if (situacao) {
    clauses.push("(situacao = @situacao)");
    params.situacao = situacao;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `
    SELECT id, numero, classe, assunto, instancia, situacao, origem, updated_at
    FROM processos
    ${where}
    ORDER BY (updated_at IS NULL) ASC, datetime(updated_at) DESC, id DESC
    LIMIT 200
  `;

  const rows = db.prepare(sql).all(params);
  res.json(rows);
});

router.post("/processes", requirePermission("cases:write"), (req, res) => {
  const payload = req.body || {};
  const numero = (payload.numero || "").trim();
  if (!numero) return res.status(400).json({ error: "NUMERO_REQUIRED" });

  const dto = {
    numero,
    classe: payload.classe,
    assunto: payload.assunto,
    foro: payload.foro,
    vara: payload.vara,
    instancia: payload.instancia,
    situacao: payload.situacao,
    polo_ativo: parseParties(payload.polo_ativo),
    polo_passivo: parseParties(payload.polo_passivo),
    origem: payload.origem || "manual",
  };

  const before = db.prepare(`SELECT id FROM processos WHERE numero = ?`).get(numero);
  const id = upsertProcessoFromDTO(dto);
  if (!id) return res.status(500).json({ error: "UPSERT_FAILED" });

  res.status(before?.id ? 200 : 201).json({ id });
});

router.get("/processes/:id", requirePermission("cases:read"), (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `SELECT id, numero, classe, assunto, instancia, situacao, foro, vara, polo_ativo, polo_passivo, origem, updated_at FROM processos WHERE id = ?`
    )
    .get(id);
  if (!row) return res.status(404).json({ error: "not found" });

  res.json({
    ...row,
    polo_ativo_lista: parseParties(row.polo_ativo),
    polo_passivo_lista: parseParties(row.polo_passivo),
  });
});

router.get("/processes/:id/events", requirePermission("cases:read"), (req, res) => {
  const id = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT id, data_mov, movimento, complemento, origem
       FROM andamentos
       WHERE processo_id = ?
       ORDER BY (data_mov IS NULL) ASC, datetime(data_mov) DESC, id DESC
       LIMIT 500`
    )
    .all(id);
  res.json(rows);
});

router.post("/processes/import", requirePermission("cases:write"), (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Envie 'csv' (texto) no body." });
  }

  const sep = csv.includes(";") ? ";" : ",";
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return res.json({ ok: true, inseridos: 0, atualizados: 0, erros: 0, total: 0 });

  const headerLine = lines.shift();
  const headers = headerLine.split(sep).map((h) => h.trim().toLowerCase());

  const take = (cols, key) => {
    const idx = headers.indexOf(key);
    if (idx === -1) return "";
    return cols[idx] ?? "";
  };

  let inseridos = 0;
  let atualizados = 0;
  let erros = 0;

  for (const line of lines) {
    const cols = line.split(sep).map((c) => c.trim());
    const numero = take(cols, "numero");
    if (!numero) {
      erros++;
      continue;
    }
    const dto = {
      numero,
      classe: take(cols, "classe"),
      assunto: take(cols, "assunto"),
      instancia: take(cols, "instancia"),
      situacao: take(cols, "situacao") || "em andamento",
      foro: take(cols, "foro"),
      vara: take(cols, "vara"),
      polo_ativo: parseParties(take(cols, "polo_ativo")),
      polo_passivo: parseParties(take(cols, "polo_passivo")),
      origem: "csv",
    };
    try {
      const before = db.prepare(`SELECT id FROM processos WHERE numero = ?`).get(dto.numero);
      const id = upsertProcessoFromDTO(dto);
      if (!id) {
        erros++;
        continue;
      }
      if (before?.id) atualizados++;
      else inseridos++;
    } catch (error) {
      console.error("csv import error:", error);
      erros++;
    }
  }

  res.json({ ok: true, inseridos, atualizados, erros, total: lines.length });
});

router.post("/processes/sync-oab", requirePermission("cases:link"), async (req, res) => {
  try {
    const { oab, uf, ingerir = true } = req.body || {};
    const result = await syncProcessesByOab({ oab, uf, ingest: ingerir !== false });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error("/processes/sync-oab error:", error);
    return res.status(500).json({ ok: false, error: error?.message || "Erro interno" });
  }
});

export default router;