import { DATAJUD_API_BASE as CONFIG_BASE, DATAJUD_API_KEY as CONFIG_API_KEY } from "../config/datajud.js";

const BASE = CONFIG_BASE || "https://api-publica.datajud.cnj.jus.br";
const APIKEY = CONFIG_API_KEY;

// Cabeçalhos conforme doc oficial: Authorization: APIKey <token>
function datajudHeaders() {
  if (!APIKEY) throw new Error("DATAJUD_API_KEY ausente nas variáveis de ambiente.");
  return {
    Authorization: `APIKey ${APIKEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function buildError(alias, res, text) {
  return new Error(`Datajud ${alias} ${res.status}: ${text.slice(0, 400)}`);
}

function ensureJson(alias, text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    throw new Error(`Datajud ${alias}: resposta não-JSON`);
  }
}

function hitsTotal(json) {
  const total = json?.hits?.total;
  if (typeof total === "number") return total;
  if (typeof total?.value === "number") return total.value;
  return Array.isArray(json?.hits?.hits) ? json.hits.hits.length : 0;
}

async function postSearch(alias, body) {
  const url = `${BASE}/${alias}/_search`;
  const res = await fetch(url, {
    method: "POST",
    headers: datajudHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();

  if (!res.ok) {
    throw buildError(alias, res, text);
  }

  const json = ensureJson(alias, text);
  return {
    hits: json?.hits?.hits || [],
    total: hitsTotal(json),
  };
}

function cnjRaizMask(cnjFormatted) {
  const parts = String(cnjFormatted).split(".");
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return cnjFormatted;
}

/**
 * Faz POST /{alias}/_search buscando por numeroProcesso (com máscara CNJ).
 * Retorna o array de hits (Elasticsearch).
 */
export async function datajudSearchByCNJ(alias, cnjFormatted) {
  const attempts = [
    {
      size: 1,
      query: { term: { "numeroProcesso.keyword": cnjFormatted } },
    },
    {
      size: 3,
      query: { wildcard: { "numeroProcesso.keyword": `*${cnjFormatted}*` } },
    },
    {
      size: 5,
      query: {
        wildcard: {
          "numeroProcesso.keyword": `*${cnjRaizMask(cnjFormatted)}*`,
        },
      },
    },
  ];

  let lastHits = [];

  for (const body of attempts) {
    const { hits, total } = await postSearch(alias, body);
    lastHits = hits;
    if (total > 0) {
      return hits;
    }
  }

  return lastHits;
}

// Varredura em lote com paginação por search_after
export async function datajudScroll(alias, dsl, onPage) {
  let search_after;
  for (;;) {
    const body = {
      size: dsl.size ?? 200,
      query: dsl.query ?? { match_all: {} },
      sort: [{ "@timestamp": { order: "asc" } }],
      ...(search_after ? { search_after } : {}),
    };
    const res = await fetch(`${BASE}/${alias}/_search`, {
      method: "POST",
      headers: datajudHeaders(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw buildError(alias, res, text);
    const json = ensureJson(alias, text);
    const page = json?.hits?.hits ?? [];
    if (!page.length) break;
    await onPage(page);
    search_after = page[page.length - 1]?.sort;
    if (!search_after) break;
  }
}

export default { datajudSearchByCNJ, datajudScroll };