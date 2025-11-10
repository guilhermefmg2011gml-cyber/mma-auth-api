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

  const pedidosTexto = payload.pedidos ? `Pedidos sugeridos: ${payload.pedidos}.` : "";

  return `Elabore uma peça processual do tipo ${payload.tipoPeca}, com linguagem jurídica técnica, clara e objetiva.\n\n` +
    `Considere o seguinte caso fático:\n${payload.resumoFatico}\n\n` +
    `Partes envolvidas:\n${partesLinha}\n\n` +
    `${documentosTexto}\n${pedidosTexto}\n\n` +
    `Organize a peça, se aplicável, nos seguintes tópicos:\n` +
    `- Preâmbulo\n` +
    `- Dos Fatos\n` +
    `- Da Fundamentação Jurídica (com artigos de lei citados explicitamente)\n` +
    `- Da Jurisprudência\n` +
    `- Dos Pedidos\n\n` +
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