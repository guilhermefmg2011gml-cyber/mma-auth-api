import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import { seedAdminIfEnabled } from "./seed.js";

const app = express();
const ORIGIN = process.env.ALLOWED_ORIGIN || process.env.CORS_ORIGIN || "https://mouramartinsadvogados.com.br";

app.use(cors({
  origin: ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

app.get("/api/health", (_req, res) => res.send("OK"));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", auditRoutes);

seedAdminIfEnabled().catch(console.error);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API on :${PORT} (origin: ${ORIGIN})`));