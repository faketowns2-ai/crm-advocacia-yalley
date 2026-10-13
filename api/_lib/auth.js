import crypto from "node:crypto";

// Segredo de assinatura derivado das variáveis do Vercel (CRM_SENHA + SHEETS_KEY).
// Trocar a senha invalida todas as sessões abertas.
function segredo() {
  const base = process.env.AUTH_SECRET || `${process.env.CRM_SENHA || ""}::${process.env.SHEETS_KEY || ""}`;
  return crypto.createHash("sha256").update("crm-yalley:" + base).digest();
}

export function criarToken(dias = 30) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + dias * 864e5 })).toString("base64url");
  const sig = crypto.createHmac("sha256", segredo()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function tokenValido(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return false;
  const esperado = crypto.createHmac("sha256", segredo()).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

export function senhaConfere(senha) {
  const certa = process.env.CRM_SENHA || "";
  if (!certa) return false;
  const a = crypto.createHash("sha256").update(String(senha || "")).digest();
  const b = crypto.createHash("sha256").update(certa).digest();
  return crypto.timingSafeEqual(a, b);
}
