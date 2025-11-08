import { Router } from "express";
import { db } from "../db.js";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import { createManualCase, runDailySync, normalizarCNJ } from "../services/ProcessSyncService.js";
const router = Router();
router.use(requireAuth, attachUser);
router.get("/", (_req, res) => {
    const rows = db.prepare("SELECT * FROM cases ORDER BY atualizado_em DESC").all();
    res.json(rows);
});
router.post("/", async (req, res) => {
    const { numero_cnj, tribunal, orgao, classe, assunto } = req.body || {};
    if (!numero_cnj || !tribunal) {
        return res.status(400).json({ error: "numero_cnj e tribunal são obrigatórios." });
    }
    try {
        const id = await createManualCase({ numero_cnj, tribunal, orgao, classe, assunto });
        const processo = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
        return res.status(201).json(processo);
    }
    catch (error) {
        console.error("[cases] erro ao criar processo manual", error);
        return res.status(500).json({ error: "Erro ao criar processo" });
    }
});
router.post("/sync/run", async (_req, res) => {
    try {
        await runDailySync();
        res.json({ ok: true });
    }
    catch (error) {
        console.error("[cases] erro ao executar sincronização manual", error);
        res.status(500).json({ error: "Falha ao executar sincronização" });
    }
});
router.get("/numero/:numero", (req, res) => {
    const numero = normalizarCNJ(req.params.numero);
    const processo = db.prepare("SELECT * FROM cases WHERE numero_cnj=?").get(numero);
    if (!processo) {
        return res.status(404).json({ error: "Processo não encontrado" });
    }
    const movimentos = db
        .prepare("SELECT * FROM case_movements WHERE case_id=? ORDER BY data DESC")
        .all(processo.id);
    res.json({ processo, movimentos });
});
router.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Identificador inválido" });
    }
    const processo = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
    if (!processo) {
        return res.status(404).json({ error: "Processo não encontrado" });
    }
    const movimentos = db
        .prepare("SELECT * FROM case_movements WHERE case_id=? ORDER BY data DESC")
        .all(id);
    return res.json({ processo, movimentos });
});
export default router;
