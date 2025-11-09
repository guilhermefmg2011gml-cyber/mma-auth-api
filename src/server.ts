import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import casesRoutes from "./routes/casesRoutes.js";
import testRoutes from "./routes/test.routes.js";
import { seedAdminIfEnabled } from "./seed.js";
import "./cron.js";

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

app.use(express.json());


app.use("/health", healthRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/test", testRoutes);
app.use("/api/cases", casesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", auditRoutes);

seedAdminIfEnabled().catch(console.error);

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`API on :${PORT} (origins: ${ALLOWED_ORIGINS.join(", ")})`));

export default app;