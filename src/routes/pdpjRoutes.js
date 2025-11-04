import { Router, raw } from "express";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";
import { getPdpjToken } from "../integrations/pdpjAuth.js";
import { pdpjGET } from "../integrations/pdpjClient.js";
import { upsertProcessoFromDTO, insertAndamentosDedup } from "../db.js";
import crypto from "crypto";

const router = Router();

router.post(
  "/webhook",
  raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    try {
      const secret = process.env.PDPJ_WEBHOOK_SECRET;
      if (!secret) return res.status(500).json({ error: "Webhook SECRET não configurado" });

      const rawBody = req.body; // Buffer
      const bodyStr = rawBody?.toString("utf8") || "";

      const sigHeader =
        req.get("x-pdpj-signature") ||
        req.get("x-signature") ||
        req.get("x-hub-signature") ||
        "";

      if (!sigHeader) {
        return res.status(400).json({ error: "Assinatura ausente (x-pdpj-signature)" });
      }

      let provided = sigHeader.trim();
      if (provided.startsWith("sha256=")) provided = provided.slice(7);

      const computed = crypto.createHmac("sha256", secret).update(bodyStr, "utf8").digest("hex");

      const okSig =
        provided.length === computed.length &&
        crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(computed, "hex"));

      if (!okSig) {
        return res.status(401).json({ error: "Assinatura inválida" });
      }

      let payload = {};
      try {
        payload = JSON.parse(bodyStr);
      } catch {
        return res.status(415).json({ error: "Conteúdo não é JSON válido" });
      }

      const numero =
        payload.numero_cnj ||
        payload.numero ||
        payload.nup ||
        (payload.processo && (payload.processo.numero_cnj || payload.processo.numero)) ||
        "";

      if (!numero) {
        return res.status(400).json({ error: "Payload sem número de processo" });
      }

      const dto = {
        numero,
        classe: payload.classe || payload.processo?.classe || "",
        assunto: payload.assunto || payload.processo?.assunto || "",
        foro: payload.foro || payload.processo?.orgao || payload.orgao || "",
        vara: payload.vara || "",
        instancia: payload.instancia || payload.grau || "",
        situacao: payload.situacao || payload.situacao_processo || "em andamento",
        polo_ativo: payload.polo_ativo || payload.partes_ativas?.map?.((x) => x.nome) || [],
        polo_passivo: payload.polo_passivo || payload.partes_passivas?.map?.((x) => x.nome) || [],
        origem: "pdpj",
      };

      const processId = upsertProcessoFromDTO(dto);

      let movimentos = [];
      if (Array.isArray(payload.eventos)) movimentos = payload.eventos;
      else if (Array.isArray(payload.andamentos)) movimentos = payload.andamentos;
      else if (Array.isArray(payload.movimentos)) movimentos = payload.movimentos;
      else if (payload.evento) movimentos = [payload.evento];

      movimentos = movimentos.map((ev) => ({
        data: ev.data || ev.data_mov || ev.timestamp || ev.data_evento || null,
        movimento: ev.movimento || ev.tipo || ev.evento || ev.descricao || "",
        complemento: ev.complemento || ev.detalhe || ev.observacao || "",
      }));

      const inseridos = insertAndamentosDedup(processId, numero, movimentos, "pdpj");

      return res.json({ ok: true, numero, processId, eventos_ingest: inseridos });
    } catch (e) {
      console.error("webhook PDPJ error:", e);
      return res.status(500).json({ error: "Erro interno", detail: String(e) });
    }
  }
);

router.use(requireAuth, attachUser);

router.get("/test", requirePermission("cases:link"), async (_req, res) => {
  try {
    const token = await getPdpjToken();
    let ping = null;
    try {
      ping = await pdpjGET("/status").catch((err) => ({ ok: false, detail: String(err) }));
    } catch (e) {
      ping = { ok: false, detail: String(e) };
    }
    res.json({ ok: true, tokenPreview: token?.slice?.(0, 24) + "...", ping });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e) });
  }
});

export default router;