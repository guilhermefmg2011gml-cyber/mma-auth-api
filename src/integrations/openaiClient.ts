import axios from "axios";

const DEFAULT_OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_API_URL = process.env.OPENAI_API_URL || DEFAULT_OPENAI_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

type ParteRole = "autor" | "reu" | "terceiro";

export interface PartePayload {
  nome: string;
  papel: ParteRole;
  qualificacao?: string | null;
}

export interface GeneratePiecePayload {
  tipoPeca: string;
  partes: PartePayload[];
  resumoFatico: string;
  pedidos?: string | null;
  documentos?: string[];
  clienteId?: string | null;
  templateBlocos?: string[];
}

function formatBlockTitle(block: string): string {
  return block
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPrompt(payload: GeneratePiecePayload): string {
  const partesLinha = payload.partes
    .map((parte) => {
      const qualificacao = parte.qualificacao ? ` (${parte.qualificacao})` : "";
      return `${parte.papel.toUpperCase()}: ${parte.nome}${qualificacao}`;
    })
    .join("\n");

  const documentosTexto = payload.documentos?.length
    ? `Documentos relevantes: ${payload.documentos.join(", ")}.`
    : "Sem documentos anexados informados.";

  const pedidosOrientacoes = payload.pedidos
    ? `Orientações do cliente sobre pedidos: ${payload.pedidos}.`
    :
        "Pedidos específicos não foram informados; gere requerimentos finais coerentes com a narrativa e a fundamentação.";

  const blocos = payload.templateBlocos?.length
    ? payload.templateBlocos
    : [
        "preambulo",
        "dos_fatos",
        "fundamentacao_juridica",
        "jurisprudencia",
        "dos_pedidos",
      ];

  const blocosTexto = blocos
    .map((bloco) => `### ${formatBlockTitle(bloco)}\n(Desenvolva este tópico conforme aplicável ao tipo da peça.)`)
    .join("\n\n");

  return `Elabore uma peça processual do tipo ${payload.tipoPeca}, com linguagem jurídica técnica, clara e objetiva.\n\n` +
    `Considere o seguinte caso fático:\n${payload.resumoFatico}\n\n` +
    `Partes envolvidas:\n${partesLinha}\n\n` +
    `${documentosTexto}\n${pedidosOrientacoes}\n\n` +
    `Estruture a peça obedecendo aos blocos indicados abaixo, utilizando linguagem precisa e citações legais quando cabíveis:\n\n` +
    `${blocosTexto}\n\n` +
    `Inclua fundamentações jurídicas, artigos de lei e jurisprudências reais sempre que possível.\n` +
    `No bloco destinado aos pedidos, produza requerimentos finais claros, coesos e juridicamente fundamentados, conectando-os aos fatos e à fundamentação desenvolvida.\n` +
    `A resposta deve trazer um texto base estruturado para validação humana.`;
}

export async function generateLegalPiece(payload: GeneratePiecePayload): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada");
  }

  const prompt = buildPrompt(payload);

  const { data } = await axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "Você é um advogado especialista na redação de peças judiciais brasileiras.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const texto = data?.choices?.[0]?.message?.content;
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta inválida da OpenAI");
  }

  return texto.trim();
}

export interface GeneratePedidosPayload {
  tipoPeca: string;
  resumoFatico: string;
  fundamentacao: string;
  blocoTitulo: string;
  orientacoes?: string;
  contextoAtual?: string;
}

export interface RewriteTopicPayload {
  tipoPeca: string;
  blocoTitulo: string;
  conteudoAtual: string;
  memoriaRelacionada?: string[];
  novasInformacoes?: string;
  referenciasJuridicas?: string[];
}

export interface RewriteFreeformPayload {
  texto: string;
  contexto?: string[];
  instrucoes?: string;
}

function buildPedidosPrompt(payload: GeneratePedidosPayload): string {
  const orientacoesTexto = payload.orientacoes
    ? `Orientações adicionais do cliente: ${payload.orientacoes}.`
    : "Nenhuma orientação adicional específica foi fornecida.";

  const contextoAtual = payload.contextoAtual?.trim()
    ? `Conteúdo anteriormente sugerido para a seção:\n${payload.contextoAtual.trim()}\n\n`
    : "";

  const fundamentacao = payload.fundamentacao.trim()
    ? payload.fundamentacao.trim()
    : "(A fundamentação jurídica ainda não está detalhada. Utilize os fatos para sustentar os pedidos.)";

  return (
    `Você é um advogado brasileiro elaborando requerimentos finais para uma peça processual do tipo ${payload.tipoPeca}.\n` +
    `Resumo fático relevante:\n${payload.resumoFatico}\n\n` +
    `Principais fundamentos jurídicos já redigidos:\n${fundamentacao}\n\n` +
    `${orientacoesTexto}\n` +
    `${contextoAtual}` +
    `Redija a seção "${payload.blocoTitulo}" com pedidos finais claros, numerados ou em tópicos, mantendo estilo jurídico técnico, coeso e alinhado aos fundamentos expostos.\n` +
    `Conecte cada pedido aos fatos narrados e à fundamentação apresentada, evitando repetições desnecessárias.\n` +
    `Retorne apenas o conteúdo da seção, sem repetir o título.`
  );
}

export async function generateSmartPedidos(
  payload: GeneratePedidosPayload
): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada");
  }

  const prompt = buildPedidosPrompt(payload);

  const { data } = await axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "Você é um advogado especialista na redação de pedidos finais em peças judiciais brasileiras.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const texto = data?.choices?.[0]?.message?.content;
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta inválida da OpenAI ao gerar pedidos inteligentes");
  }

  return texto.trim();
}

function buildTopicRewritePrompt(payload: RewriteTopicPayload): string {
  const memoriaTexto = payload.memoriaRelacionada?.length
    ? `Memória jurídica relacionada:\n${payload.memoriaRelacionada.join("\n\n")}\n\n`
    : "";

  const novasInformacoes = payload.novasInformacoes?.trim()
    ? `Novas informações fornecidas:\n${payload.novasInformacoes.trim()}\n\n`
    : "";

  const referencias = payload.referenciasJuridicas?.length
    ? `Jurisprudências e doutrinas relevantes:\n${payload.referenciasJuridicas.join("\n\n")}\n\n`
    : "";

  return (
    `Você é um advogado brasileiro revisando o tópico "${payload.blocoTitulo}" ` +
    `de uma peça processual do tipo ${payload.tipoPeca}.\n\n` +
    `Conteúdo atual do tópico:\n${payload.conteudoAtual}\n\n` +
    memoriaTexto +
    novasInformacoes +
    referencias +
    "Reescreva o tópico de forma técnica, coerente e aprimorada, mantendo alinhamento com o caso narrado. " +
    "Atualize fundamentações e pedidos implícitos conforme as referências apresentadas quando fizer sentido. " +
    "Entregue apenas o texto reescrito do tópico, sem incluir títulos adicionais."
  );
}

export async function rewriteTopicWithContext(payload: RewriteTopicPayload): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada");
  }

  const prompt = buildTopicRewritePrompt(payload);

  const { data } = await axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "Você é um advogado especialista em revisão de peças judiciais brasileiras.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const texto = data?.choices?.[0]?.message?.content;
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta inválida da OpenAI ao aprimorar tópico");
  }

  return texto.trim();
}

function buildFreeformRewritePrompt(payload: RewriteFreeformPayload): string {
  const contexto = payload.contexto?.length
    ? `Contexto adicional relevante:\n${payload.contexto.join("\n\n---\n\n")}\n\n`
    : "Contexto adicional relevante: não há registros disponíveis.\n\n";

  const instrucoes = payload.instrucoes?.trim()
    ? payload.instrucoes.trim()
    : "Reescreva o texto aprimorando clareza, coesão, técnica jurídica e correção gramatical, mantendo o sentido essencial.";

  return (
    `${instrucoes}\n\n` +
    `${contexto}` +
    `Texto atual:\n${payload.texto}\n\n` +
    `Retorne somente o texto reescrito, sem comentários adicionais.`
  );
}

export async function rewriteFreeformText(payload: RewriteFreeformPayload): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada");
  }

  const prompt = buildFreeformRewritePrompt(payload);

  const { data } = await axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "Você é um advogado brasileiro especializado em revisão e aprimoramento de peças processuais.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const texto = data?.choices?.[0]?.message?.content;
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta inválida da OpenAI ao refinar texto");
  }

  return texto.trim();
}