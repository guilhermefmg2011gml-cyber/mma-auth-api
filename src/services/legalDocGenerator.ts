import { generateLegalPiece, type GeneratePiecePayload, type PartePayload } from "../integrations/openaiClient.js";
import { searchLegalInsights, type TavilyLegalResearchResult } from "../integrations/tavilyClient.js";

const DEFAULT_JURIS_DOMAINS = ["stj.jus.br", "jusbrasil.com.br", "conjur.com.br"];

export type TipoPeca =
  | "peticao_inicial"
  | "contestacao"
  | "replica"
  | "agravo_instrumento"
  | "pedido_saneamento"
  | "producao_provas"
  | "interlocutoria"
  | "manifestacao"
  | "quesitos"
  | "memoriais"
  | "apelacao"
  | "tutela_urgencia";

export interface ParteData extends PartePayload {}

export interface GenerateLegalDocumentInput extends Omit<GeneratePiecePayload, "tipoPeca"> {
  tipoPeca: TipoPeca;
}

export interface LegalDocumentResult {
  texto: string;
  jurisprudencias: TavilyLegalResearchResult[];
}

export async function generateLegalDocument(
  input: GenerateLegalDocumentInput
): Promise<LegalDocumentResult> {
  const texto = await generateLegalPiece({
    ...input,
    tipoPeca: input.tipoPeca,
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