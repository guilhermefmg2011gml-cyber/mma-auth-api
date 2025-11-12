import axios from "axios";
const DEFAULT_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBEDDINGS_URL = process.env.OPENAI_EMBEDDINGS_URL || DEFAULT_EMBEDDINGS_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBEDDINGS_MODEL = process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small";
export async function embedTexts(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
        return [];
    }
    if (!OPENAI_API_KEY) {
        console.warn("[openaiEmbeddings] OPENAI_API_KEY não configurada; pulando geração de embeddings");
        return [];
    }
    const sanitized = texts.map((text) => (typeof text === "string" ? text : "").trim());
    const inputs = sanitized.filter(Boolean);
    if (!inputs.length) {
        return [];
    }
    const { data } = await axios.post(OPENAI_EMBEDDINGS_URL, {
        model: OPENAI_EMBEDDINGS_MODEL,
        input: inputs,
    }, {
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        timeout: 60000,
    });
    const vectors = data?.data;
    if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
        console.warn("[openaiEmbeddings] resposta inesperada ao gerar embeddings");
        return [];
    }
    return vectors.map((item) => {
        if (Array.isArray(item.embedding)) {
            return item.embedding;
        }
        throw new Error("Resposta inválida da API de embeddings da OpenAI");
    });
}
