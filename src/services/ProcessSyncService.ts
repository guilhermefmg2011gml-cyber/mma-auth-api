import crypto from "crypto";
import { db } from "../db.js";
import {
  searchProcessesByLawyer,
  searchMovementsByCase,
  type FoundProcess,
  type FoundMovement,
} from "../integrations/tavilyClient.js";

export type CaseOrigin = "automatico" | "manual";

export interface WatchTarget {
  id: number;
  tipo: "lawyer" | "case";
  valor: string;
  ativo: number;
}

export interface Lawyer {
  id: number;
  nome: string;
  oab_numero: string | null;
  oab_uf: string | null;
  tipo: string;
}

export interface CaseRow {
  id: number;
  numero_cnj: string;
  tribunal: string;
  orgao?: string | null;
  classe?: string | null;
  assunto?: string | null;
}

export function normalizarCNJ(num: string): string {
  return num.replace(/\D+/g, "");
}

export function hashMovement(m: FoundMovement): string {
  return crypto.createHash("sha256").update(`${m.data}|${m.orgao ?? ""}|${m.descricao}`).digest("hex");
}

export function classifyMovement(descricao: string): { tipo: string; exigeAcao: boolean; prazoDias?: number } {
  const d = descricao.toLowerCase();

  if (d.includes("citação") || (d.includes("intima") && d.includes("contestação"))) {
    return { tipo: "intimacao", exigeAcao: true, prazoDias: 15 };
  }

  if (d.includes("embargos de declaração") && d.includes("prazo")) {
    return { tipo: "intimacao", exigeAcao: true, prazoDias: 5 };
  }

  if (d.includes("sentença") || d.includes("sentenca")) {
    return { tipo: "sentenca", exigeAcao: false };
  }

  if (d.includes("prazo") && d.includes("apresentar")) {
    return { tipo: "intimacao", exigeAcao: true, prazoDias: 15 };
  }

  return { tipo: "outros", exigeAcao: false };
}

export function addBusinessDays(start: Date, days: number): Date {
  const date = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    if (!isWeekend) {
      remaining -= 1;
    }
  }
  return date;
}

export async function upsertCase(found: FoundProcess, origem: CaseOrigin): Promise<number> {
  const numero = normalizarCNJ(found.numero_cnj);
  if (!numero) {
    throw new Error(`Número CNJ inválido: ${found.numero_cnj}`);
  }

  const existing = db
    .prepare(
      "SELECT id, numero_cnj, tribunal, orgao, classe, assunto, origem FROM cases WHERE numero_cnj=? AND tribunal=?"
    )
    .get(numero, found.tribunal) as (CaseRow & { origem: CaseOrigin }) | undefined;

  const agora = new Date().toISOString();

  if (!existing) {
    const info = db
      .prepare(
        "INSERT INTO cases (numero_cnj, tribunal, orgao, classe, assunto, origem, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)"
      )
      .run(
        numero,
        found.tribunal,
        found.orgao ?? null,
        found.classe ?? null,
        found.assunto ?? null,
        origem,
        agora,
        agora
      );

    return Number(info.lastInsertRowid);
  }

  const updateFields: string[] = [];
  const updateValues: unknown[] = [];

  if (found.orgao && found.orgao !== existing.orgao) {
    updateFields.push("orgao=?");
    updateValues.push(found.orgao);
  }

  if (found.classe && found.classe !== existing.classe) {
    updateFields.push("classe=?");
    updateValues.push(found.classe);
  }

  if (found.assunto && found.assunto !== existing.assunto) {
    updateFields.push("assunto=?");
    updateValues.push(found.assunto);
  }

  if (updateFields.length) {
    updateFields.push("atualizado_em=?");
    updateValues.push(agora);
    updateValues.push(existing.id);
    db.prepare(`UPDATE cases SET ${updateFields.join(", ")} WHERE id=?`).run(...updateValues);
  } else {
    db.prepare("UPDATE cases SET atualizado_em=? WHERE id=?").run(agora, existing.id);
  }

  return existing.id;
}

export async function attachLawyersToCase(caseId: number, lawyers: Array<Pick<Lawyer, "id">>): Promise<void> {
  for (const lawyer of lawyers) {
    const existing = db.prepare("SELECT id FROM case_lawyers WHERE case_id=? AND lawyer_id=?").get(caseId, lawyer.id);
    if (!existing) {
      db.prepare("INSERT INTO case_lawyers (case_id, lawyer_id, papel) VALUES (?,?,?)").run(caseId, lawyer.id, "advogado");
    }
  }
}

export async function syncCaseMovements(caseId: number, numero_cnj: string, tribunal: string): Promise<void> {
  const movimentos = await searchMovementsByCase(numero_cnj, tribunal);
  const agora = new Date().toISOString();

  for (const mov of movimentos) {
    const hash = hashMovement(mov);
    const exists = db.prepare("SELECT id FROM case_movements WHERE case_id=? AND hash_conteudo=?").get(caseId, hash);
    if (exists) continue;

    const classificacao = classifyMovement(mov.descricao);
    let prazoFinal: Date | null = null;
    const movementDate = new Date(mov.data);
    const normalizedDate = Number.isNaN(movementDate.getTime()) ? new Date() : movementDate;
    if (classificacao.exigeAcao && classificacao.prazoDias) {
      prazoFinal = addBusinessDays(new Date(normalizedDate), classificacao.prazoDias);
    }

    db.prepare(
      `INSERT INTO case_movements (
        case_id, data, descricao, orgao, tipo, exige_acao, prazo_dias, prazo_final, status, hash_conteudo
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      caseId,
      normalizedDate.toISOString(),
      mov.descricao,
      mov.orgao ?? null,
      classificacao.tipo,
      classificacao.exigeAcao ? 1 : 0,
      classificacao.prazoDias ?? null,
      prazoFinal ? prazoFinal.toISOString().slice(0, 10) : null,
      classificacao.exigeAcao ? "pendente" : "concluido",
      hash
    );
  }

  db.prepare("UPDATE cases SET atualizado_em=? WHERE id=?").run(agora, caseId);
}

function parseTargetValue(valor: string): { nome: string; oab: string } | null {
  const [nome, rawOab] = valor.split("|");
  if (!nome || !rawOab) {
    return null;
  }
  return {
    nome: nome.trim(),
    oab: rawOab.trim(),
  };
}

function ensureWatchLog(target: WatchTarget, status: "ok" | "erro", detalhes: string | null, inicio: string, fim: string) {
  db.prepare(
    "INSERT INTO sync_logs (alvo, inicio, fim, status, detalhes) VALUES (?,?,?,?,?)"
  ).run(`${target.tipo}:${target.valor}`, inicio, fim, status, detalhes);
}

export async function runDailySync(): Promise<void> {
  const targets = db
    .prepare("SELECT id, tipo, valor, ativo FROM watch_targets WHERE ativo=1")
    .all() as WatchTarget[];

  for (const target of targets) {
    const inicio = new Date().toISOString();
    try {
      if (target.tipo === "lawyer") {
        const parsed = parseTargetValue(target.valor);
        if (!parsed) {
          throw new Error(`Valor de alvo inválido: ${target.valor}`);
        }

        const processos = await searchProcessesByLawyer(parsed.nome, parsed.oab);
        const lawyer = db
          .prepare("SELECT * FROM lawyers WHERE nome=?")
          .get(parsed.nome.trim()) as Lawyer | undefined;
        const lawyersToAttach = lawyer ? [lawyer] : [];

        for (const processo of processos) {
          const caseId = await upsertCase(processo, "automatico");
          if (lawyersToAttach.length) {
            await attachLawyersToCase(caseId, lawyersToAttach);
          }
          await syncCaseMovements(caseId, processo.numero_cnj, processo.tribunal);
        }
      }

      if (target.tipo === "case") {
        const numero = normalizarCNJ(target.valor);
        const processo = db
          .prepare("SELECT * FROM cases WHERE numero_cnj=?")
          .get(numero) as (CaseRow & { tribunal: string }) | undefined;
        if (processo) {
          await syncCaseMovements(processo.id, processo.numero_cnj, processo.tribunal);
        }
      }

      const fim = new Date().toISOString();
      ensureWatchLog(target, "ok", null, inicio, fim);
    } catch (error) {
      const fim = new Date().toISOString();
      const message = error instanceof Error ? error.message.slice(0, 1000) : "erro desconhecido";
      ensureWatchLog(target, "erro", message, inicio, fim);
      console.error(`[sync] erro ao processar alvo ${target.tipo}:${target.valor}`, error);
    }
  }
}

export async function createManualCase(input: {
  numero_cnj: string;
  tribunal: string;
  orgao?: string;
  classe?: string;
  assunto?: string;
}): Promise<number> {
  const caseId = await upsertCase(
    {
      numero_cnj: input.numero_cnj,
      tribunal: input.tribunal,
      orgao: input.orgao,
      classe: input.classe,
      assunto: input.assunto,
    },
    "manual"
  );

  const numero = normalizarCNJ(input.numero_cnj);
  db.prepare("INSERT OR IGNORE INTO watch_targets (tipo, valor, ativo) VALUES (?,?,?)").run("case", numero, 1);

  return caseId;
}