/* eslint-env node */
import express from "express";
import { db } from "../db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import requireAuth from "../middleware/requireAuth.js";
import attachUser from "../middleware/attachUser.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "secret",
      { expiresIn: process.env.JWT_EXPIRES || "8h" }
    );

    res.json({ token });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

router.get("/me", requireAuth, attachUser, (req, res) => {
  if (req.user) {
    return res.json({ user: req.user });
  }
  return res.status(401).json({ error: "unauthorized" });
});

router.post("/logout", (_req, res) => {
  res.json({ ok: true });
});

export default router;