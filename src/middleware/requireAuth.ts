/* eslint-env node */
import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthenticatedRequest } from "./attachUser.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "secret";

export default function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "NO_TOKEN" });

  try {
    const data = jwt.verify(token, JWT_SECRET);
    if (typeof data !== "object" || data === null || typeof (data as { id?: unknown }).id !== "number") {
      return res.status(401).json({ error: "INVALID_TOKEN" });
    }

    req.auth = { id: (data as { id: number }).id };
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}