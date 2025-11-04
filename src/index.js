/* eslint-env node */
import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import casesRoutes from "./routes/casesRoutes.js";
import pdpjRoutes from "./routes/pdpjRoutes.js";
import { seedAdminIfEnabled } from "./seed.js";
import { syncByAllTrackedOABs } from "./services/syncService.js";

const app = express();
const ORIGIN =
  process.env.ALLOWED_ORIGIN || process.env.CORS_ORIGIN || "https://mouramartinsadvogados.com.br";

app.use(cors({
  origin: ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use("/api/pdpj/webhook", express.raw({ type: "*/*", limit: "2mb" }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.send("OK"));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pdpj", pdpjRoutes);
app.use("/api", casesRoutes);
app.use("/api", auditRoutes);

seedAdminIfEnabled().catch(console.error);

const PORT = process.env.PORT || 8080;
const intervalMin = Number(process.env.SYNC_INTERVAL_MINUTES || 30);
const syncEnabled = String(process.env.SYNC_ENABLED || "true") === "true";

if (syncEnabled) {
  setInterval(async () => {
    try {
      const r = await syncByAllTrackedOABs();
      console.log(`[SYNC PDPJ] total=${r.total} novos=${r.novos}`);
    } catch (e) {
      console.error("[SYNC PDPJ] erro:", e?.message || e);
    }
  }, intervalMin * 60 * 1000);
  console.log(`[SYNC PDPJ] habilitado a cada ${intervalMin} min`);
}
app.listen(PORT, () => console.log(`API on :${PORT} (origin: ${ORIGIN})`));