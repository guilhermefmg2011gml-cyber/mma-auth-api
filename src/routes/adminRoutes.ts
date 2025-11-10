import type { Request, Response } from "express";
import { Router } from "express";
import { db } from "../db.js";
import requireAuth from "../middleware/requireAuth.js";
import attachUser, { type AuthenticatedRequest } from "../middleware/attachUser.js";
import requirePermission from "../middleware/requirePermission.js";
import bcrypt from "bcryptjs";
import { audit } from "../audit.js";
import { v4 as uuidv4 } from "uuid";
import {
  TIPOS_PECA,
  buildDocxFromPiece,
  generateLegalDocument,
  getGeneratedPiece,
  storeGeneratedPiece,
  type GenerateLegalDocumentInput,
  type ParteData,
  type TipoPeca,
  MissingRequiredFieldsError,
} from "../services/legalDocGenerator.js";

const router = Router();

router.use(requireAuth, attachUser, requirePermission("users:read"));

const TIPO_PECA_SET = new Set<string>(TIPOS_PECA);

function sanitizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsePartes(raw: unknown): ParteData[] {
  if (!Array.isArray(raw)) return [];
  const partes: ParteData[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const nome = sanitizeText((item as Record<string, unknown>).nome);
    const papelRaw = sanitizeText((item as Record<string, unknown>).papel) as ParteData["papel"] | null;
    const qualificacao = sanitizeText((item as Record<string, unknown>).qualificacao);

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

function normalizeDocumentList(raw: unknown): string[] | undefined {
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

router.get("/users", (_req: Request, res: Response) => {
  const rows = db.prepare("SELECT id, email, role FROM users ORDER BY id DESC").all();
  res.json(rows);
});

router.post("/users", requirePermission("users:create"), (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const { email, password, role = "colab" } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "EMAIL_PASSWORD_REQUIRED" });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?,?,?)").run(email, hash, role);
    audit({
      byUserId: req.user.id,
      byUserEmail: req.user.email,
      action: "users:create",
      entity: "users",
      entityId: info.lastInsertRowid,
      diff: { email, role },
      ip: req.ip,
      ua: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });
    res.status(201).json({ id: info.lastInsertRowid, email, role });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "EMAIL_IN_USE" });
    throw e;
  }
});

router.put("/users/:id", requirePermission("users:update"), (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const id = Number(req.params.id);
  const { email, password, role } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!user) return res.status(404).json({ error: "NOT_FOUND" });

  const diff: Record<string, unknown> = {};
  if (email && email !== user.email) diff.email = [user.email, email];
  if (role && role !== user.role) diff.role = [user.role, role];

  const fields: string[] = [];
  const values: unknown[] = [];
  if (email) {
    fields.push("email=?");
    values.push(email);
  }
  if (role) {
    fields.push("role=?");
    values.push(role);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    fields.push("password_hash=?");
    values.push(hash);
    diff.password = "[updated]";
  }
  if (!fields.length) return res.json({ ok: true });

  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(",")} WHERE id=?`).run(...values);

  audit({
    byUserId: req.user.id,
    byUserEmail: req.user.email,
    action: "users:update",
    entity: "users",
    entityId: id,
    diff,
    ip: req.ip,
    ua: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  });

  res.json({ ok: true });
});

router.delete("/users/:id", requirePermission("users:delete"), (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  const id = Number(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "NOT_FOUND" });
  db.prepare("DELETE FROM users WHERE id=?").run(id);

  audit({
    byUserId: req.user.id,
    byUserEmail: req.user.email,
    action: "users:delete",
    entity: "users",
    entityId: id,
    diff: { email: u.email },
    ip: req.ip,
    ua: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  });

  res.json({ ok: true });
});

router.post("/ai/gerador-pecas", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    const body = req.body ?? {};
    const tipoPecaRaw = sanitizeText(body.tipo_peca);
    if (!tipoPecaRaw || !TIPO_PECA_SET.has(tipoPecaRaw)) {
      return res.status(400).json({ error: "TIPO_PECA_INVALIDO" });
    }

    const partes = parsePartes(body.partes);
    
    const pedidos = sanitizeText(body.pedidos);
    const documentos = normalizeDocumentList(body.documentos);
    const clienteId = sanitizeText(body.cliente_id);

    const payload: GenerateLegalDocumentInput = {
      tipoPeca: tipoPecaRaw as TipoPeca,
      resumoFatico: sanitizeText(body.resumo_fatico) ?? "",
      partes,
    };

    if (pedidos) {
      payload.pedidos = pedidos;
    }

    if (documentos) {
      payload.documentos = documentos;
    }

    if (clienteId) {
      payload.clienteId = clienteId;
    }

    const resultado = await generateLegalDocument(payload);
    const id = uuidv4();

    storeGeneratedPiece(id, {
      tipo: payload.tipoPeca,
      texto: resultado.texto,
      createdAt: new Date(),
      artigos: resultado.artigos,
    });

    audit({
      byUserId: req.user.id,
      byUserEmail: req.user.email,
      action: "ai:generate_piece",
      entity: "ai_generator",
      entityId: null,
      diff: {
        id,
        tipo: payload.tipoPeca,
        partes: partes.map((parte) => `${parte.papel}:${parte.nome}`),
        clienteId: payload.clienteId ?? null,
      },
      ip: req.ip,
      ua: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });

    return res.json({
      id,
      tipo: payload.tipoPeca,
      textoGerado: resultado.texto,
      jurisprudenciasSugeridas: resultado.jurisprudencias.map((item) => ({
        titulo: item.title ?? null,
        resumo: item.snippet ?? item.content ?? null,
        url: item.url ?? null,
        publicadoEm: item.publishedAt ?? null,
      })),
      artigosValidados: resultado.artigos.map((item) => ({
        artigo: item.artigo,
        confirmado: item.confirmado,
        referencia: item.referencia ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof MissingRequiredFieldsError) {
      return res.status(422).json({
        error: "CAMPOS_OBRIGATORIOS",
        campos: error.campos,
        message: error.message,
      });
    }

    console.error("[adminRoutes] falha ao gerar peça", error);
    const message = error instanceof Error ? error.message : "ERRO_INTERNO";
    return res.status(500).json({ error: "ERRO_GERACAO_PECA", message });
  }
});

router.get("/ai/gerador-pecas/:id/exportar", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "ID_OBRIGATORIO" });
  }

  const piece = getGeneratedPiece(id);
  if (!piece) {
    return res.status(404).json({ error: "PECA_NAO_ENCONTRADA" });
  }

  try {
    const buffer = await buildDocxFromPiece(piece);
    const filename = `peca_${id}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("[adminRoutes] falha ao exportar peça", error);
    return res.status(500).json({ error: "ERRO_EXPORTAR_PECA" });
  }
});

export default router;