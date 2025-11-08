/* eslint-env node */
import type { Request, Response } from "express";
import { Router } from "express";
import { db } from "../db.js";
import { comparePassword, signToken } from "../auth.js";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";
import type { AuthenticatedRequest } from "../middleware/attachUser.js";

const router = Router();

interface LoginBody {
  email: string;
  password: string;
}

router.post("/login", async (req: Request<unknown, unknown, LoginBody>, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "INVALID_CREDENTIALS" });
    }
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    res.json({ token });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

router.get("/me", requireAuth, attachUser, (req: AuthenticatedRequest, res: Response) => {
  if (req.user) {
    return res.json({ user: req.user });
  }
  return res.status(401).json({ error: "unauthorized" });
});

router.post("/logout", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;