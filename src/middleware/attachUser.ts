import type { NextFunction, Request, Response } from "express";
import { db } from "../db.js";

const PERMS: Record<string, string[]> = {
  admin: [
    "*",
    "users:read",
    "users:create",
    "users:update",
    "users:delete",
    "roles:assign",
    "logs:read",
    "audit:read",
  ],
  gestor: [
    "users:read",
    "users:create",
    "users:update",
    "logs:read",
    "audit:read",
  ],
  colab: [],
};

export interface AuthenticatedRequest extends Request {
  auth?: {
    id: number;
  };
  user?: {
    id: number;
    email: string;
    role: string;
    permissions: string[];
  };
}

export default function attachUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void {
  try {
    if (!req.auth?.id) {
      return res.status(401).json({ error: "USER_NOT_FOUND" });
    }

    const u = db.prepare("SELECT id, email, role FROM users WHERE id=?").get(req.auth.id);
    if (!u) return res.status(401).json({ error: "USER_NOT_FOUND" });
    req.user = { ...u, permissions: PERMS[u.role] || [] };
    return next();
  } catch (error) {
    console.error("attachUser error:", error.message);
    return res.status(500).json({ error: "USER_LOOKUP_FAILED" });
  }
}