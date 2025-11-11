import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  generateLegalPiece,
  generateSmartPedidos,
  rewriteTopicWithContext,
  type GeneratePiecePayload,
  type PartePayload,
} from "../integrations/openaiClient.js";
import { searchLegalInsights, type TavilyLegalResearchResult } from "../integrations/tavilyClient.js";
import {
  TIPOS_PECA,
  getTemplate,
  type CamposObrigatorios,
  type TipoPeca,
  type LegalDocTemplate,
} from "../lib/legalDocTemplates.js";
import {
  buscarConteudoRelacionado,
  memorizarConteudo,
  memorizarConteudos,
  memorizarTopico,
  type MemoriaConteudoTipo,
  type MemoriaItem,
} from "./memoriaJuridica.js";

const DEFAULT_JURIS_DOMAINS = ["stj.jus.br", "jusbrasil.com.br", "conjur.com.br"];
const ARTICLE_VERIFICATION_DOMAINS = DEFAULT_JURIS_DOMAINS;
const ARTICLE_REGEX = /Art\.?\s?\d{1,4}[ºo]?(?:,?\s?§\s?\d+)?/gi;
const ARTICLE_MARKER_REGEX = /\s*\[(?:✔️ Confirmado|⚠️ Não confirmado)\]/g;
const ARTICLE_QUERY_SUFFIX = "CPC validade e aplicação";

const execFileAsync = promisify(execFile);

function stripArticleMarkers(value: string): string {
  if (!value) {
    return "";
  }
  return value.replace(ARTICLE_MARKER_REGEX, "");
}

function inferReferenciaTipo(item: TavilyLegalResearchResult): MemoriaConteudoTipo {
  const text = [item.title, item.snippet, item.content]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (text.includes("doutrina")) {
    return "doutrina";
  }

  if (text.includes("artigo") || text.includes("revista")) {
    return "artigo";
  }

  return "jurisprudencia";
}

function buildReferenciaTexto(item: TavilyLegalResearchResult): string {
  const titulo = item.title?.trim() || "Referência jurídica";
  const resumo = item.snippet?.trim() || item.content?.trim() || "";
  const url = item.url?.trim();
  const partes = [titulo];

  if (url) {
    partes.push(`Fonte: ${url}`);
  }

  if (resumo) {
    partes.push(resumo);
  }

  return partes.join("\n");
}

function buildArticleMemoryText(item: ArticleValidation): string {
  const status = item.confirmado
    ? "Artigo confirmado com jurisprudência relacionada"
    : "Artigo não confirmado";
  const referencia = item.referencia?.trim();
  const partes = [item.artigo.trim(), status];
  if (referencia) {
    partes.push(`Referência: ${referencia}`);
  }
  return partes.join(" - ");
}

export interface ArticleValidation {
  artigo: string;
  confirmado: boolean;
  referencia?: string | null;
}

interface StoredLegalPiece {
  id: string;
  tipo: TipoPeca;
  texto: string;
  createdAt: Date;
  artigos?: ArticleValidation[];
  cliente?: string | null;
  clienteId?: string | null;
  partes?: ParteData[];
}

const PIECE_MEMORY = new Map<string, StoredLegalPiece>();

export type { TipoPeca };

function formatTitle(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export { TIPOS_PECA };

export class MissingRequiredFieldsError extends Error {
  constructor(public readonly campos: CamposObrigatorios[]) {
    super(`Campos obrigatórios ausentes: ${campos.join(", ")}`);
    this.name = "MissingRequiredFieldsError";
  }
}

export interface ParteData extends PartePayload {}

export interface GenerateLegalDocumentInput extends Omit<GeneratePiecePayload, "tipoPeca"> {
  tipoPeca: TipoPeca;
}

export interface LegalDocumentResult {
  texto: string;
  jurisprudencias: TavilyLegalResearchResult[];
  artigos: ArticleValidation[];
}

export interface RefineTopicInput {
  tipoPeca: TipoPeca;
  blocoTitulo: string;
  conteudoAtual: string;
  novasInformacoes?: string;
  clienteId?: string | null;
  partes?: ParteData[];
  pesquisaComplementar?: string;
  topKMemoria?: number;
  memoriaTipo?: MemoriaConteudoTipo;
  memoriaMetadados?: Record<string, unknown>;
}

export interface RefineTopicResult {
  texto: string;
  memoria: string[];
  jurisprudencias: TavilyLegalResearchResult[];
}

export interface RefineStoredPieceInput {
  pieceId: string;
  topicoId: string;
  novoConteudo: string;
  tipoConteudo?: MemoriaConteudoTipo;
  metadados?: Record<string, unknown>;
  pesquisaComplementar?: string;
  clienteId?: string | null;
  partes?: ParteData[];
  topKMemoria?: number;
  memoriaTipo?: MemoriaConteudoTipo;
}

export interface RefineStoredPieceResult {
  textoTopico: string;
  textoAtualizado: string;
  memoria: string[];
  jurisprudencias: TavilyLegalResearchResult[];
  artigos: ArticleValidation[];
}

export class PieceNotFoundError extends Error {
  constructor(public readonly pieceId: string) {
    super(`Peça ${pieceId} não encontrada`);
    this.name = "PieceNotFoundError";
  }
}

export class TopicNotFoundError extends Error {
  constructor(public readonly topicoId: string) {
    super(`Tópico ${topicoId} não encontrado`);
    this.name = "TopicNotFoundError";
  }
}

export function validateRequiredFields(
  input: GenerateLegalDocumentInput
): CamposObrigatorios[] {
  const template = getTemplate(input.tipoPeca);
  const missing: CamposObrigatorios[] = [];

  for (const campo of template.camposObrigatorios) {
    if (campo === "partes" && (!Array.isArray(input.partes) || input.partes.length === 0)) {
      missing.push(campo);
    }

    if (campo === "resumoFatico") {
      const resumo = typeof input.resumoFatico === "string" ? input.resumoFatico.trim() : "";
      if (!resumo) {
        missing.push(campo);
      }
    }

    if (campo === "pedidos") {
      const pedidos = typeof input.pedidos === "string" ? input.pedidos.trim() : "";
      if (!pedidos) {
        missing.push(campo);
      }
    }
  }

  return missing;
}

export async function generateLegalDocument(
  input: GenerateLegalDocumentInput
): Promise<LegalDocumentResult> {
  const missing = validateRequiredFields(input);
  if (missing.length) {
    throw new MissingRequiredFieldsError(missing);
  }

  const template = getTemplate(input.tipoPeca);
  const textoBase = await generateLegalPiece({
    ...input,
    tipoPeca: input.tipoPeca,
    templateBlocos: template.blocos,
  });

  const textoComPedidos = await ensureIntelligentPedidos(textoBase, input, template);

  let jurisprudencias: TavilyLegalResearchResult[] = [];
  const resumoPreview = input.resumoFatico.slice(0, 160);
  const query = `jurisprudência sobre ${input.tipoPeca} relacionada a ${resumoPreview}`;

  try {
    jurisprudencias = await searchLegalInsights(query, DEFAULT_JURIS_DOMAINS, 8);
  } catch (error) {
    console.warn("[legalDocGenerator] falha ao buscar jurisprudências", error);
  }

  const textoSemMarcadores = stripArticleMarkers(textoComPedidos);
  const artigos = extractLawArticles(textoSemMarcadores);
  const artigosValidados = await verifyLawArticles(artigos);
  const textoAnotado = annotateArticlesInText(textoSemMarcadores, artigosValidados);

  await persistPieceInMemory({
    texto: textoAnotado,
    template,
    tipoPeca: input.tipoPeca,
    partes: input.partes,
    clienteId: input.clienteId,
    jurisprudencias,
    artigos: artigosValidados,
    origem: "geracao",
  });

  return {
    texto: textoAnotado,
    jurisprudencias: jurisprudencias.slice(0, 3),
    artigos: artigosValidados,
  };
}

export function storeGeneratedPiece(id: string, data: Omit<StoredLegalPiece, "id">): void {
  PIECE_MEMORY.set(id, {
    id,
    ...data,
  });
}

export function getGeneratedPiece(id: string): StoredLegalPiece | undefined {
  return PIECE_MEMORY.get(id);
}

function normalizeArticleKey(value: string): string {
  return value.replace(/[.\s]/g, "").toLowerCase();
}

function normalizeHeadingKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

interface ParsedSection {
  heading: string;
  headingLineIndex: number;
  blockName?: string;
  contentStart: number;
  contentEnd: number;
}

function stripHeadingPrefix(value: string): string {
  return value.replace(/^#{1,6}\s*/, "").trim();
}

function mapSectionsToTemplate(
  texto: string,
  template: LegalDocTemplate
): { sections: ParsedSection[]; lines: string[]; byBlock: Map<string, ParsedSection> } {
  const lines = texto.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  const byBlock = new Map<string, ParsedSection>();

  const normalizedBlocks = new Map<string, string>();
  for (const block of template.blocos) {
    const heading = formatTitle(block);
    normalizedBlocks.set(normalizeHeadingKey(heading), block);
  }

  let current: ParsedSection | null = null;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!/^#{2,6}\s+/.test(trimmed)) {
      continue;
    }

    if (current) {
      current.contentEnd = index;
      sections.push(current);
      if (current.blockName) {
        byBlock.set(current.blockName, current);
      }
    }

    const headingText = stripHeadingPrefix(trimmed);
    const blockName = normalizedBlocks.get(normalizeHeadingKey(headingText));

    current = {
      heading: headingText,
      headingLineIndex: index,
      blockName,
      contentStart: index + 1,
      contentEnd: lines.length,
    };
  }

  if (current) {
    current.contentEnd = lines.length;
    sections.push(current);
    if (current.blockName) {
      byBlock.set(current.blockName, current);
    }
  }

  return { sections, lines, byBlock };
}

export function inferClienteNome(partes: ParteData[], clienteId?: string | null): string {
  const cliente = typeof clienteId === "string" && clienteId.trim() ? clienteId.trim() : null;
  if (cliente) {
    return cliente;
  }

  const autor = partes.find((parte) => parte.papel === "autor" && parte.nome?.trim());
  if (autor?.nome) {
    return autor.nome.trim();
  }

  const primeiraParteComNome = partes.find((parte) => parte.nome?.trim());
  if (primeiraParteComNome?.nome) {
    return primeiraParteComNome.nome.trim();
  }

  return "desconhecido";
}

async function persistPieceInMemory({
  texto,
  template,
  tipoPeca,
  partes,
  clienteId,
  jurisprudencias,
  artigos,
  origem,
  metadadosExtras,
}: {
  texto: string;
  template: LegalDocTemplate;
  tipoPeca: TipoPeca;
  partes: ParteData[];
  clienteId?: string | null;
  jurisprudencias?: TavilyLegalResearchResult[];
  artigos?: ArticleValidation[];
  origem?: string;
  metadadosExtras?: Record<string, unknown>;
}): Promise<void> {
  if (!texto?.trim()) {
    return;
  }

  const { lines, byBlock } = mapSectionsToTemplate(texto, template);
  if (!byBlock.size) {
    return;
  }

  const clienteNome = inferClienteNome(partes, clienteId);
  const titulo = formatTitle(tipoPeca);
  const origemMemoria = origem ?? "geracao";

  const baseMetadados: Record<string, unknown> = {
    cliente: clienteNome || "desconhecido",
    titulo,
    tipoPeca,
    origem: origemMemoria,
    ...(metadadosExtras ?? {}),
  };

  const memorias: Promise<void>[] = [];

  for (const bloco of template.blocos) {
    const section = byBlock.get(bloco);
    if (!section) {
      continue;
    }

    const conteudo = stripArticleMarkers(getSectionContent(lines, section));
    if (!conteudo) {
      continue;
    }

    const topicoTitulo = formatTitle(bloco);
    const promise = memorizarTopico(clienteNome, titulo, topicoTitulo, conteudo, {
      tipoPeca,
      origem: origemMemoria,
      ...(metadadosExtras ?? {}),
    }).catch((error) => {
      console.warn(`[legalDocGenerator] falha ao memorizar tópico ${bloco}`, error);
    });
    memorias.push(promise);
  }

  const memoriaItens: MemoriaItem[] = [];
  const textoParaMemoria = stripArticleMarkers(texto);
  if (textoParaMemoria.trim()) {
    memoriaItens.push({
      tipo: "peça",
      texto: textoParaMemoria,
      metadados: baseMetadados,
    });
  }

  if (Array.isArray(jurisprudencias)) {
    for (const item of jurisprudencias) {
      const textoReferencia = buildReferenciaTexto(item);
      if (!textoReferencia.trim()) {
        continue;
      }
      const tipoReferencia = inferReferenciaTipo(item);
      memoriaItens.push({
        tipo: tipoReferencia,
        texto: textoReferencia,
        metadados: {
          ...baseMetadados,
          categoria: tipoReferencia,
          ...(item.url ? { url: item.url } : {}),
          ...(item.title ? { referenciaTitulo: item.title } : {}),
        },
      });
    }
  }

  if (Array.isArray(artigos)) {
    for (const artigo of artigos) {
      if (!artigo?.artigo) {
        continue;
      }
      memoriaItens.push({
        tipo: "artigo",
        texto: buildArticleMemoryText(artigo),
        metadados: {
          ...baseMetadados,
          confirmado: artigo.confirmado,
          ...(artigo.referencia ? { referencia: artigo.referencia } : {}),
        },
      });
    }
  }

  if (memoriaItens.length) {
    memorias.push(
      memorizarConteudos(memoriaItens).catch((error) => {
        console.warn("[legalDocGenerator] falha ao memorizar itens adicionais da peça", error);
      })
    );
  }

  if (memorias.length) {
    await Promise.allSettled(memorias);
  }
}


function getSectionContent(lines: string[], section: ParsedSection): string {
  if (section.contentStart >= section.contentEnd) {
    return "";
  }
  return lines.slice(section.contentStart, section.contentEnd).join("\n").trim();
}

function resolveSectionByTopicoId(
  topicoId: string,
  template: LegalDocTemplate,
  byBlock: Map<string, ParsedSection>
): { bloco: string; section: ParsedSection } | null {
  if (!topicoId) {
    return null;
  }

  if (byBlock.has(topicoId)) {
    return { bloco: topicoId, section: byBlock.get(topicoId)! };
  }

  const normalizedTarget = normalizeHeadingKey(topicoId);

  for (const bloco of template.blocos) {
    const section = byBlock.get(bloco);
    if (!section) {
      continue;
    }

    const normalizedBlock = normalizeHeadingKey(bloco);
    if (normalizedBlock === normalizedTarget) {
      return { bloco, section };
    }

    const headingNormalized = normalizeHeadingKey(section.heading || formatTitle(bloco));
    if (headingNormalized === normalizedTarget) {
      return { bloco, section };
    }
  }

  return null;
}

function applySectionReplacement(
  lines: string[],
  section: ParsedSection,
  novoConteudo: string
): string {
  const before = lines.slice(0, section.contentStart);
  const after = lines.slice(section.contentEnd);
  const sanitizedLines = typeof novoConteudo === "string" && novoConteudo.trim()
    ? novoConteudo.split(/\r?\n/).map((linha) => linha.replace(/\s+$/, ""))
    : [];

  return [...before, ...sanitizedLines, ...after].join("\n");
}


function sanitizeGeneratedPedidos(value: string): string {
  if (!value) {
    return "";
  }

  let sanitized = value.trim();
  if (/^#{1,6}\s+/.test(sanitized)) {
    sanitized = sanitized.replace(/^#{1,6}\s+.*?(?:\n|$)/, "").trim();
  }
  return sanitized;
}

async function ensureIntelligentPedidos(
  texto: string,
  input: GenerateLegalDocumentInput,
  template: LegalDocTemplate
): Promise<string> {
  const blocksComPedidos = template.blocos.filter((bloco) => /pedido|requer/i.test(bloco));
  if (!blocksComPedidos.length) {
    return texto;
  }

  const { lines, byBlock } = mapSectionsToTemplate(texto, template);
  if (!byBlock.size) {
    return texto;
  }

  const fundamentacaoBlocks = template.blocos.filter((bloco) =>
    /fundament|teses_defendidas|fundamento_tecnico|reforma_pleiteada/i.test(bloco)
  );

  const fundamentacaoTrechos = fundamentacaoBlocks
    .map((bloco) => {
      const section = byBlock.get(bloco);
      if (!section) return "";
      return getSectionContent(lines, section);
    })
    .filter((conteudo) => Boolean(conteudo?.trim()));

  const fundamentacaoTexto = fundamentacaoTrechos.join("\n\n");
  const orientacoes = typeof input.pedidos === "string" && input.pedidos.trim()
    ? input.pedidos.trim()
    : undefined;

  const replacements: { section: ParsedSection; lines: string[] }[] = [];

  for (const bloco of blocksComPedidos) {
    const section = byBlock.get(bloco);
    if (!section) {
      continue;
    }

    const blocoTitulo = formatTitle(bloco);
    const contextoAtual = getSectionContent(lines, section);

    try {
      const pedidos = await generateSmartPedidos({
        tipoPeca: input.tipoPeca,
        resumoFatico: input.resumoFatico,
        fundamentacao: fundamentacaoTexto || contextoAtual,
        blocoTitulo,
        orientacoes,
        contextoAtual,
      });

      const sanitized = sanitizeGeneratedPedidos(pedidos);
      if (!sanitized) {
        continue;
      }

      const novasLinhas = sanitized
        .split(/\r?\n/)
        .map((linha) => linha.replace(/\s+$/, ""));

      replacements.push({ section, lines: novasLinhas });
    } catch (error) {
      console.warn(
        `[legalDocGenerator] falha ao gerar pedidos inteligentes para ${bloco}`,
        error
      );
    }
  }

  if (!replacements.length) {
    return texto;
  }

  replacements.sort((a, b) => b.section.contentStart - a.section.contentStart);

  const updatedLines = [...lines];
  for (const replacement of replacements) {
    const inicio = replacement.section.contentStart;
    const tamanho = Math.max(replacement.section.contentEnd - replacement.section.contentStart, 0);
    const linhasParaInserir = replacement.lines.length ? replacement.lines : [""];
    updatedLines.splice(inicio, tamanho, ...linhasParaInserir);
  }

  return updatedLines.join("\n");
}

function extractLawArticles(texto: string): string[] {
  if (!texto) {
    return [];
  }

  const matches = texto.match(ARTICLE_REGEX);
  if (!matches) {
    return [];
  }

  const artigos: string[] = [];
  const vistos = new Set<string>();

  for (const match of matches) {
    const artigo = match.trim();
    const chave = normalizeArticleKey(artigo);
    if (!vistos.has(chave)) {
      vistos.add(chave);
      artigos.push(artigo);
    }
  }

  return artigos;
}

async function verifyLawArticles(artigos: string[]): Promise<ArticleValidation[]> {
  if (!artigos.length) {
    return [];
  }

  const verificacoes = artigos.map(async (artigo) => {
    try {
      const query = `${artigo} ${ARTICLE_QUERY_SUFFIX}`.trim();
      const resultados = await searchLegalInsights(
        query,
        ARTICLE_VERIFICATION_DOMAINS,
        4
      );
      const referencia = resultados[0]?.url ?? null;
      const validacao: ArticleValidation = {
        artigo,
        confirmado: resultados.length > 0,
        referencia,
      };
      return validacao;
    } catch (error) {
      console.warn(`[legalDocGenerator] falha ao verificar artigo ${artigo}`, error);
      const fallback: ArticleValidation = {
        artigo,
        confirmado: false,
        referencia: null,
      };
      return fallback;
    }
  });

  return Promise.all(verificacoes);
}

function annotateArticlesInText(
  texto: string,
  validacoes: ArticleValidation[]
): string {
  if (!texto || !validacoes.length) {
    return texto;
  }

  const mapa = new Map<string, ArticleValidation>();
  for (const validacao of validacoes) {
    mapa.set(normalizeArticleKey(validacao.artigo), validacao);
  }

  return texto.replace(ARTICLE_REGEX, (match) => {
    const chave = normalizeArticleKey(match);
    const info = mapa.get(chave);
    if (!info) {
      return match;
    }

    const marcador = info.confirmado ? "✔️ Confirmado" : "⚠️ Não confirmado";
    return `${match} [${marcador}]`;
  });
}

export async function refineDocumentTopic(input: RefineTopicInput): Promise<RefineTopicResult> {
  const memoria = await buscarConteudoRelacionado(
    input.conteudoAtual,
    input.topKMemoria ?? 5,
    input.memoriaTipo
  );
  let jurisprudencias: TavilyLegalResearchResult[] = [];
  const pesquisaBase = input.pesquisaComplementar?.trim()
    ? input.pesquisaComplementar.trim()
    : input.conteudoAtual.slice(0, 200);
  const query = `jurisprudência ou doutrina sobre ${input.blocoTitulo} em ${formatTitle(
    input.tipoPeca
  )}: ${pesquisaBase}`;

  try {
    jurisprudencias = await searchLegalInsights(query, DEFAULT_JURIS_DOMAINS, 6);
  } catch (error) {
    console.warn("[legalDocGenerator] falha ao buscar jurisprudências para refinamento", error);
  }

  const referencias = jurisprudencias.map((item) => {
    const titulo = item.title?.trim() || "Referência jurídica";
    const url = item.url ? ` (${item.url})` : "";
    const resumo = item.snippet?.trim() || item.content?.trim() || "";
    return `${titulo}${url}${resumo ? `\n${resumo}` : ""}`;
  });

  const textoReescrito = await rewriteTopicWithContext({
    tipoPeca: input.tipoPeca,
    blocoTitulo: input.blocoTitulo,
    conteudoAtual: input.conteudoAtual,
    memoriaRelacionada: memoria,
    novasInformacoes: input.novasInformacoes,
    referenciasJuridicas: referencias,
  });

  const clienteNome = inferClienteNome(input.partes ?? [], input.clienteId);
  if (textoReescrito?.trim()) {
    try {
      await memorizarTopico(
        clienteNome,
        formatTitle(input.tipoPeca),
        input.blocoTitulo,
        textoReescrito,
        input.memoriaMetadados
      );
    } catch (error) {
      console.warn("[legalDocGenerator] falha ao memorizar tópico reescrito", error);
    }
  }

  return {
    texto: textoReescrito,
    memoria,
    jurisprudencias,
  };
}

export async function refineStoredPieceTopic(
  input: RefineStoredPieceInput
): Promise<RefineStoredPieceResult> {
  const piece = PIECE_MEMORY.get(input.pieceId);
  if (!piece) {
    throw new PieceNotFoundError(input.pieceId);
  }

  const template = getTemplate(piece.tipo);
  const { lines, byBlock } = mapSectionsToTemplate(piece.texto, template);
  const resolved = resolveSectionByTopicoId(input.topicoId, template, byBlock);
  if (!resolved) {
    throw new TopicNotFoundError(input.topicoId);
  }

  const { section, bloco } = resolved;
  const headingTitulo = section.heading || formatTitle(bloco);
  const conteudoAtual = getSectionContent(lines, section);
  const partesBase = (input.partes?.length ? input.partes : piece.partes) ?? [];
  const clienteIdBase = input.clienteId ?? piece.clienteId ?? null;
  let clienteNome = inferClienteNome(partesBase, clienteIdBase);
  if (!clienteNome || clienteNome === "desconhecido") {
    clienteNome = piece.cliente ?? clienteNome;
  }
  const partesClonadas = partesBase.map((parte) => ({ ...parte }));

  if (input.novoConteudo?.trim()) {
    await memorizarConteudo(input.tipoConteudo ?? "tese", input.novoConteudo, {
      cliente: clienteNome || "desconhecido",
      titulo: formatTitle(piece.tipo),
      topico: headingTitulo,
      tipoPeca: piece.tipo,
      pecaId: input.pieceId,
      origem: "refinamento_vetor",
      ...(input.metadados ?? {}),
    });
  }

  const memoriaMetadados = {
    cliente: clienteNome || "desconhecido",
    titulo: formatTitle(piece.tipo),
    tipoPeca: piece.tipo,
    topico: headingTitulo,
    pecaId: input.pieceId,
    origem: "refinamento",
    ...(input.metadados ?? {}),
  };

  const resultado = await refineDocumentTopic({
    tipoPeca: piece.tipo,
    blocoTitulo: headingTitulo,
    conteudoAtual,
    novasInformacoes: input.novoConteudo,
    clienteId: clienteIdBase,
    partes: partesClonadas,
    pesquisaComplementar: input.pesquisaComplementar,
    topKMemoria: input.topKMemoria,
    memoriaTipo: input.memoriaTipo,
    memoriaMetadados,
  });

  const textoTopico = resultado.texto?.trim() ? resultado.texto : conteudoAtual;
  const textoAtualizadoBruto = applySectionReplacement(lines, section, textoTopico);
  const textoSemMarcadores = stripArticleMarkers(textoAtualizadoBruto);
  const artigos = await verifyLawArticles(extractLawArticles(textoSemMarcadores));
  const textoAnotado = annotateArticlesInText(textoSemMarcadores, artigos);

  const atualizado: StoredLegalPiece = {
    id: piece.id,
    tipo: piece.tipo,
    texto: textoAnotado,
    createdAt: new Date(),
    artigos,
    cliente: clienteNome || piece.cliente || null,
    clienteId: clienteIdBase,
    partes: partesClonadas,
  };

  PIECE_MEMORY.set(input.pieceId, atualizado);

  await persistPieceInMemory({
    texto: textoAnotado,
    template,
    tipoPeca: piece.tipo,
    partes: partesClonadas,
    clienteId: clienteIdBase,
    jurisprudencias: resultado.jurisprudencias,
    artigos,
    origem: "refinamento",
    metadadosExtras: {
      pecaId: input.pieceId,
      ...(input.metadados ?? {}),
    },
  });

  return {
    textoTopico,
    textoAtualizado: textoAnotado,
    memoria: resultado.memoria,
    jurisprudencias: resultado.jurisprudencias,
    artigos,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildParagraphXml(line: string): string {
  const trimmed = line.trim();

  if (!trimmed) {
    return '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';
  }

  const headingText = trimmed.replace(/^#+\s*/, "");
  if (trimmed.startsWith("###")) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(headingText)}</w:t></w:r></w:p>`;
  }

  if (trimmed.startsWith("##")) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>${escapeXml(headingText)}</w:t></w:r></w:p>`;
  }

  return `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`;
}

function buildDocumentXml(piece: StoredLegalPiece): string {
  const lines = piece.texto.split(/\r?\n/);
  const paragraphs =
    lines.length > 0
      ? lines.map((line) => buildParagraphXml(line))
      : ['<w:p><w:r><w:t/></w:r></w:p>'];
  const titulo = `Peça: ${formatTitle(piece.tipo.replace(/_/g, " "))}`;
  const geradoEm = `Gerado em ${piece.createdAt.toLocaleString("pt-BR")}`;

  const institutionalHeader = [
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${escapeXml(
      "MOURA MARTINS ADVOGADOS"
    )}</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>${escapeXml(
      "OAB/GO • mouramartinsadvogados.com.br"
    )}</w:t></w:r></w:p>`,
    '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>',
  ];

  const header = [
    ...institutionalHeader,
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${escapeXml(titulo)}</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t>${escapeXml(geradoEm)}</w:t></w:r></w:p>`,
    '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>',
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">\n` +
    `  <w:body>\n    ${header.join("\n    ")}\n    ${paragraphs.join("\n    ")}\n    <w:sectPr>\n      <w:pgSz w:w="12240" w:h="15840"/>\n      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>\n      <w:cols w:space="708"/>\n      <w:docGrid w:linePitch="360"/>\n    </w:sectPr>\n  </w:body>\n</w:document>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n</Types>`;

const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n  <Relationship Id="R2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n  <Relationship Id="R3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const APP_PROPS_XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n  <Application>Gerador de Peças Processuais</Application>\n  <DocSecurity>0</DocSecurity>\n  <ScaleCrop>false</ScaleCrop>\n  <LinksUpToDate>false</LinksUpToDate>\n  <SharedDoc>false</SharedDoc>\n  <HyperlinksChanged>false</HyperlinksChanged>\n  <AppVersion>16.0000</AppVersion>\n</Properties>`;

function buildCorePropsXml(piece: StoredLegalPiece): string {
  const titulo = `Peça ${formatTitle(piece.tipo.replace(/_/g, " "))}`;
  const iso = piece.createdAt.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <dc:title>${escapeXml(titulo)}</dc:title>\n  <dc:creator>Moura Martins Automação</dc:creator>\n  <cp:lastModifiedBy>Moura Martins Automação</cp:lastModifiedBy>\n  <dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>\n  <dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>\n</cp:coreProperties>`;
}

export async function buildDocxFromPiece(piece: StoredLegalPiece): Promise<Buffer> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "peca-docx-"));
  const outputPath = path.join(tmpdir(), `peca-${piece.id}-${Date.now()}.docx`);

  try {
    await Promise.all([
      mkdir(path.join(baseDir, "_rels"), { recursive: true }),
      mkdir(path.join(baseDir, "word", "_rels"), { recursive: true }),
      mkdir(path.join(baseDir, "docProps"), { recursive: true }),
    ]);

    await Promise.all([
      writeFile(path.join(baseDir, "[Content_Types].xml"), CONTENT_TYPES_XML, "utf8"),
      writeFile(path.join(baseDir, "_rels", ".rels"), PACKAGE_RELS_XML, "utf8"),
      writeFile(path.join(baseDir, "word", "_rels", "document.xml.rels"), DOCUMENT_RELS_XML, "utf8"),
      writeFile(path.join(baseDir, "word", "document.xml"), buildDocumentXml(piece), "utf8"),
      writeFile(path.join(baseDir, "docProps", "app.xml"), APP_PROPS_XML, "utf8"),
      writeFile(path.join(baseDir, "docProps", "core.xml"), buildCorePropsXml(piece), "utf8"),
    ]);

    await execFileAsync("zip", ["-rq", outputPath, "."], { cwd: baseDir });
    const buffer = await readFile(outputPath);
    return buffer;
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro desconhecido";
    throw new Error(`Falha ao gerar arquivo .docx: ${message}`);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
    await rm(outputPath, { force: true });
  }
}