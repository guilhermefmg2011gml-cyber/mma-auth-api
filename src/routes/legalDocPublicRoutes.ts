import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  PieceNotFoundError,
  TopicNotFoundError,
  buildDocxFromPiece,
  generateLegalDocument,
  getGeneratedPiece,
  refineDocumentTopic,
  refineStoredPieceTopic,
  storeGeneratedPiece,
  MissingRequiredFieldsError,
  inferClienteNome,
  type GenerateLegalDocumentInput,
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

    const clienteNome = inferClienteNome(partes, clienteId);

    storeGeneratedPiece(id, {
      tipo: payload.tipoPeca,
      texto: resultado.texto,
      createdAt: new Date(),
      artigos: resultado.artigos,
      cliente: clienteNome,
      clienteId: clienteId ?? null,
      partes: partes.map((parte) => ({ ...parte })),
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
      memoriaTipo: "topico",
      memoriaMetadados: {
        origem: "refinamento_publico",
        tipoPeca,
      },
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

const MEMORIA_TIPOS_VALIDOS = new Set([
  "peça",
  "topico",
  "jurisprudencia",
  "doutrina",
  "artigo",
  "tese",
  "insight",
]);

function normalizeMemoriaTipo(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (MEMORIA_TIPOS_VALIDOS.has(normalized)) {
    return normalized;
  }
  return undefined;
}

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const entries = Object.entries(raw).filter(([_, value]) => {
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  });

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

router.post("/pecas/:id/topicos/:topicoId/refinar", async (req, res) => {
  const { id, topicoId } = req.params;
  if (!id || !topicoId) {
    return res.status(400).json({ error: "PARAMETROS_INVALIDOS" });
  }

  const body = req.body ?? {};
  const conteudo = sanitizeText(body.conteudo) || sanitizeText(body.texto) || sanitizeText(body.vetor);
  if (!conteudo) {
    return res.status(400).json({ error: "CONTEUDO_OBRIGATORIO" });
  }

  const tipoMemoria = normalizeMemoriaTipo(body.tipo || body.tipo_conteudo || body.categoria);
  const memoriaFiltro = normalizeMemoriaTipo(body.memoria_tipo);
  const pesquisaComplementar = sanitizeText(body.pesquisa_complementar) ?? undefined;
  const clienteId = sanitizeText(body.cliente_id) ?? undefined;
  const partes = parsePartes(body.partes);
  const topK =
    typeof body.top_k === "number" && Number.isFinite(body.top_k) ? body.top_k : undefined;
  const metadados = parseMetadata(body.metadados);

  try {
    const resultado = await refineStoredPieceTopic({
      pieceId: id,
      topicoId,
      novoConteudo: conteudo,
      tipoConteudo: tipoMemoria,
      metadados,
      pesquisaComplementar,
      clienteId,
      partes,
      topKMemoria: topK,
      memoriaTipo: memoriaFiltro,
    });

    return res.json({
      texto_reescrito: resultado.textoTopico,
      texto_atualizado: resultado.textoAtualizado,
      memoria_relacionada: resultado.memoria,
      jurisprudencias: resultado.jurisprudencias.map((item) => ({
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
    if (error instanceof PieceNotFoundError) {
      return res.status(404).json({ error: "PECA_NAO_ENCONTRADA" });
    }
    if (error instanceof TopicNotFoundError) {
      return res.status(404).json({ error: "TOPICO_NAO_ENCONTRADO" });
    }

    console.error(
      `[publicLegalDoc] erro ao refinar tópico ${topicoId} da peça ${id}`,
      error
    );
    const message = error instanceof Error ? error.message : "ERRO_INTERNO";
    return res.status(500).json({ error: "ERRO_REFINAR_TOPICO_PECA", message });
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