import { DATAJUD_API_BASE, DATAJUD_API_KEY, DATAJUD_AUTH_TOKEN, DATAJUD_CNJ_JWT } from "../config/datajud.js";

const BASE = DATAJUD_API_BASE || "https://api-publica.datajud.cnj.jus.br";

class DatajudError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "DatajudError";
    this.status = status;
    this.body = body;
  }
}

function buildHeaders() {
  if (!DATAJUD_API_KEY && !DATAJUD_AUTH_TOKEN) {
    throw new Error("DATAJUD credentials ausentes nas variáveis de ambiente.");
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (DATAJUD_AUTH_TOKEN) {
    headers.Authorization = DATAJUD_AUTH_TOKEN.startsWith("Bearer ")
      ? DATAJUD_AUTH_TOKEN
      : `Bearer ${DATAJUD_AUTH_TOKEN}`;
  } else if (DATAJUD_API_KEY) {
    headers.Authorization = `APIKey ${DATAJUD_API_KEY}`;
  }

  if (DATAJUD_API_KEY) {
    headers["x-api-key"] = DATAJUD_API_KEY;
  }

  if (DATAJUD_CNJ_JWT) {
    headers["x-cnj-jwt"] = DATAJUD_CNJ_JWT;
  }

  return headers;
}

export async function datajudPOST(alias, path, body, options = {}) {
  const url = `${BASE}/${alias}${path}`;
  const headers = buildHeaders();
  const request = {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  };

  const response = await fetch(url, request);
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      if (!response.ok) {
        throw new DatajudError(`Datajud ${alias} ${response.status}`, {
          status: response.status,
          body: text.slice(0, 400),
        });
      }
      throw new DatajudError(`Datajud ${alias}: resposta não-JSON`, {
        status: response.status,
        body: text.slice(0, 400),
      });
    }
  }

  if (!response.ok) {
    throw new DatajudError(`Datajud ${alias} ${response.status}`, {
      status: response.status,
      body: payload ?? text.slice(0, 400),
    });
  }

  return payload;
}

export { DatajudError };