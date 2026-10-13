import { criarToken, senhaConfere } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método não permitido" });
  if (!process.env.CRM_SENHA) return res.status(500).json({ ok: false, error: "Senha ainda não configurada no Vercel (CRM_SENHA)." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  // Pequena espera para dificultar tentativas em massa
  await new Promise(r => setTimeout(r, 600));
  if (!senhaConfere(body.senha)) return res.status(401).json({ ok: false, error: "Senha incorreta" });
  return res.status(200).json({ ok: true, token: criarToken(30) });
}
