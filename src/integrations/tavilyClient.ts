import axios from "axios";

const DEFAULT_API_URL = "https://api.tavily.com/search";
const TAVILY_API_URL = process.env.TAVILY_API_URL || DEFAULT_API_URL;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export interface FoundProcess {
  numero_cnj: string;
  tribunal: string;
  orgao?: string;
  classe?: string;
  assunto?: string;
  partes?: string[];
}

export interface FoundMovement {
  data: string;
  orgao?: string;
  descricao: string;
}

interface TavilyResultItem {
  title?: string;
  content?: string;
  snippet?: string;
  url?: string;
  published_date?: string;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

interface TavilySearchResponse {
  results?: TavilyResultItem[];
  hits?: TavilyResultItem[];
}

function extractDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalizeCnj(value: string): string | null {
  const digits = extractDigits(value);
  if (digits.length !== 20) {
    return null;
  }
  return digits;
}

function getStringField(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

function inferTribunalFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    const tribunalMatch = hostname.match(/tj[a-z]{2}|trf\d+|trt\d+|stj|stf|tst|tse/i);
    if (tribunalMatch) {
      return tribunalMatch[0].toUpperCase();
    }
    return hostname;
  } catch {
    return null;
  }
}

function collectProcessesFromResult(item: TavilyResultItem): FoundProcess[] {
  const text = [item.title, item.content, item.snippet].filter(Boolean).join(" \n");
  const matches = new Set<string>();
  const regex = /(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})|(\d{20})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const normalized = normalizeCnj(raw);
    if (normalized) {
      matches.add(normalized);
    }
  }

  if (!matches.size) {
    return [];
  }

  const tribunalFromMetadata = getStringField(item.metadata, "tribunal") ?? getStringField(item.attributes, "tribunal");

  const tribunal = tribunalFromMetadata || inferTribunalFromUrl(item.url) || "DESCONHECIDO";
  const orgao = getStringField(item.metadata, "orgao") ?? getStringField(item.attributes, "orgao") ?? undefined;
  const classe = getStringField(item.metadata, "classe") ?? getStringField(item.attributes, "classe") ?? undefined;
  const assunto = getStringField(item.metadata, "assunto") ?? getStringField(item.attributes, "assunto") ?? undefined;

  return Array.from(matches).map((numero) => ({
    numero_cnj: numero,
    tribunal,
    orgao,
    classe,
    assunto,
  }));
}

function normalizeDate(value?: string): string | null {
  if (!value) return null;
  const iso = new Date(value);
  if (Number.isNaN(iso.getTime())) return null;
  return iso.toISOString();
}

function parseMovementLines(text: string): FoundMovement[] {
  const lines = text
    .split(/\r?\n|\s{2,}|-\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const movements: FoundMovement[] = [];

  for (const line of lines) {
    const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})|(\d{4}-\d{2}-\d{2})/);
    const dateText = dateMatch ? dateMatch[0] : null;
    let isoDate: string | null = null;
    if (dateText) {
      if (dateText.includes("/")) {
        const [day, month, year] = dateText.split("/");
        const parsed = new Date(Number(year), Number(month) - 1, Number(day));
        if (!Number.isNaN(parsed.getTime())) {
          isoDate = parsed.toISOString();
        }
      } else {
        const parsed = new Date(dateText);
        if (!Number.isNaN(parsed.getTime())) {
          isoDate = parsed.toISOString();
        }
      }
    }

    const descricao = dateText ? line.replace(dateText, "").trim() : line;
    if (!descricao) continue;

    movements.push({
      data: isoDate ?? new Date().toISOString(),
      descricao,
    });
  }

  return movements;
}

function collectMovementsFromResult(item: TavilyResultItem): FoundMovement[] {
  const text = [item.title, item.content, item.snippet].filter(Boolean).join(" \n");
  const parsed = parseMovementLines(text);
  if (parsed.length) {
    return parsed;
  }

  const fallbackDate = normalizeDate(item.published_date) ?? new Date().toISOString();
  const descricao = item.title || item.content || item.snippet;
  if (!descricao) {
    return [];
  }

  return [
    {
      data: fallbackDate,
      descricao,
    },
  ];
}

function extractResults(data: TavilySearchResponse): TavilyResultItem[] {
  if (Array.isArray(data.results) && data.results.length) {
    return data.results;
  }
  if (Array.isArray(data.hits) && data.hits.length) {
    return data.hits;
  }
  return [];
}

async function performSearch(query: string, maxResults: number): Promise<TavilyResultItem[]> {
  if (!TAVILY_API_KEY) {
    console.warn("[tavily] API key not configured; returning empty result set");
    return [];
  }

  const { data } = await axios.post<TavilySearchResponse>(
    TAVILY_API_URL,
    {
      api_key: TAVILY_API_KEY,
      query,
      max_results: maxResults,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return extractResults(data);
}

export async function searchProcessesByLawyer(name: string, oab: string): Promise<FoundProcess[]> {
  const query = `processos em nome de ${name} ${oab} em tribunais brasileiros (retorne número CNJ e tribunal)`;
  const items = await performSearch(query, 20);
  const map = new Map<string, FoundProcess>();

  for (const item of items) {
    for (const process of collectProcessesFromResult(item)) {
      const key = `${process.numero_cnj}|${process.tribunal}`;
      if (!map.has(key)) {
        map.set(key, process);
      }
    }
  }

  return Array.from(map.values());
}

export async function searchMovementsByCase(numero_cnj: string, tribunal: string): Promise<FoundMovement[]> {
  const query = `ultimas movimentações do processo ${numero_cnj} no tribunal ${tribunal}`;
  const items = await performSearch(query, 30);
  const movements: FoundMovement[] = [];

  for (const item of items) {
    movements.push(...collectMovementsFromResult(item));
  }

  return movements
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())
    .filter((movement, index, self) => {
      const signature = `${movement.data}|${movement.descricao}`;
      return index === self.findIndex((other) => `${other.data}|${other.descricao}` === signature);
    });
}