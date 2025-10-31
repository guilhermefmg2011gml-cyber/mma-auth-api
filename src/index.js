import "dotenv/config";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { seedAdminIfEnabled } from "./seed.js";


const app = express();
// Aceita ALLOWED_ORIGIN (código anterior) ou CORS_ORIGIN (como está no Railway)
const ORIGIN = process.env.ALLOWED_ORIGIN || process.env.CORS_ORIGIN || "*";

app.use(cors({
  origin: ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

app.get("/api/health", (_req, res) => res.status(200).send("OK"));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

seedAdminIfEnabled().catch((e) => console.error("Seed error:", e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT} (origin: ${ORIGIN})`));