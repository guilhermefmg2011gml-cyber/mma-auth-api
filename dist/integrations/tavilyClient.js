import axios from "axios";
const DEFAULT_API_URL = "https://api.tavily.com/search";
const TAVILY_API_URL = process.env.TAVILY_API_URL || DEFAULT_API_URL;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
function extractDigits(value) {
    return value.replace(/\D+/g, "");
}
function normalizeCnj(value) {
    const digits = extractDigits(value);
    if (digits.length !== 20) {
        return null;
    }
    return digits;
}
function getStringField(source, key) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return null;
}
function inferTribunalFromUrl(url) {
    if (!url)
        return null;
    try {
        const hostname = new URL(url).hostname;
        const tribunalMatch = hostname.match(/tj[a-z]{2}|trf\d+|trt\d+|stj|stf|tst|tse/i);
        if (tribunalMatch) {
            return tribunalMatch[0].toUpperCase();
        }
        return hostname;
    }
    catch {
        return null;
    }
}
function collectProcessesFromResult(item) {
    const text = [item.title, item.content, item.snippet].filter(Boolean).join(" \n");
    const matches = new Set();
    const regex = /(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})|(\d{20})/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const raw = match[0];
        const normalized = normalizeCnj(raw);
        if (normalized) {
            matches.add(normalized);
        }
    }
    if (!matches.size) {
        return [];
    }
    const tribunalFromMetadata = getStringField(item.metadata, "tribunal") ?? getStringField(item.attributes, "tribunal");
    const tribunal = tribunalFromMetadata || inferTribunalFromUrl(item.url) || "DESCONHECIDO";
    const orgao = getStringField(item.metadata, "orgao") ?? getStringField(item.attributes, "orgao") ?? undefined;
    const classe = getStringField(item.metadata, "classe") ?? getStringField(item.attributes, "classe") ?? undefined;
    const assunto = getStringField(item.metadata, "assunto") ?? getStringField(item.attributes, "assunto") ?? undefined;
    return Array.from(matches).map((numero) => ({
        numero_cnj: numero,
        tribunal,
        orgao,
        classe,
        assunto,
    }));
}
function normalizeDate(value) {
    if (!value)
        return null;
    const iso = new Date(value);
    if (Number.isNaN(iso.getTime()))
        return null;
    return iso.toISOString();
}
function parseMovementLines(text) {
    const lines = text
        .split(/\r?\n|\s{2,}|-\s+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const movements = [];
    for (const line of lines) {
        const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})|(\d{4}-\d{2}-\d{2})/);
        const dateText = dateMatch ? dateMatch[0] : null;
        let isoDate = null;
        if (dateText) {
            if (dateText.includes("/")) {
                const [day, month, year] = dateText.split("/");
                const parsed = new Date(Number(year), Number(month) - 1, Number(day));
                if (!Number.isNaN(parsed.getTime())) {
                    isoDate = parsed.toISOString();
                }
            }
            else {
                const parsed = new Date(dateText);
                if (!Number.isNaN(parsed.getTime())) {
                    isoDate = parsed.toISOString();
                }
            }
        }
        const descricao = dateText ? line.replace(dateText, "").trim() : line;
        if (!descricao)
            continue;
        movements.push({
            data: isoDate ?? new Date().toISOString(),
            descricao,
        });
    }
    return movements;
}
function collectMovementsFromResult(item) {
    const text = [item.title, item.content, item.snippet].filter(Boolean).join(" \n");
    const parsed = parseMovementLines(text);
    if (parsed.length) {
        return parsed;
    }
    const fallbackDate = normalizeDate(item.published_date) ?? new Date().toISOString();
    const descricao = item.title || item.content || item.snippet;
    if (!descricao) {
        return [];
    }
    return [
        {
            data: fallbackDate,
            descricao,
        },
    ];
}
function extractResults(data) {
    if (Array.isArray(data.results) && data.results.length) {
        return data.results;
    }
    if (Array.isArray(data.hits) && data.hits.length) {
        return data.hits;
    }
    return [];
}
async function performSearch(query, maxResults) {
    if (!TAVILY_API_KEY) {
        console.warn("[tavily] API key not configured; returning empty result set");
        return [];
    }
    const { data } = await axios.post(TAVILY_API_URL, {
        api_key: TAVILY_API_KEY,
        query,
        max_results: maxResults,
    }, {
        headers: {
            "Content-Type": "application/json",
        },
        timeout: 20000,
    });
    return extractResults(data);
}
export async function searchProcessesByLawyer(name, oab) {
    const query = `processos em nome de ${name} ${oab} em tribunais brasileiros (retorne número CNJ e tribunal)`;
    const items = await performSearch(query, 20);
    const map = new Map();
    for (const item of items) {
        for (const process of collectProcessesFromResult(item)) {
            const key = `${process.numero_cnj}|${process.tribunal}`;
            if (!map.has(key)) {
                map.set(key, process);
            }
        }
    }
    return Array.from(map.values());
}
export async function searchMovementsByCase(numero_cnj, tribunal) {
    const query = `ultimas movimentações do processo ${numero_cnj} no tribunal ${tribunal}`;
    const items = await performSearch(query, 30);
    const movements = [];
    for (const item of items) {
        movements.push(...collectMovementsFromResult(item));
    }
    return movements
        .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())
        .filter((movement, index, self) => {
        const signature = `${movement.data}|${movement.descricao}`;
        return index === self.findIndex((other) => `${other.data}|${other.descricao}` === signature);
    });
}
