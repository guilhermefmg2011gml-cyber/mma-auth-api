import { getPdpjToken } from "./pdpjAuth.js";

function base() {
  const { PDPJ_GATEWAY_BASE } = process.env;
  if (!PDPJ_GATEWAY_BASE) throw new Error("PDPJ_GATEWAY_BASE não definido.");
  return PDPJ_GATEWAY_BASE.replace(/\/$/, "");
}

export async function pdpjGET(path, qs = {}) {
  const token = await getPdpjToken();

  const url = new URL(`${base()}${path.startsWith("/") ? path : `/${path}`}`);
  Object.entries(qs).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") url.searchParams.set(k, v);
  });

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (r.status === 404) {
    return { ok: false, status: 404, body: await r.text().catch(() => "") };
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`PDPJ API ${r.status}: ${body}`);
  }
  return r.headers.get("content-type")?.includes("application/json") ? r.json() : r.text();
}