import express from "express";
import { db } from "../db.js";

const router = express.Router();

router.get("/users", (_req, res) => {
  const rows = db.prepare("SELECT id, email, role FROM users").all();
  res.json(rows);
});

export default router;