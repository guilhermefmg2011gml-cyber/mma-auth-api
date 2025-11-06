import { datajudPOST } from "./datajudHttp.js";

export async function searchNumero({ alias, numero, mode = "exact" }) {
  const queries = [];

  if (mode === "exact") {
    queries.push({
      size: 1,
      query: { term: { "numeroProcesso.keyword": numero } },
    });
    queries.push({
      size: 3,
      query: { wildcard: { "numeroProcesso.keyword": `*${numero}*` } },
    });
  } else if (mode === "prefix") {
    const prefix = numero;
    queries.push({
      size: 5,
      query: { wildcard: { "numeroProcesso.keyword": `${prefix}*` } },
    });
    queries.push({
      size: 5,
      query: { wildcard: { "numeroProcesso.keyword": `*${prefix}*` } },
    });
  }

  if (!queries.length) {
    return { count: 0, first: null };
  }

  for (const q of queries) {
    const res = await datajudPOST(alias, "/_search", q);
    const hits = res?.hits?.hits ?? [];
    if (hits.length > 0) {
      return {
        count: res?.hits?.total?.value ?? hits.length,
        first: hits[0]?._source ?? hits[0] ?? null,
      };
    }
  }

  return { count: 0, first: null };
}