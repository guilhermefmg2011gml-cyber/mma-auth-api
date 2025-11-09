import { Router, type Request, type Response } from "express";
import axios from "axios";

const router = Router();

/**
 * Teste simples: verifica se a TAVILY_API_KEY está carregada
 * e faz 1 busca controlada.
 *
 * ROTA PÚBLICA - NÃO PODE EXIGIR JWT
 */
router.get("/tavily/full", async (_req: Request, res: Response) => {
  try {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: "TAVILY_API_KEY not set" });
    }

    const query =
      'site:tjgo.jus.br "Mandado de Segurança" OR "Moura Martins Advogados"';

    const tavilyRes = await axios.post(
      "https://api.tavily.com/search",
      {
        query,
        max_results: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      status: "ok",
      query,
      tavily: tavilyRes.data,
    });
  } catch (err: any) {
    console.error("Tavily test error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "TAVILY_REQUEST_FAILED",
      detail: err.response?.data || err.message,
    });
  }
});

export default router;