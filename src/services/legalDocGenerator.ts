import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateLegalPiece, type GeneratePiecePayload, type PartePayload } from "../integrations/openaiClient.js";
import { searchLegalInsights, type TavilyLegalResearchResult } from "../integrations/tavilyClient.js";
import {
  TIPOS_PECA,
  getTemplate,
  type CamposObrigatorios,
  type TipoPeca,
} from "../lib/legalDocTemplates.js";

const DEFAULT_JURIS_DOMAINS = ["stj.jus.br", "jusbrasil.com.br", "conjur.com.br"];

const execFileAsync = promisify(execFile);

interface StoredLegalPiece {
  id: string;
  tipo: TipoPeca;
  texto: string;
  createdAt: Date;
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
  const texto = await generateLegalPiece({
    ...input,
    tipoPeca: input.tipoPeca,
    templateBlocos: template.blocos,
  });

  let jurisprudencias: TavilyLegalResearchResult[] = [];
  const resumoPreview = input.resumoFatico.slice(0, 160);
  const query = `jurisprudência sobre ${input.tipoPeca} relacionada a ${resumoPreview}`;

  try {
    jurisprudencias = await searchLegalInsights(query, DEFAULT_JURIS_DOMAINS, 8);
  } catch (error) {
    console.warn("[legalDocGenerator] falha ao buscar jurisprudências", error);
  }

  return {
    texto,
    jurisprudencias: jurisprudencias.slice(0, 3),
  };
}

export function storeGeneratedPiece(id: string, data: Omit<StoredLegalPiece, "id">): void {
  PIECE_MEMORY.set(id, {
    id,
    tipo: data.tipo,
    texto: data.texto,
    createdAt: data.createdAt,
  });
}

export function getGeneratedPiece(id: string): StoredLegalPiece | undefined {
  return PIECE_MEMORY.get(id);
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

  const header = [
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${escapeXml(titulo)}</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t>${escapeXml(geradoEm)}</w:t></w:r></w:p>`,
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