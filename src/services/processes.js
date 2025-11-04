import db from "../db.js";

export function normalizeCNJ(s) {
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  // 0000000-00.0000.0.00.0000
  return digits.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6");
}

// Converte _source Datajud em nosso modelo
export function mapDatajudSource(src) {
  return {
    numero: normalizeCNJ(src.numeroProcesso || src.numero),
    tribunal: src.tribunal?.sigla || src.tribunal || null,
    grau: src.grau || src.instancia || null,
    classeCodigo: src.classe?.codigo || src.codigoClasse || null,
    classeNome: src.classe?.nome || src.classeProcessual || null,
    orgaoCodigo: src.orgaoJulgador?.codigo || null,
    orgaoNome: src.orgaoJulgador?.nome || null,
    dataAjuizamento: src.dataAjuizamento || src.dataDistribuicao || null,
    nivelSigilo: src.nivelSigilo || null,
    assunto: Array.isArray(src.assuntos) ? src.assuntos.map((a) => a.nome).join(" | ") : (src.assunto || null),
    eventos: Array.isArray(src.movimentos) ? src.movimentos : [],
  };
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

// Upsert por número (retorna id)
export function upsertProcessFromDatajud(mapped) {
  if (!mapped?.numero) return null;
  const numero = mapped.numero;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const existing = db
    .prepare(`SELECT id FROM processes WHERE cnj = ? OR cnj_number = ? LIMIT 1`)
    .get(numero, numero);

  const params = {
    cnj: numero,
    cnj_number: numero,
    titulo: normalizeText(mapped.assunto) || normalizeText(mapped.classeNome),
    classe: normalizeText(mapped.classeNome),
    classeCodigo: normalizeText(mapped.classeCodigo),
    classeNome: normalizeText(mapped.classeNome),
    assunto: normalizeText(mapped.assunto),
    subject: normalizeText(mapped.assunto),
    situacao: "Em andamento",
    situation: "Em andamento",
    status: "ativo",
    tribunal: normalizeText(mapped.tribunal),
    grau: normalizeText(mapped.grau),
    orgaoCodigo: normalizeText(mapped.orgaoCodigo),
    orgaoNome: normalizeText(mapped.orgaoNome),
    court: normalizeText(mapped.orgaoNome),
    jurisdiction: normalizeText(mapped.tribunal),
    area: normalizeText(mapped.classeNome),
    data_distribuicao: normalizeText(mapped.dataAjuizamento),
    dataAjuizamento: normalizeText(mapped.dataAjuizamento),
    nivelSigilo: normalizeText(mapped.nivelSigilo),
    fonte: "datajud",
    origin: "datajud",
    updated_at: nowIso,
    created_at: nowIso,
    last_seen_at: nowMs,
  };

  if (!existing) {
    const stmt = db.prepare(`
      INSERT INTO processes (
        cnj, cnj_number, titulo, classe, classeCodigo, classeNome, assunto, subject,
        situacao, situation, status, tribunal, grau, orgaoCodigo, orgaoNome,
        court, jurisdiction, area, data_distribuicao, dataAjuizamento, origin,
        fonte, nivelSigilo, created_at, updated_at, last_seen_at
      ) VALUES (@cnj, @cnj_number, @titulo, @classe, @classeCodigo, @classeNome, @assunto, @subject,
        @situacao, @situation, @status, @tribunal, @grau, @orgaoCodigo, @orgaoNome,
        @court, @jurisdiction, @area, @data_distribuicao, @dataAjuizamento, @origin,
        @fonte, @nivelSigilo, @created_at, @updated_at, @last_seen_at)
    `);
    const info = stmt.run(params);
    return info.lastInsertRowid;
  }

  db.prepare(`
    UPDATE processes SET
      cnj = COALESCE(@cnj, cnj),
      cnj_number = COALESCE(@cnj_number, cnj_number),
      titulo = COALESCE(@titulo, titulo),
      classe = COALESCE(@classe, classe),
      classeCodigo = COALESCE(@classeCodigo, classeCodigo),
      classeNome = COALESCE(@classeNome, classeNome),
      assunto = COALESCE(@assunto, assunto),
      subject = COALESCE(@subject, subject),
      situacao = COALESCE(@situacao, situacao),
      situation = COALESCE(@situation, situation),
      status = COALESCE(@status, status),
      tribunal = COALESCE(@tribunal, tribunal),
      grau = COALESCE(@grau, grau),
      orgaoCodigo = COALESCE(@orgaoCodigo, orgaoCodigo),
      orgaoNome = COALESCE(@orgaoNome, orgaoNome),
      court = COALESCE(@court, court),
      jurisdiction = COALESCE(@jurisdiction, jurisdiction),
      area = COALESCE(@area, area),
      data_distribuicao = COALESCE(@data_distribuicao, data_distribuicao),
      dataAjuizamento = COALESCE(@dataAjuizamento, dataAjuizamento),
      nivelSigilo = COALESCE(@nivelSigilo, nivelSigilo),
      fonte = 'datajud',
      origin = COALESCE(origin, 'datajud'),
      updated_at = @updated_at,
      last_seen_at = @last_seen_at
    WHERE id = @id
  `).run({ ...params, id: existing.id });

  return existing.id;
}

// Ingestão de eventos com dedup (process_id, codigo, dataHora)
export function insertEventsFromDatajud(processId, numero, movimentos = []) {
  if (!processId || !Array.isArray(movimentos)) return 0;

  const ins = db.prepare(`
    INSERT INTO process_events (
      process_id, codigo, nome, dataHora, raw,
      tipo, descricao, data_evento, origem, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let n = 0;
  for (const m of movimentos) {
    const codigo = m?.codigo || m?.identificador || "";
    const nome = m?.nome || m?.descricao || "Movimento";
    const dataHora = m?.dataHora || m?.data || null;

    const exists = db
      .prepare(`SELECT 1 FROM process_events WHERE process_id = ? AND codigo = ? AND dataHora = ?`)
      .get(processId, codigo || null, dataHora || null);
    if (exists) continue;

    const payload = JSON.stringify(m);
    const createdAt = new Date().toISOString();

    ins.run(
      processId,
      codigo || null,
      nome || null,
      dataHora || null,
      payload,
      codigo || null,
      nome || null,
      dataHora || null,
      "datajud",
      payload,
      createdAt
    );
    n++;
  }
  return n;
}

export default {
  normalizeCNJ,
  mapDatajudSource,
  upsertProcessFromDatajud,
  insertEventsFromDatajud,
};