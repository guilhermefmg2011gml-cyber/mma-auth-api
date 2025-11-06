import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import requirePermission from "../middleware/requirePermission.js";
import { toFormattedCNJ } from "../lib/cnj.js";
import { searchNumero } from "../clients/datajudClient.js";
import { datajudPOST, DatajudError } from "../clients/datajudHttp.js";
import { datajudScroll } from "../services/datajud.js";
import {
  mapDatajudSource,
  upsertProcessFromDatajud,
  insertEventsFromDatajud,
} from "../services/processes.js";
import db from "../db.js";

const router = Router();

function getAliases(app) {
  const aliases = app?.get("DATAJUD_ALIASES");
  if (Array.isArray(aliases)) return Array.from(aliases);
  return [];
}

function findProcessId(numero) {
  return db.prepare(`SELECT id FROM processes WHERE cnj = ? OR cnj_number = ? LIMIT 1`).get(numero, numero);
}

router.get("/datajud/aliases", requireAuth, (req, res) => {
  res.json({ aliases: getAliases(req.app) });
});

// Busca por CNJ (aceita com ou sem máscara no query param `numero`)
router.get("/datajud/search/numero", requireAuth, async (req, res) => {
  try {
    const rawNumero = String(req.query.numero || "").trim();
    const modeRaw = String(req.query.mode || "exact").toLowerCase();
    const aliasFilter = String(req.query.alias || "").trim();

  if (!rawNumero) {
      return res.status(400).json({ error: "numero requerido" });
    }

  const normalizedMode = modeRaw === "prefix" ? "prefix" : modeRaw === "exact" ? "exact" : null;
    if (!normalizedMode) {
      return res.status(400).json({ error: "mode inválido (use exact ou prefix)" });
    }

    const isExact = normalizedMode === "exact";
    const normalized = toFormattedCNJ(rawNumero);
    if (isExact && !normalized) {
      return res.status(400).json({
        error: "CNJ inválido (esperado 20 dígitos -> 0000000-00.0000.0.00.0000)",
      });
    }

    const numero = isExact ? normalized : rawNumero;
    const aliases = aliasFilter ? [aliasFilter] : getAliases(req.app);

    if (!aliases.length) {
      return res.json({ numero, results: [] });
    }

    const results = [];
    for (const alias of aliases) {
      try {
        const r = await searchNumero({ alias, numero, mode: normalizedMode });
        results.push({ alias, ok: true, status: 200, ...r });
      } catch (error) {
        const status = error instanceof DatajudError ? error.status || 400 : 400;
        const detail =
          error instanceof DatajudError
            ? error.body || error.message
            : error?.message || String(error);
        results.push({
          alias,
          ok: false,
          status,
          error: `Datajud ${alias} ${status}: ${String(detail).slice(0, 300)}`,
        });
      }
    }

    res.json({ numero, results, mode: normalizedMode });
  } catch (err) {
    res.status(500).json({ error: "internal_error", detail: String(err?.message || err) });
  }
});

// Busca por texto usando query_string (alias obrigatório)
router.get("/datajud/search/text", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const alias = String(req.query.alias || "").trim();

    if (!q) return res.status(400).json({ error: "q requerido" });
    if (!alias) return res.status(400).json({ error: "alias requerido" });

    const body = {
      size: 5,
      query: {
        query_string: {
          default_field: "numeroProcesso",
          query: `"${q}" OR ${q}*`,
        },
      },
    };

    const result = await datajudPOST(alias, "/_search", body);
    const hits = result?.hits?.hits ?? [];
    const count = result?.hits?.total?.value ?? hits.length;

    res.json({
      q,
      alias,
      count,
      first: hits[0]?._source ?? null,
    });
  } catch (err) {
    const status = err instanceof DatajudError ? err.status || 500 : 500;
    const detail = err instanceof DatajudError ? err.body || err.message : err?.message || err;
    res.status(status).json({ error: "internal_error", detail: String(detail) });
  }
});

// Rota de diagnóstico (opcional): testa 1 alias e devolve a mensagem crua de erro do provedor
router.get("/datajud/debug/alias", requireAuth, async (req, res) => {
  const alias = String(req.query.alias || "").trim();
  const cnj = toFormattedCNJ(req.query.numero || "");
  if (!alias) return res.status(400).json({ error: "alias obrigatório" });
  if (!cnj) return res.status(400).json({ error: "CNJ inválido (20 dígitos)" });

  try {
    const result = await searchNumero({ alias, numero: cnj, mode: "exact" });
    return res.json({
      alias,
      numero: cnj,
      count: result.count,
      sample: result.first || null,
    });
  } catch (e) {
    const status = e instanceof DatajudError ? e.status || 502 : 502;
    const detail = e instanceof DatajudError ? e.body || e.message : e?.message || e;
    return res.status(status).json({ alias, numero: cnj, error: String(detail) });
  }
});

// GET /api/datajud/:numero  -> busca por CNJ nos aliases e salva/atualiza
router.get("/datajud/:numero", requireAuth, async (req, res) => {
  const numero = toFormattedCNJ(req.params.numero || "");
  if (!numero) return res.status(400).json({ ok: false, error: "CNJ inválido" });

  for (const alias of getAliases(req.app)) {
    try {
      const { first } = await searchNumero({ alias, numero, mode: "exact" });
      if (first) {
        const mapped = mapDatajudSource(first);
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
  const aliases = (req.body?.aliases?.length ? req.body.aliases : getAliases(req.app)) || [];
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