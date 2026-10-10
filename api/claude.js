// Proxy seguro para a API da Anthropic. A chave fica na variável de ambiente
// ANTHROPIC_API_KEY do Vercel e nunca aparece no navegador.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Método não permitido" } });

  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  if (origin && !origin.endsWith(".vercel.app") && !origin.includes(host) && !origin.startsWith("http://localhost")) {
    return res.status(403).json({ error: { message: "Origem não autorizada" } });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY não configurada no Vercel" } });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const payload = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    max_tokens: Math.min(Number(body.max_tokens) || 1000, 2000),
    messages: body.messages || [],
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: "Falha ao contatar a Anthropic: " + e.message } });
  }
}
