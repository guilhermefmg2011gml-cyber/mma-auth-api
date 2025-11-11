import axios, { type AxiosError, type AxiosInstance } from "axios";
import { v4 as uuidv4 } from "uuid";
import { embedTexts } from "../integrations/openaiEmbeddings.js";

const CHROMA_HOST = process.env.CHROMA_HOST || "https://api.trychroma.com";
const CHROMA_API_KEY = process.env.CHROMA_API_KEY;
const CHROMA_TENANT = process.env.CHROMA_TENANT;
const CHROMA_DATABASE = process.env.CHROMA_DATABASE;
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "memoria_juridica";

const DEFAULT_CHUNK_SIZE = Number(process.env.MEMORIA_CHUNK_SIZE || 512);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.MEMORIA_CHUNK_OVERLAP || 64);

let chromaClient: AxiosInstance | null = null;
let collectionEnsured: Promise<boolean> | null = null;

function createClient(): AxiosInstance | null {
  if (!CHROMA_HOST) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (CHROMA_API_KEY) {
    headers.Authorization = `Bearer ${CHROMA_API_KEY}`;
  }
  if (CHROMA_TENANT) {
    headers["X-Chroma-Tenant"] = CHROMA_TENANT;
  }
  if (CHROMA_DATABASE) {
    headers["X-Chroma-Database"] = CHROMA_DATABASE;
  }

  return axios.create({
    baseURL: CHROMA_HOST.replace(/\/$/, ""),
    headers,
    timeout: 20000,
  });
}

function getClient(): AxiosInstance | null {
  if (!chromaClient) {
    chromaClient = createClient();
  }
  return chromaClient;
}

async function ensureCollection(): Promise<boolean> {
  if (!getClient()) {
    console.warn("[memoriaJuridica] Cliente Chroma não configurado; memórias desativadas");
    return false;
  }

  if (!collectionEnsured) {
    collectionEnsured = (async () => {
      try {
        await chromaClient!.get(`/api/v1/collections/${encodeURIComponent(CHROMA_COLLECTION)}`);
        return true;
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError?.response?.status === 404) {
          try {
            await chromaClient!.post(`/api/v1/collections`, { name: CHROMA_COLLECTION });
            return true;
          } catch (createError) {
            console.warn("[memoriaJuridica] Falha ao criar coleção no Chroma", createError);
            return false;
          }
        }
        console.warn("[memoriaJuridica] Falha ao acessar coleção do Chroma", error);
        return false;
      }
    })();
  }

  return collectionEnsured;
}

function splitTextIntoChunks(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  const sanitized = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
  if (!sanitized) {
    return [];
  }

  const result: string[] = [];
  let start = 0;

  while (start < sanitized.length) {
    let end = Math.min(start + chunkSize, sanitized.length);
    if (end < sanitized.length) {
      const lastNewLine = sanitized.lastIndexOf("\n", end);
      const lastSpace = sanitized.lastIndexOf(" ", end);
      const candidate = Math.max(lastNewLine, lastSpace);
      if (candidate > start + overlap && candidate < end) {
        end = candidate;
      }
    }

    const chunk = sanitized.slice(start, end).trim();
    if (chunk) {
      result.push(chunk);
    }

    if (end >= sanitized.length) {
      break;
    }

    start = Math.max(end - overlap, 0);
    if (start >= sanitized.length) {
      break;
    }
  }

  return result;
}

async function addDocuments(parts: string[], metadatas: Record<string, unknown>[], embeddings: number[][]): Promise<void> {
  const client = getClient();
  if (!client) {
    return;
  }

  if (!(await ensureCollection())) {
    return;
  }

  try {
    await client.post(`/api/v1/collections/${encodeURIComponent(CHROMA_COLLECTION)}/add`, {
      ids: parts.map(() => uuidv4()),
      documents: parts,
      metadatas,
      embeddings,
    });
  } catch (error) {
    console.warn("[memoriaJuridica] Falha ao adicionar documentos na memória", error);
  }
}

export async function memorizarTopico(
  nomeCliente: string,
  tituloPeca: string,
  topico: string,
  conteudo: string
): Promise<void> {
  const partes = splitTextIntoChunks(conteudo);
  if (!partes.length) {
    return;
  }

  const embeddings = await embedTexts(partes);
  if (!embeddings.length || embeddings.length !== partes.length) {
    console.warn("[memoriaJuridica] Embeddings não gerados; tópico não será memorizado");
    return;
  }

  const metadados = partes.map(() => ({
    cliente: nomeCliente || "desconhecido",
    titulo: tituloPeca,
    topico,
  }));

  await addDocuments(partes, metadados, embeddings);
}

export async function buscarConteudoRelacionado(pergunta: string, topK = 5): Promise<string[]> {
  const client = getClient();
  if (!client) {
    return [];
  }

  if (!(await ensureCollection())) {
    return [];
  }

  const embeddings = await embedTexts([pergunta]);
  if (!embeddings.length) {
    return [];
  }

  try {
    const { data } = await client.post(`/api/v1/collections/${encodeURIComponent(CHROMA_COLLECTION)}/query`, {
      query_embeddings: embeddings,
      n_results: topK,
    });

    const documents: unknown = data?.documents;
    if (!Array.isArray(documents)) {
      return [];
    }

    const resultados: string[] = [];
    for (const batch of documents) {
      if (Array.isArray(batch)) {
        for (const doc of batch) {
          if (typeof doc === "string" && doc.trim()) {
            resultados.push(doc.trim());
          }
        }
      }
    }

    return resultados;
  } catch (error) {
    console.warn("[memoriaJuridica] Falha ao consultar memórias relacionadas", error);
    return [];
  }
}