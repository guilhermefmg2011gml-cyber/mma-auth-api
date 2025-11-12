import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { embedTexts } from "../integrations/openaiEmbeddings.js";
const CHROMA_HOST = process.env.CHROMA_HOST || "https://api.trychroma.com";
const CHROMA_API_KEY = process.env.CHROMA_API_KEY;
const CHROMA_TENANT = process.env.CHROMA_TENANT;
const CHROMA_DATABASE = process.env.CHROMA_DATABASE;
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "memoria_juridica";
const DEFAULT_CHUNK_SIZE = Number(process.env.MEMORIA_CHUNK_SIZE || 512);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.MEMORIA_CHUNK_OVERLAP || 64);
let chromaClient = null;
let collectionEnsured = null;
function createClient() {
    if (!CHROMA_HOST) {
        return null;
    }
    const headers = {
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
function getClient() {
    if (!chromaClient) {
        chromaClient = createClient();
    }
    return chromaClient;
}
async function ensureCollection() {
    if (!getClient()) {
        console.warn("[memoriaJuridica] Cliente Chroma não configurado; memórias desativadas");
        return false;
    }
    if (!collectionEnsured) {
        collectionEnsured = (async () => {
            try {
                await chromaClient.get(`/api/v1/collections/${encodeURIComponent(CHROMA_COLLECTION)}`);
                return true;
            }
            catch (error) {
                const axiosError = error;
                if (axiosError?.response?.status === 404) {
                    try {
                        await chromaClient.post(`/api/v1/collections`, { name: CHROMA_COLLECTION });
                        return true;
                    }
                    catch (createError) {
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
function splitTextIntoChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
    const sanitized = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
    if (!sanitized) {
        return [];
    }
    const result = [];
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
async function addDocuments(parts, metadatas, embeddings) {
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
    }
    catch (error) {
        console.warn("[memoriaJuridica] Falha ao adicionar documentos na memória", error);
    }
}
export async function memorizarConteudos(itens) {
    if (!Array.isArray(itens) || itens.length === 0) {
        return;
    }
    const partes = [];
    const metadados = [];
    for (const item of itens) {
        if (!item?.texto?.trim()) {
            continue;
        }
        const chunkSize = item.chunkSize ?? DEFAULT_CHUNK_SIZE;
        const chunkOverlap = item.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
        const chunks = splitTextIntoChunks(item.texto, chunkSize, chunkOverlap);
        for (const chunk of chunks) {
            if (!chunk)
                continue;
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
export async function memorizarConteudo(tipo, texto, metadados, options) {
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
export async function memorizarTopico(nomeCliente, tituloPeca, topico, conteudo, metadados) {
    await memorizarConteudo("topico", conteudo, {
        cliente: nomeCliente || "desconhecido",
        titulo: tituloPeca,
        topico,
        ...(metadados ?? {}),
    });
}
export async function buscarConteudoRelacionado(pergunta, options) {
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
        const payload = {
            query_embeddings: embeddings,
            n_results: options?.topK ?? 5,
        };
        const where = {};
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
        const { data } = await client.post(`/api/v1/collections/${encodeURIComponent(CHROMA_COLLECTION)}/query`, payload);
        const documents = data?.documents;
        if (!Array.isArray(documents)) {
            return [];
        }
        const resultados = [];
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
    }
    catch (error) {
        console.warn("[memoriaJuridica] Falha ao consultar memórias relacionadas", error);
        return [];
    }
}
