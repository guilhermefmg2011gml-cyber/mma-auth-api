let _token = null;
let _exp = 0; // timestamp (segundos)

const now = () => Math.floor(Date.now() / 1000);

export async function getPdpjToken() {
  const { PDPJ_SSO_TOKEN_URL, PDPJ_CLIENT_ID, PDPJ_CLIENT_SECRET } = process.env;

  if (!PDPJ_SSO_TOKEN_URL || !PDPJ_CLIENT_ID || !PDPJ_CLIENT_SECRET) {
    throw new Error("PDPJ não configurado (PDPJ_SSO_TOKEN_URL / PDPJ_CLIENT_ID / PDPJ_CLIENT_SECRET).");
  }

  if (_token && _exp - now() > 60) return _token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: PDPJ_CLIENT_ID,
    client_secret: PDPJ_CLIENT_SECRET,
  });

  const resp = await fetch(PDPJ_SSO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Falha ao obter token PDPJ: ${resp.status} ${t}`);
  }

  const json = await resp.json();
  _token = json.access_token;
  _exp = now() + (Number(json.expires_in) || 900);
  return _token;
}