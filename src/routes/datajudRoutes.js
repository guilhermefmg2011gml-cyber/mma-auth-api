import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import requirePermission from "../middleware/requirePermission.js";
import { datajudSearchByCNJ, datajudScroll } from "../services/datajud.js";
import { mapDatajudSource, upsertProcessFromDatajud, insertEventsFromDatajud, normalizeCNJ } from "../services/processes.js";
import db from "../db.js";
import { DATAJUD_ALIASES, DATAJUD_API_BASE, DATAJUD_API_KEY } from "../config/datajud.js";

const router = Router();
function getAliases() {
  return Array.from(DATAJUD_ALIASES);
}

function findProcessId(numero) {
  return db.prepare(`SELECT id FROM processes WHERE cnj = ? OR cnj_number = ? LIMIT 1`).get(numero, numero);
}

router.get("/datajud/aliases", requireAuth, (_req, res) => {
  res.json({ aliases: getAliases() });
});

router.get("/datajud/search/numero", requireAuth, async (req, res) => {
  const numero = (req.query.numero || "").trim();
  if (!numero) {
    return res.status(400).json({ error: "missing_numero" });
  }

  const aliases = getAliases();
  if (!aliases.length) {
    return res.status(500).json({ error: "aliases_not_configured" });
  }
  if (!DATAJUD_API_KEY) {
    return res.status(500).json({ error: "api_key_not_configured" });
  }

  try {
    const results = [];
    for (const alias of aliases) {
      const url = `${DATAJUD_API_BASE}/${alias}/processos/${encodeURIComponent(numero)}`;
      try {
        const response = await fetch(url, {
          headers: {
            "x-api-key": DATAJUD_API_KEY,
            Authorization: `APIKey ${DATAJUD_API_KEY}`,
          },
        });

        if (!response.ok) {
          results.push({ alias, ok: false, status: response.status });
          continue;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          const text = await response.text();
          results.push({ alias, ok: false, status: response.status, error: "invalid_content_type", preview: text.slice(0, 200) });
          continue;
        }

        const data = await response.json();
        results.push({ alias, ok: true, status: response.status, data });
      } catch (error) {
        results.push({ alias, ok: false, status: 0, error: error?.message || String(error) });
      }
    }

    return res.json({ numero, results });
  } catch (error) {
    console.error("[datajud] search error", error?.message || error);
    return res.status(502).json({ error: "upstream_error" });
  }
});

// GET /api/datajud/:numero  -> busca por CNJ nos aliases e salva/atualiza
router.get("/datajud/:numero", requireAuth, async (req, res) => {
  const numero = normalizeCNJ(req.params.numero);
  if (!numero) return res.status(400).json({ ok: false, error: "CNJ inválido" });

  for (const alias of getAliases()) {
    try {
      const json = await datajudSearchByCNJ(alias, numero);
      const hit = json?.hits?.hits?.[0];
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