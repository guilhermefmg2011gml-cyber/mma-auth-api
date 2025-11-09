import { Router } from "express";
import axios from "axios";

const router = Router();

router.get("/tavily/full", async (_req, res) => {
  try {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "TAVILY_API_KEY não configurada" });
    }

    const query = "site:tjgo.jus.br Mandado de Segurança 2024";
    const response = await axios.post(
      "https://api.tavily.com/search",
      { query, max_results: 5 },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    res.json(response.data);
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Erro desconhecido");
    console.error("Erro Tavily:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;