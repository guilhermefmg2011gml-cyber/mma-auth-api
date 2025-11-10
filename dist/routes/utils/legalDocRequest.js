import { TIPOS_PECA } from "../../services/legalDocGenerator.js";
const TIPO_PECA_SET = new Set(TIPOS_PECA);
export function sanitizeText(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
export function parseTipoPeca(value) {
    const text = sanitizeText(value);
    if (!text)
        return null;
    if (!TIPO_PECA_SET.has(text)) {
        return null;
    }
    return text;
}
export function parsePartes(raw) {
    if (!Array.isArray(raw))
        return [];
    const partes = [];
    for (const item of raw) {
        if (!item || typeof item !== "object")
            continue;
        const record = item;
        const nome = sanitizeText(record.nome);
        const papelRaw = sanitizeText(record.papel);
        const qualificacao = sanitizeText(record.qualificacao);
        if (!nome)
            continue;
        if (papelRaw !== "autor" && papelRaw !== "reu" && papelRaw !== "terceiro")
            continue;
        const parte = {
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
export function normalizeDocumentList(raw) {
    if (!raw)
        return undefined;
    const list = [];
    if (Array.isArray(raw)) {
        for (const item of raw) {
            const text = sanitizeText(item);
            if (text)
                list.push(text);
        }
    }
    else if (typeof raw === "string") {
        raw
            .split(/\r?\n|,/)
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((item) => list.push(item));
    }
    return list.length ? list : undefined;
}
