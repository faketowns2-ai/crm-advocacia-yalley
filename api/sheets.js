import { tokenValido } from "./_lib/auth.js";

// Intermediário entre o CRM e a planilha. A chave SHEETS_KEY fica só no servidor.
const URL_PADRAO = "https://script.google.com/macros/s/AKfycby3VGOv4dSFIayqIFzcEYm-2f52KFsV-KYKsyIZHu8eibgXnZLomdhqy4_wwRNbOKEFDQ/exec";
const ACOES = /^(getAll|upsert(Cliente|Lead|Tarefa|Followup|Mensagem|Timeline)|delete(Cliente|Lead|Tarefa|Followup|Timeline))$/;

export default async function handler(req, res) {
  if (!tokenValido(req)) return res.status(401).json({ ok: false, error: "Sessão expirada. Entre novamente." });
  const action = String(req.query.action || "");
  if (!ACOES.test(action)) return res.status(400).json({ ok: false, error: "Ação inválida" });

  const qs = new URLSearchParams({ action });
  if (req.query.id) qs.set("id", String(req.query.id));
  if (process.env.SHEETS_KEY) qs.set("key", process.env.SHEETS_KEY);
  const url = `${process.env.SHEETS_URL || URL_PADRAO}?${qs}`;

  try {
    const opts = req.method === "POST"
      ? { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}), redirect: "follow" }
      : { method: "GET", redirect: "follow" };
    const r = await fetch(url, opts);
    const texto = await r.text();
    let j; try { j = JSON.parse(texto); } catch { return res.status(502).json({ ok: false, error: "Resposta inesperada da planilha" }); }
    if (!j.ok && j.data?.error) j.error = j.data.error;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(j);
  } catch (e) {
    return res.status(502).json({ ok: false, error: "Falha ao falar com a planilha: " + e.message });
  }
}
