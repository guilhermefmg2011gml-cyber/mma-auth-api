/* eslint-env node */
import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import casesRoutes from "./routes/casesRoutes.js";
import processRoutes from "./routes/processRoutes.js";
import pdpjRoutes from "./routes/pdpjRoutes.js";
import datajudRoutes from "./routes/datajudRoutes.js";
import { seedAdminIfEnabled } from "./seed.js";
import { db } from "./db.js";

const app = express();

const DEFAULT_ALLOWED_ORIGINS = [
  "https://mouramartinsadvogados.com.br",
  "https://www.mouramartinsadvogados.com.br",
];

const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8080"];

const ALLOWED_ORIGINS = [
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.NODE_ENV !== "production" ? DEV_ORIGINS : []),
];

console.log("[cors] allowed origins:", ALLOWED_ORIGINS.join(", "));

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use("/api/pdpj/webhook", express.raw({ type: "*/*", limit: "2mb" }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.send("OK"));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pdpj", pdpjRoutes);
app.use("/api", datajudRoutes);
app.use("/api", processRoutes);
app.use("/api", casesRoutes);
app.use("/api", auditRoutes);

seedAdminIfEnabled().catch(console.error);

const PORT = process.env.PORT || 8080;
async function syncPdpjByOabUf(oabTag) {
  try {
    console.log("[cron] sincronizando", oabTag);
    const any = db.prepare(`SELECT id FROM processes ORDER BY updated_at DESC LIMIT 1`).get();
    if (any) {
      db.prepare(`UPDATE processes SET updated_at = datetime('now') WHERE id = ?`).run(any.id);
      db.prepare(`
        INSERT INTO process_events (process_id, tipo, descricao, data_evento, origem, payload)
        VALUES (?, 'sync', ?, datetime('now'), 'CRON', ?)
      `).run(any.id, `Sincronização CRON (${oabTag})`, JSON.stringify({ oabTag }));
    }
  } catch (e) {
    console.error("[cron] erro:", e.message || e);
  }
}

let cronScheduler;
async function scheduleWithCron(spec, handler, options) {
  if (!cronScheduler) {
    try {
      const mod = await import("node-cron");
      const cron = mod.default ?? mod;
      cronScheduler = (pattern, fn, opts) => cron.schedule(pattern, fn, opts);
    } catch (error) {
      console.warn(
        "[cron] node-cron indisponível, usando fallback setInterval.",
        error?.message || error
      );
      cronScheduler = (pattern, fn) => {
        const parts = String(pattern || "").trim().split(/\s+/);
        let hours = 6;
        if (parts.length >= 2 && /^\*\/[0-9]+$/.test(parts[1])) {
          const parsed = Number(parts[1].slice(2));
          if (!Number.isNaN(parsed) && parsed > 0) {
            hours = parsed;
          }
        }
        const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;
        const timer = setInterval(() => {
          Promise.resolve(fn()).catch((err) => console.error("[cron] fallback erro:", err?.message || err));
        }, intervalMs);
        return {
          stop: () => clearInterval(timer),
        };
      };
    }
  }
  return cronScheduler(spec, handler, options);
}
(async function scheduleCron() {
  const spec = process.env.SYNC_CRON || "0 */6 * * *";
  if (process.env.OABS_SYNC) {
    const list = process.env.OABS_SYNC.split(",").map((s) => s.trim()).filter(Boolean);
    await scheduleWithCron(
      spec,
      async () => {
        for (const oab of list) {
          await syncPdpjByOabUf(oab);
        }
      },
      { timezone: "America/Sao_Paulo" }
    );
    console.log("[cron] agendado:", spec, "OABs:", process.env.OABS_SYNC);
  } else {
    console.log("[cron] OABS_SYNC não definido — sincronização desativada.");
  }
})();

(async function scheduleDatajud() {
  const SPEC = process.env.SYNC_CRON || "0 */6 * * *";
  const SYNC_ENABLED = (process.env.SYNC_ENABLED ?? "true") !== "false";
  if (!SYNC_ENABLED) {
    console.log("[cron] Datajud sync desativado.");
    return;
  }
  await scheduleWithCron(
    SPEC,
    async () => {
      try {
        console.log("[CRON] Datajud sync start");
        const r = await fetch(`http://localhost:${process.env.PORT || 8080}/api/datajud/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Cron": "1" },
          body: JSON.stringify({}),
        });
        console.log("[CRON] Datajud sync status:", r.status);
      } catch (e) {
        console.error("[CRON] Datajud sync error:", e?.message || e);
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
  console.log("[cron] Datajud sync agendado:", SPEC);
})();

app.listen(PORT, () => console.log(`API on :${PORT} (origins: ${ALLOWED_ORIGINS.join(", ")})`));