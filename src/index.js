import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { seedAdminIfEnabled } from "./seed.js"

const app = express();
const ORIGIN = process.env.ALLOWED_ORIGIN || "https://mouramartinsadvogados.com.br";
app.use(
  cors({
    origin: ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/api/health", (_, res) => res.status(200).send("OK"));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

seedAdminIfEnabled().catch((e) => console.error("Seed error:", e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT} (origin: ${ORIGIN})`));