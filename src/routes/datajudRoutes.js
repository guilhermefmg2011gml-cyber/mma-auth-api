import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import requirePermission from "../middleware/requirePermission.js";
import { toFormattedCNJ } from "../lib/cnj.js";
import { datajudSearchByCNJ, datajudScroll } from "../services/datajud.js";
import { mapDatajudSource, upsertProcessFromDatajud, insertEventsFromDatajud } from "../services/processes.js";
import db from "../db.js";
import { DATAJUD_ALIASES } from "../config/datajud.js";

const router = Router();

const ALIASES = Array.from(DATAJUD_ALIASES || []);

function getAliases() {
  return Array.from(ALIASES);
}

function findProcessId(numero) {
  return db.prepare(`SELECT id FROM processes WHERE cnj = ? OR cnj_number = ? LIMIT 1`).get(numero, numero);
}

router.get("/datajud/aliases", requireAuth, (_req, res) => {
  res.json({ aliases: getAliases() });
});

// Busca por CNJ (aceita com ou sem máscara no query param `numero`)
router.get("/datajud/search/numero", requireAuth, async (req, res) => {
  const raw = String(req.query.numero || "").trim();
  const cnj = toFormattedCNJ(raw);
  if (!cnj) {
    return res
      .status(400)
      .json({ error: "CNJ inválido (esperado 20 dígitos -> 0000000-00.0000.0.00.0000)" });
  }

  const aliases = getAliases();
  if (!aliases.length) {
    return res.status(500).json({ error: "aliases_not_configured" });
  }

  const results = [];
  for (const alias of aliases) {
    try {
      const hits = await datajudSearchByCNJ(alias, cnj);
      const count = Array.isArray(hits) ? hits.length : 0;
      results.push({
        alias,
        ok: true,
        status: 200,
        count,
        first: count ? (hits[0]?._source || hits[0]) : null,
      });
    } catch (e) {
      results.push({
        alias,
        ok: false,
        status: 400,
        error: String(e.message).slice(0, 300),
      });
    }
  }

  return res.json({ numero: cnj, results });
});

// Rota de diagnóstico (opcional): testa 1 alias e devolve a mensagem crua de erro do provedor
router.get("/datajud/debug/alias", requireAuth, async (req, res) => {
  const alias = String(req.query.alias || "").trim();
  const cnj = toFormattedCNJ(req.query.numero || "");
  if (!alias) return res.status(400).json({ error: "alias obrigatório" });
  if (!cnj) return res.status(400).json({ error: "CNJ inválido (20 dígitos)" });

  try {
    const hits = await datajudSearchByCNJ(alias, cnj);
    return res.json({
      alias,
      numero: cnj,
      count: hits.length,
      sample: hits[0] || null,
    });
  } catch (e) {
    return res.status(502).json({ alias, numero: cnj, error: String(e.message) });
  }
});

// GET /api/datajud/:numero  -> busca por CNJ nos aliases e salva/atualiza
router.get("/datajud/:numero", requireAuth, async (req, res) => {
  const numero = toFormattedCNJ(req.params.numero || "");
  if (!numero) return res.status(400).json({ ok: false, error: "CNJ inválido" });

  for (const alias of getAliases()) {
    try {
      const hits = await datajudSearchByCNJ(alias, numero);
      const hit = hits?.[0];
      if (hit?._source) {
        const mapped = mapDatajudSource(hit._source);
        const pid = upsertProcessFromDatajud(mapped);
        const ing = insertEventsFromDatajud(pid, mapped.numero, mapped.eventos || []);
        return res.json({ ok: true, alias, id: pid, eventos_ingest: ing });
      }
    } catch (e) {
      console.error("Datajud search error", alias, e.message);
    }
  }
  res.status(404).json({ ok: false, message: "Não encontrado nos aliases configurados" });
});

// POST /api/datajud/sync -> { aliases?:[], query?:{}, size?:200 }
router.post("/datajud/sync", requireAuth, requirePermission("processes:sync"), async (req, res) => {
  const aliases = (req.body?.aliases?.length ? req.body.aliases : getAliases()) || [];
  const dsl = {
    size: Math.min(Math.max(Number(req.body?.size || 200), 50), 500),
    query: req.body?.query || { match_all: {} },
  };

  let totalHits = 0;
  let totalNew = 0;
  let totalEvents = 0;

  for (const alias of aliases) {
    try {
      await datajudScroll(alias, dsl, async (page) => {
        totalHits += page.length;
        for (const h of page) {
          const src = h?._source;
          if (!src) continue;
          const mapped = mapDatajudSource(src);
          if (!mapped?.numero) continue;
          const before = findProcessId(mapped.numero);
          const pid = upsertProcessFromDatajud(mapped);
          if (!before?.id) totalNew++;
          totalEvents += insertEventsFromDatajud(pid, mapped.numero, mapped.eventos || []);
        }
      });
    } catch (e) {
      console.error("Datajud sync error", alias, e.message);
    }
  }

  res.json({ ok: true, aliases, totalHits, totalNew, totalEvents });
});

export default router;