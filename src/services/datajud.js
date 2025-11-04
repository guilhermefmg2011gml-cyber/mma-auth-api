const BASE = process.env.DATAJUD_BASE || "https://api-publica.datajud.cnj.jus.br";
const APIKEY = process.env.DATAJUD_API_KEY;

function headers() {
  if (!APIKEY) throw new Error("DATAJUD_API_KEY ausente");
  return { "Authorization": `APIKey ${APIKEY}`, "Content-Type": "application/json" };
}

// Busca por número CNJ em um alias específico (ex.: api_publica_tjgo)
export async function datajudSearchByCNJ(alias, numeroProcesso, size = 10) {
  const r = await fetch(`${BASE}/${alias}/_search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ size, query: { match: { numeroProcesso } } })
  });
  if (!r.ok) throw new Error(`Datajud ${alias} ${r.status}`);
  return r.json();
}

// Varredura em lote com paginação por search_after
export async function datajudScroll(alias, dsl, onPage) {
  let search_after;
  for (;;) {
    const body = {
      size: dsl.size ?? 200,
      query: dsl.query ?? { match_all: {} },
      sort: [{ "@timestamp": { order: "asc" } }],
      ...(search_after ? { search_after } : {})
    };
    const r = await fetch(`${BASE}/${alias}/_search`, {
      method: "POST", headers: headers(), body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Datajud ${alias} ${r.status}`);
    const json = await r.json();
    const page = json?.hits?.hits ?? [];
    if (!page.length) break;
    await onPage(page);
    search_after = page[page.length - 1]?.sort;
    if (!search_after) break;
  }
}

export default { datajudSearchByCNJ, datajudScroll };