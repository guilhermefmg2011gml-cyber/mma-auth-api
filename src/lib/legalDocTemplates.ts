export type TipoPeca =
  | "peticao_inicial"
  | "contestacao"
  | "replica"
  | "tutela_urgencia"
  | "agravo_instrumento"
  | "pedido_saneamento"
  | "producao_provas"
  | "interlocutoria"
  | "manifestacao"
  | "quesitos"
  | "memoriais"
  | "apelacao";

type CampoObrigatorio = "partes" | "resumoFatico" | "pedidos";

export interface LegalDocTemplate {
  blocos: string[];
  camposObrigatorios: CampoObrigatorio[];
}

export const LEGAL_DOC_TEMPLATES: Record<TipoPeca, LegalDocTemplate> = {
  peticao_inicial: {
    blocos: [
      "preambulo",
      "dos_fatos",
      "fundamentacao_juridica",
      "jurisprudencia",
      "dos_pedidos",
      "valor_da_causa",
    ],
    camposObrigatorios: ["partes", "resumoFatico"],
  },
  contestacao: {
    blocos: [
      "preambulo",
      "preliminares",
      "impugnacao_aos_fatos",
      "fundamentacao_juridica",
      "provas",
      "pedidos_finais",
    ],
    camposObrigatorios: ["partes", "resumoFatico"],
  },
  replica: {
    blocos: [
      "preambulo",
      "impugnacao_aos_argumentos",
      "reforco_das_teses",
      "jurisprudencia",
      "pedidos",
    ],
    camposObrigatorios: ["partes", "resumoFatico"],
  },
  tutela_urgencia: {
    blocos: [
      "preambulo",
      "fumus_boni_iuris",
      "periculum_in_mora",
      "fundamentacao_juridica",
      "pedidos_antecipatorios",
    ],
    camposObrigatorios: ["partes", "resumoFatico"],
  },
  agravo_instrumento: {
    blocos: [
      "preambulo",
      "exposicao_dos_fatos",
      "fundamentacao_juridica",
      "requerimentos",
      "documentos_obrigatorios",
    ],
    camposObrigatorios: ["partes", "resumoFatico"],
  },
  pedido_saneamento: {
    blocos: [
      "preambulo",
      "pontos_controvertidos",
      "medidas_propostas",
      "fundamentacao",
      "pedidos",
    ],
    camposObrigatorios: ["partes", "resumoFatico"],
  },
  producao_provas: {
    blocos: [
      "preambulo",
      "justificativa",
      "tipos_provas",
      "fundamentacao",
      "pedidos",
    ],
    camposObrigatorios: ["resumoFatico"],
  },
  interlocutoria: {
    blocos: ["preambulo", "fundamentacao", "pedido"],
    camposObrigatorios: ["resumoFatico"],
  },
  manifestacao: {
    blocos: ["preambulo", "resposta_argumentos", "fundamentacao", "conclusao"],
    camposObrigatorios: ["resumoFatico"],
  },
  quesitos: {
    blocos: ["introducao", "perguntas", "fundamento_tecnico"],
    camposObrigatorios: ["resumoFatico"],
  },
  memoriais: {
    blocos: [
      "preambulo",
      "resumo_dos_fatos",
      "teses_defendidas",
      "jurisprudencia_aplicavel",
      "conclusao",
    ],
    camposObrigatorios: ["resumoFatico"],
  },
  apelacao: {
    blocos: [
      "preambulo",
      "resumo_da_decisao",
      "fundamentacao",
      "reforma_pleiteada",
      "pedidos",
    ],
    camposObrigatorios: ["resumoFatico"],
  },
};

export const TIPOS_PECA: readonly TipoPeca[] = Object.freeze(
  Object.keys(LEGAL_DOC_TEMPLATES) as TipoPeca[]
);

export function getTemplate(tipo: TipoPeca): LegalDocTemplate {
  const template = LEGAL_DOC_TEMPLATES[tipo];
  if (!template) {
    throw new Error(`Template não encontrado para o tipo de peça: ${tipo}`);
  }
  return template;
}

export type CamposObrigatorios = CampoObrigatorio;