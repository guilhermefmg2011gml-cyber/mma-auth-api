import { Router } from "express";
import db from "../db.js";
import { createManualCase, runDailySync } from "../services/ProcessSyncService.js";

const router = Router();

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
router.post("/sync/run", async (_req, res) => {
  try {
    runDailySync().catch((error) => {
      console.error("runDailySync async error:", error);
    });
    res.json({ ok: true, message: "Sincronização iniciada." });
  } catch (error) {
    console.error("POST /api/cases/sync/run error:", error);
    res.status(500).json({ error: "Erro ao iniciar sincronização" });
  }
});

export default router;