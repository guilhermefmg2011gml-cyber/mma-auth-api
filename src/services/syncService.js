import { db, upsertProcessoFromDTO, insertAndamentosDedup } from "../db.js";
import { pdpjGET } from "../integrations/pdpjClient.js";

function normalizeResp(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.items)) return resp.items;
  return [];
}

function dtoFromGateway(p) {
  return {
    numero: p?.numero_cnj || p?.numero || "",
    classe: p?.classe || "",
    assunto: p?.assunto || "",
    foro: p?.orgao || p?.foro || "",
    vara: p?.vara || "",
    instancia: p?.instancia || p?.grau || "",
    situacao: p?.situacao || p?.situacao_processo || "em andamento",
    polo_ativo: p?.partes_ativas?.map?.((x) => x.nome) || [],
    polo_passivo: p?.partes_passivas?.map?.((x) => x.nome) || [],
    origem: "pdpj",
  };
}

export async function syncProcessesByOab({ oab, uf, ingest = true } = {}) {
  if (!oab) {
    return { ok: false, error: "OAB_REQUIRED" };
  }
  const safeUf = (uf || "GO").trim().toUpperCase();

  const response = await pdpjGET("/processos", { vinculo_oab: oab, uf: safeUf });
  const items = normalizeResp(response);

  const inserted = [];
  const updated = [];

  if (ingest) {
    for (const p of items) {
      const dto = dtoFromGateway(p);
      if (!dto.numero) continue;
      const before = db.prepare(`SELECT id FROM processos WHERE numero = ?`).get(dto.numero);
      const id = upsertProcessoFromDTO(dto);
      if (!id) continue;
      if (before?.id) updated.push(id);
      else inserted.push(id);

      if (Array.isArray(p?.andamentos)) {
        insertAndamentosDedup(id, dto.numero, p.andamentos, "pdpj");
      }
    }
  }

  return {
    ok: true,
    total: items.length,
    inseridos: inserted,
    atualizados: updated,
  };
}

export async function syncByAllTrackedOABs() {
  const oabs = db.prepare(`SELECT oab, uf FROM vinculacoes_oab WHERE ativo = 1`).all();
  let total = 0;
  let novos = 0;

  for (const { oab, uf } of oabs) {
    try {
      const resp = await syncProcessesByOab({ oab, uf, ingest: true });
      total += resp.total || 0;
      novos += resp.inseridos?.length || 0;
    } catch (e) {
      console.error("sync OAB fail:", oab, uf, e?.message || e);
    }
  }

  return { total, novos };
}