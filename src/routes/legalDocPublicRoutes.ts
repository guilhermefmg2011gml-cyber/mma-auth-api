import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  buildDocxFromPiece,
  generateLegalDocument,
  getGeneratedPiece,
  refineDocumentTopic,
  storeGeneratedPiece,
  type GenerateLegalDocumentInput,
  MissingRequiredFieldsError,
} from "../services/legalDocGenerator.js";
import {
  normalizeDocumentList,
  parsePartes,
  parseTipoPeca,
  sanitizeText,
} from "./utils/legalDocRequest.js";

const router = Router();

router.post("/gerar", async (req, res) => {
  try {
    const body = req.body ?? {};

    const tipoPeca = parseTipoPeca(body.tipo_peca);
    if (!tipoPeca) {
      return res.status(400).json({ error: "TIPO_PECA_INVALIDO" });
    }

    const partes = parsePartes(body.partes);
    const pedidos = sanitizeText(body.pedidos);
    const documentos = normalizeDocumentList(body.documentos);
    const clienteId = sanitizeText(body.cliente_id);

    const payload: GenerateLegalDocumentInput = {
      tipoPeca,
      resumoFatico: sanitizeText(body.resumo_fatico) ?? "",
      partes,
    };

    if (pedidos) {
      payload.pedidos = pedidos;
    }

    if (documentos) {
      payload.documentos = documentos;
    }

    if (clienteId) {
      payload.clienteId = clienteId;
    }

    const resultado = await generateLegalDocument(payload);
    const id = uuidv4();

    storeGeneratedPiece(id, {
      tipo: payload.tipoPeca,
      texto: resultado.texto,
      createdAt: new Date(),
      artigos: resultado.artigos,
    });

    return res.json({
      id,
      tipo: payload.tipoPeca,
      texto_gerado: resultado.texto,
      jurisprudencias_sugeridas: resultado.jurisprudencias.map((item) => ({
        titulo: item.title ?? null,
        resumo: item.snippet ?? item.content ?? null,
        url: item.url ?? null,
        publicado_em: item.publishedAt ?? null,
      })),
      artigos_validados: resultado.artigos.map((item) => ({
        artigo: item.artigo,
        confirmado: item.confirmado,
        referencia: item.referencia ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof MissingRequiredFieldsError) {
      return res.status(422).json({
        error: "CAMPOS_OBRIGATORIOS",
        campos: error.campos,
        message: error.message,
      });
    }

    console.error("[publicLegalDoc] erro ao gerar peça", error);
    const message = error instanceof Error ? error.message : "ERRO_INTERNO";
    return res.status(500).json({ error: "ERRO_GERACAO_PECA", message });
  }
});

router.post("/aprimorar-topico", async (req, res) => {
  try {
    const body = req.body ?? {};
    const tipoPeca = parseTipoPeca(body.tipo_peca);
    if (!tipoPeca) {
      return res.status(400).json({ error: "TIPO_PECA_INVALIDO" });
    }

    const bloco = sanitizeText(body.topico) ?? sanitizeText(body.bloco);
    if (!bloco) {
      return res.status(400).json({ error: "TOPICO_OBRIGATORIO" });
    }

    const conteudoAtual = sanitizeText(body.conteudo_atual);
    if (!conteudoAtual) {
      return res.status(400).json({ error: "CONTEUDO_ATUAL_OBRIGATORIO" });
    }

    const novasInformacoes = sanitizeText(body.novas_informacoes) ?? undefined;
    const pesquisaComplementar = sanitizeText(body.pesquisa_complementar) ?? undefined;
    const clienteId = sanitizeText(body.cliente_id) ?? undefined;
    const partes = parsePartes(body.partes);
    const topK = typeof body.top_k === "number" && Number.isFinite(body.top_k) ? body.top_k : undefined;

    const resultado = await refineDocumentTopic({
      tipoPeca,
      blocoTitulo: bloco,
      conteudoAtual,
      novasInformacoes,
      clienteId,
      partes,
      pesquisaComplementar,
      topKMemoria: topK,
    });

    return res.json({
      texto_reescrito: resultado.texto,
      memoria_relacionada: resultado.memoria,
      jurisprudencias: resultado.jurisprudencias.map((item) => ({
        titulo: item.title ?? null,
        resumo: item.snippet ?? item.content ?? null,
        url: item.url ?? null,
        publicado_em: item.publishedAt ?? null,
      })),
    });
  } catch (error) {
    console.error("[publicLegalDoc] erro ao aprimorar tópico", error);
    const message = error instanceof Error ? error.message : "ERRO_INTERNO";
    return res.status(500).json({ error: "ERRO_REESCREVER_TOPICO", message });
  }
});

router.get("/exportar/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "ID_OBRIGATORIO" });
  }

  const piece = getGeneratedPiece(id);
  if (!piece) {
    return res.status(404).json({ error: "PECA_NAO_ENCONTRADA" });
  }

  try {
    const buffer = await buildDocxFromPiece(piece);
    const filename = `peca_${id}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("[publicLegalDoc] erro ao exportar peça", error);
    return res.status(500).json({ error: "ERRO_EXPORTAR_PECA" });
  }
});

export default router;