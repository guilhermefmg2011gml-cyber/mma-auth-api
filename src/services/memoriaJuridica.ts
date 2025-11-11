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

export type MemoriaConteudoTipo =
  | "peça"
  | "topico"
  | "jurisprudencia"
  | "doutrina"
  | "artigo"
  | "tese"
  | "insight"
  | string;

export interface MemoriaItem {
  texto: string;
  tipo: MemoriaConteudoTipo;
  metadados?: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface BuscaMemoriaOptions {
  topK?: number;
  tipo?: MemoriaConteudoTipo;
  clienteId?: string | null;
  processoId?: string | null;
}

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

async function addDocuments(
  parts: string[],
  metadatas: Record<string, unknown>[],
  embeddings: number[][]
): Promise<void> {
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

export async function memorizarConteudos(itens: MemoriaItem[]): Promise<void> {
  if (!Array.isArray(itens) || itens.length === 0) {
    return;
  }

  const partes: string[] = [];
  const metadados: Record<string, unknown>[] = [];

  for (const item of itens) {
    if (!item?.texto?.trim()) {
      continue;
    }

    const chunkSize = item.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = item.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    const chunks = splitTextIntoChunks(item.texto, chunkSize, chunkOverlap);

    for (const chunk of chunks) {
      if (!chunk) continue;
      partes.push(chunk);
      metadados.push({ tipo: item.tipo, ...(item.metadados ?? {}) });
    }
  }

  if (!partes.length) {
    return;
  }

  const embeddings = await embedTexts(partes);
  if (!embeddings.length || embeddings.length !== partes.length) {
    console.warn("[memoriaJuridica] Embeddings não gerados; lote não será memorizado");
    return;
  }

  await addDocuments(partes, metadados, embeddings);
}

export async function memorizarConteudo(
  tipo: MemoriaConteudoTipo,
  texto: string,
  metadados?: Record<string, unknown>,
  options?: { chunkSize?: number; chunkOverlap?: number }
): Promise<void> {
  await memorizarConteudos([
    {
      tipo,
      texto,
      metadados,
      chunkSize: options?.chunkSize,
      chunkOverlap: options?.chunkOverlap,
    },
  ]);
}

export async function memorizarTopico(
  nomeCliente: string,
  tituloPeca: string,
  topico: string,
  conteudo: string,
  metadados?: Record<string, unknown>
): Promise<void> {
  await memorizarConteudo("topico", conteudo, {
    cliente: nomeCliente || "desconhecido",
    titulo: tituloPeca,
    topico,
    ...(metadados ?? {}),
  });
}

export async function buscarConteudoRelacionado(
  pergunta: string,
  options?: BuscaMemoriaOptions
): Promise<string[]> {
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
    const payload: Record<string, unknown> = {
      query_embeddings: embeddings,
      n_results: options?.topK ?? 5,
    };

    const where: Record<string, unknown> = {};
    if (options?.tipo) {
      where.tipo = options.tipo;
    }
    if (options?.clienteId) {
      where.clienteId = options.clienteId;
    }
    if (options?.processoId) {
      where.processoId = options.processoId;
    }

    if (Object.keys(where).length) {
      payload.where = where;
    }

    const { data } = await client.post(
      `/api/v1/collections/${encodeURIComponent(CHROMA_COLLECTION)}/query`,
      payload
    );

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