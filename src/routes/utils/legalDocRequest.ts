import { TIPOS_PECA, type ParteData, type TipoPeca } from "../../services/legalDocGenerator.js";

const TIPO_PECA_SET = new Set<string>(TIPOS_PECA);

export function sanitizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseTipoPeca(value: unknown): TipoPeca | null {
  const text = sanitizeText(value);
  if (!text) return null;
  if (!TIPO_PECA_SET.has(text)) {
    return null;
  }
  return text as TipoPeca;
}

export function parsePartes(raw: unknown): ParteData[] {
  if (!Array.isArray(raw)) return [];

  const partes: ParteData[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const nome = sanitizeText(record.nome);
    const papelRaw = sanitizeText(record.papel) as ParteData["papel"] | null;
    const qualificacao = sanitizeText(record.qualificacao);

    if (!nome) continue;
    if (papelRaw !== "autor" && papelRaw !== "reu" && papelRaw !== "terceiro") continue;

    const parte: ParteData = {
      nome,
      papel: papelRaw,
    };

    if (qualificacao) {
      parte.qualificacao = qualificacao;
    }

    partes.push(parte);
  }

  return partes;
}

export function normalizeDocumentList(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const list: string[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = sanitizeText(item);
      if (text) list.push(text);
    }
  } else if (typeof raw === "string") {
    raw
      .split(/\r?\n|,/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((item) => list.push(item));
  }

  return list.length ? list : undefined;
}