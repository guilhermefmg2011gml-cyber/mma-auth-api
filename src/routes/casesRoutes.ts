import { Router } from "express";
import db from "../db.js";
import { searchProcessesByLawyer } from "../integrations/tavilyClient.js";
import attachUser from "../middleware/attachUser.js";
import requireAuth from "../middleware/requireAuth.js";
import { createManualCase } from "../services/ProcessSyncService.js";
import { syncCasesFromTavily } from "../services/casesSync.js";

const router = Router();

// rota pública, sem verificação JWT
router.get("/tavily", async (req, res) => {
  try {
    const rawName =
      (typeof req.query.nome === "string" && req.query.nome.trim()) ||
      (typeof req.query.name === "string" && req.query.name.trim()) ||
      (typeof req.query.lawyer === "string" && req.query.lawyer.trim()) ||
      "";
    const rawOab =
      (typeof req.query.oab === "string" && req.query.oab.trim()) ||
      (typeof req.query.inscricao === "string" && req.query.inscricao.trim()) ||
      (typeof req.query.registration === "string" && req.query.registration.trim()) ||
      "";

    if (!rawName || !rawOab) {
      return res.status(400).json({
        error: "PARAMETROS_OBRIGATORIOS",
        required: ["nome", "oab"],
      });
    }

    const processos = await searchProcessesByLawyer(rawName, rawOab);
    return res.json(processos);
  } catch (error) {
    console.error("GET /api/cases/tavily error:", error);
    return res.status(500).json({ error: "Erro ao consultar Tavily" });
  }
});

/**
 * Lista todos os processos cadastrados
 */
router.get("/", async (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, numero_cnj, tribunal, orgao, classe, assunto, atualizado_em FROM cases ORDER BY atualizado_em DESC`
      )
      .all();

    res.json(rows);
  } catch (error) {
    console.error("GET /api/cases error:", error);
    res.status(500).json({ error: "Erro ao listar processos" });
  }
});

/**
 * Cadastro manual de processo
 */
router.post("/", async (req, res) => {
  try {
    const rawNumero = req.body?.numero_cnj;
    const rawTribunal = req.body?.tribunal;
    const rawOrgao = req.body?.orgao;
    const rawClasse = req.body?.classe;
    const rawAssunto = req.body?.assunto;

    const numero_cnj = typeof rawNumero === "string" ? rawNumero.trim() : rawNumero;
    const tribunal = typeof rawTribunal === "string" ? rawTribunal.trim() : rawTribunal;
    const orgao = typeof rawOrgao === "string" ? rawOrgao.trim() : rawOrgao;
    const classe = typeof rawClasse === "string" ? rawClasse.trim() : rawClasse;
    const assunto = typeof rawAssunto === "string" ? rawAssunto.trim() : rawAssunto;

    if (!numero_cnj || !tribunal) {
      return res
        .status(400)
        .json({ error: "Número CNJ e Tribunal são obrigatórios." });
    }

    const id = await createManualCase({
      numero_cnj,
      tribunal,
      orgao: orgao || undefined,
      classe: classe || undefined,
      assunto: assunto || undefined,
    });

    const processo = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
    res.status(201).json(processo);
  } catch (error) {
    console.error("POST /api/cases error:", error);
    res.status(500).json({ error: "Erro ao cadastrar processo" });
  }
});

/**
 * Movimentações com prazo pendente (para painel “Movimentações com prazo”)
 * Retorna uma lista enxuta: processo + info de prazo.
 */
router.get("/pending", async (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT
          c.id as case_id,
          c.numero_cnj,
          c.tribunal,
          m.id as movement_id,
          m.data,
          m.descricao,
          m.prazo_final
        FROM case_movements m
        JOIN cases c ON c.id = m.case_id
        WHERE m.exige_acao = 1
          AND m.status = 'pendente'
        ORDER BY (m.prazo_final IS NULL), m.prazo_final ASC, m.data ASC`
      )
      .all();

    res.json(rows);
  } catch (error) {
    console.error("GET /api/cases/pending error:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar movimentações com prazo pendente" });
  }
});

/**
 * Sincronização manual (botão “Sincronizar agora” no painel)
 */
router.post("/sync/run", requireAuth, attachUser, async (_req, res) => {
  try {
    const result = await syncCasesFromTavily();
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("sync/run error:", message);
    return res.status(500).json({
      ok: false,
      error: "SYNC_FAILED",
      detail: message,
    });
  }
});

export default router;