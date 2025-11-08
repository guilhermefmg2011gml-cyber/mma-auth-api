import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./attachUser.js";

export default function requirePermission(perm: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void => {
    try {
      const role = req.user?.role;
      const perms = req.user?.permissions || [];
      if (role === "admin" || perms.includes("*") || perms.includes(perm)) {
        return next();
      }
      return res.status(403).json({ message: "Permissão insuficiente" });
    } catch {
      return res.status(500).json({ message: "Erro interno" });
    }
  };
}