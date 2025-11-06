/* eslint-env node */

export function parseAliases(raw) {
  if (!raw) return [];
  const input = String(raw).trim();
  if (!input) return [];

  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => (typeof value === "string" ? value.trim() : String(value || "").trim()))
        .filter(Boolean);
    }
  } catch (_err) {
    // fallback para CSV/linhas
  }

  return input
    .split(/[\n,;\s]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

const RAW_BASE = process.env.DATAJUD_API_BASE || process.env.DATAJUD_BASE;
export const DATAJUD_API_BASE = RAW_BASE || "https://api-publica.datajud.cnj.jus.br";
export const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || "";
export const DATAJUD_ALIASES = Object.freeze(parseAliases(process.env.DATAJUD_ALIASES));

if (!DATAJUD_API_KEY) {
  console.warn("[datajud] API key ausente! Configure DATAJUD_API_KEY.");
}
console.log(`[datajud] aliases carregados: ${DATAJUD_ALIASES.length}`);