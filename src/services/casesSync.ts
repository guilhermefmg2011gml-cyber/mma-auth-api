import axios from "axios";
import db from "../db.js";
import { normalizarCNJ } from "./ProcessSyncService.js";

const SEARCH_QUERIES = [
  '"Guilherme Martins Lopes" OABGO 76350',
  '"Larissa Moura Dos Santos" OABGO 74180',
  '"Moura Martins Advogados" OABGO 8344',
];

// Regex oficial CNJ (número único):
// NNNNNNN-DD.AAAA.J.TR.OOOO
const CNJ_REGEX = /\d{6,7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

type TavilyResult = {
  title?: string;
  content?: string;
  url?: string;
  [key: string]: unknown;
};

type CaseMeta = {
  tribunal: string | null;
  classe: string | null;
  assunto: string | null;
  url: string | null;
};

type UpsertRecord = {
  cnj: string;
  tribunal?: string | null;
  orgao?: string | null;
  classe?: string | null;
  assunto?: string | null;
  url?: string | null;
};

type CaseRow = {
  id: number;
  tribunal: string;
  origem: string;
};

/**
 * Extrai o número CNJ de uma string (título, conteúdo ou URL).
 */
function extractCnj(text: string | undefined | null): string | null {
  if (!text) return null;
  const match = text.match(CNJ_REGEX);
  return match ? match[0] : null;
}

/**
 * Normaliza alguns campos básicos a partir do título/conteúdo/URL.
 * Aqui dá para sofisticar depois (identificar tribunal pelo domínio etc).
 */
function inferMetaFromResult(result: TavilyResult, _cnj: string): CaseMeta {
  const url: string = typeof result.url === "string" ? result.url : "";
  const title: string = typeof result.title === "string" ? result.title : "";
  const content: string = typeof result.content === "string" ? result.content : "";

  // Tribunal básico pelo domínio
  let tribunal = "";
  if (url.includes("tjgo.jus.br") || title.includes("TJGO")) tribunal = "TJGO";
  if (url.includes("stj.jus.br") || title.includes("STJ")) tribunal = "STJ";
  if (url.includes("tst.jus.br") || title.includes("TST")) tribunal = "TST";
  if (url.includes("trf") || title.includes("TRF")) tribunal = "TRF";

  // Classe / assunto: heurística simples inicial
  const textoBase = `${title} ${content}`.toUpperCase();

  let classe = "";
  if (textoBase.includes("MANDADO DE SEGURANÇA")) classe = "Mandado de Segurança";
  else if (textoBase.includes("APELAÇÃO")) classe = "Apelação";
  else if (textoBase.includes("AGRAVO")) classe = "Agravo";

  // assunto pode ser refinado depois; por enquanto guarda parte do título
  const assunto = title || null;

  return {
    tribunal: tribunal || null,
    classe: classe || null,
    assunto,
    url: url || null,
  };
}

/**
 * Garante tabela `cases` com colunas necessárias para sincronização automática.
 */
function ensureCasesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_cnj TEXT NOT NULL,
      tribunal TEXT NOT NULL,
      orgao TEXT,
      classe TEXT,
      assunto TEXT,
      origem TEXT NOT NULL CHECK(origem IN ('automatico', 'manual')),
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(numero_cnj, tribunal)
    );
  `);

  const columns = db.prepare("PRAGMA table_info(cases)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("url")) {
    db.exec("ALTER TABLE cases ADD COLUMN url TEXT");
  }

  if (!columnNames.has("last_sync_at")) {
    db.exec("ALTER TABLE cases ADD COLUMN last_sync_at TEXT");
  }
}

/**
 * Insere processo se não existir (base CNJ).
 * Se já existir, apenas atualiza metadados básicos e last_sync_at.
 */
function upsertCase(record: UpsertRecord): boolean {
  const normalizedCnj = normalizarCNJ(record.cnj);
  if (!normalizedCnj || normalizedCnj.length !== 20) {
    return false;
  }

  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT id, tribunal, origem FROM cases WHERE numero_cnj = ? LIMIT 1")
    .get(normalizedCnj) as CaseRow | undefined;

  let tribunal = existing?.tribunal ?? record.tribunal ?? "DESCONHECIDO";

  if (existing && record.tribunal && record.tribunal !== existing.tribunal) {
    db.prepare("UPDATE cases SET tribunal = ?, atualizado_em = ? WHERE id = ?").run(
      record.tribunal,
      now,
      existing.id,
    );
    tribunal = record.tribunal;
  }

  const insert = db.prepare(`
    INSERT INTO cases (numero_cnj, tribunal, orgao, classe, assunto, origem, url, last_sync_at, atualizado_em)
    VALUES (@numero_cnj, @tribunal, @orgao, @classe, @assunto, @origem, @url, @last_sync_at, @atualizado_em)
    ON CONFLICT(numero_cnj, tribunal) DO UPDATE SET
      orgao = COALESCE(excluded.orgao, cases.orgao),
      classe = COALESCE(excluded.classe, cases.classe),
      assunto = COALESCE(excluded.assunto, cases.assunto),
      url = COALESCE(excluded.url, cases.url),
      last_sync_at = excluded.last_sync_at,
      atualizado_em = excluded.atualizado_em;
  `);

  insert.run({
    numero_cnj: normalizedCnj,
    tribunal,
    orgao: record.orgao ?? null,
    classe: record.classe ?? null,
    assunto: record.assunto ?? null,
    origem: existing?.origem ?? "automatico",
    url: record.url ?? null,
    last_sync_at: now,
    atualizado_em: now,
  });

  return !existing;
}

/**
 * Sincroniza processos usando Tavily.
 * - Busca com as queries configuradas
 * - Extrai CNJ
 * - Deduplica por CNJ (map em memória + UNIQUE no banco)
 */
export async function syncCasesFromTavily() {
  ensureCasesTable();

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY não configurada");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const allResults: TavilyResult[] = [];

  for (const query of SEARCH_QUERIES) {
    const { data } = await axios.post(
      "https://api.tavily.com/search",
      {
        query,
        max_results: 25,
      },
      { headers },
    );

    if (Array.isArray(data?.results)) {
      allResults.push(...data.results);
    }
  }

  const byCnj = new Map<string, { result: TavilyResult; cnj: string }>();

  for (const result of allResults) {
    const texto = [result.title, result.content, result.url].filter(Boolean).join(" ");
    const rawCnj = extractCnj(texto);
    if (!rawCnj) continue;

    const normalized = normalizarCNJ(rawCnj);
    if (!normalized || normalized.length !== 20) continue;

    if (!byCnj.has(normalized)) {
      byCnj.set(normalized, { result, cnj: normalized });
    }
  }

  let inserted = 0;
  const total = byCnj.size;

  const tx = db.transaction(() => {
    for (const [normalizedCnj, { result }] of byCnj.entries()) {
      const meta = inferMetaFromResult(result, normalizedCnj);

      const created = upsertCase({
        cnj: normalizedCnj,
        tribunal: meta.tribunal,
        classe: meta.classe,
        assunto: meta.assunto,
        url: meta.url,
      });

      if (created) {
        inserted += 1;
      }
    }
  });

  tx();

  console.log(
    `[syncCasesFromTavily] Total CNJs distintos encontrados: ${total}, novos inseridos: ${inserted}`,
  );

  return {
    ok: true,
    found: total,
    inserted,
  };
}