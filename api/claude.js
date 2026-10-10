// Proxy seguro de IA (OCR e mensagens). As chaves ficam nas variáveis de ambiente
// do Vercel e nunca aparecem no navegador.
//   ANTHROPIC_API_KEY  -> usa Claude (modelo em ANTHROPIC_MODEL, opcional)
//   OPENAI_API_KEY     -> usa OpenAI (modelo em OPENAI_MODEL, opcional)
// Se as duas existirem, usa a Anthropic. O app sempre recebe a resposta no mesmo formato.

function erro(res, status, message) {
  return res.status(status).json({ error: { message } });
}

// Converte o conteúdo no formato da Anthropic para o formato da OpenAI
function paraOpenAI(content) {
  if (typeof content === "string") return content;
  return (content || []).map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image") {
      return { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    }
    if (b.type === "document") {
      return { type: "file", file: { filename: "documento.pdf", file_data: `data:application/pdf;base64,${b.source.data}` } };
    }
    return { type: "text", text: "" };
  });
}

async function viaAnthropic(key, maxTokens, messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", max_tokens: maxTokens, messages }),
  });
  return { status: r.status, data: await r.json() };
}

async function viaOpenAI(key, maxTokens, messages) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: paraOpenAI(m.content) })),
    }),
  });
  const d = await r.json();
  if (!r.ok || d.error) {
    return { status: r.status || 500, data: { error: { message: d.error?.message || "Erro na OpenAI" } } };
  }
  const text = d.choices?.[0]?.message?.content || "";
  return { status: 200, data: { content: [{ type: "text", text }] } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return erro(res, 405, "Método não permitido");

  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  if (origin && !origin.endsWith(".vercel.app") && !origin.includes(host) && !origin.startsWith("http://localhost")) {
    return erro(res, 403, "Origem não autorizada");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) {
    return erro(res, 500, "Nenhuma chave de IA configurada no Vercel (OPENAI_API_KEY ou ANTHROPIC_API_KEY)");
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return erro(res, 400, "Pedido inválido");
  }
  const maxTokens = Math.min(Number(body.max_tokens) || 1000, 2000);
  const messages = body.messages || [];

  try {
    const { status, data } = anthropicKey
      ? await viaAnthropic(anthropicKey, maxTokens, messages)
      : await viaOpenAI(openaiKey, maxTokens, messages);
    return res.status(status).json(data);
  } catch (e) {
    return erro(res, 502, "Falha ao contatar o serviço de IA: " + e.message);
  }
}
