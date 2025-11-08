import { Router } from "express";
import db from "../db.js";
import { createManualCase, runDailySync } from "../services/ProcessSyncService.js";
const router = Router();
router.get("/", async (_req, res) => {
    try {
        const rows = db.prepare("SELECT * FROM cases ORDER BY atualizado_em DESC").all();
        res.json(rows);
    }
    catch (error) {
        console.error("[cases] failed to list processes", error);
        res.status(500).json({ error: "Erro ao listar processos" });
    }
});
router.get("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Identificador inválido" });
    }
    try {
        const processo = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
        if (!processo) {
            return res.status(404).json({ error: "Processo não encontrado" });
        }
        const movimentos = db
            .prepare("SELECT * FROM case_movements WHERE case_id=? ORDER BY data DESC")
            .all(id);
        return res.json({ processo, movimentos });
    }
    catch (error) {
        console.error(`[cases] failed to fetch process ${id}`, error);
        return res.status(500).json({ error: "Erro ao buscar processo" });
    }
});
router.post("/", async (req, res) => {
    const { numero_cnj, tribunal, orgao, classe, assunto } = req.body ?? {};
    if (!numero_cnj || !tribunal) {
        return res.status(400).json({ error: "numero_cnj e tribunal são obrigatórios." });
    }
    try {
        const id = await createManualCase({ numero_cnj, tribunal, orgao, classe, assunto });
        const processo = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
        return res.status(201).json(processo);
    }
    catch (error) {
        console.error("[cases] failed to create manual process", error);
        return res.status(500).json({ error: "Erro ao cadastrar processo" });
    }
});
router.post("/sync/run", async (_req, res) => {
    try {
        await runDailySync();
        return res.json({ ok: true });
    }
    catch (error) {
        console.error("[cases] failed to trigger sync", error);
        return res.status(500).json({ error: "Erro ao executar sincronização" });
    }
});
export default router;
