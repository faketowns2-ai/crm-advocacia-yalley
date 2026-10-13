import { useState, useEffect, useRef, useCallback } from "react";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SYNC_INTERVAL = 30000; // 30 segundos

// ─── PALETA & TIPOGRAFIA ─────────────────────────────────────────────────────
const C = {
  bg: "#0f0e17", surface: "#1a1930", card: "#211f35", border: "#2e2b4a",
  accent: "#c9a84c", accentLight: "#e8c97a", text: "#f0ede6", muted: "#8b8aa0",
  success: "#4caf7d", danger: "#e05c5c", info: "#5b9bd5", purple: "#9b72cf",
  warn: "#f0a500",
};
const FD = "'Playfair Display', serif";
const FB = "'IBM Plex Sans', sans-serif";
const FM = "'IBM Plex Mono', monospace";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const STATUS_CLI = ["Novo cliente","Documentação pendente","Aguardando perícia","Em análise INSS","Recurso em andamento","Benefício concedido","Benefício indeferido","Encerrado"];
const BENEFICIOS = ["Aposentadoria por Invalidez","Aposentadoria por Tempo de Contribuição","Aposentadoria por Idade","Benefício de Prestação Continuada (BPC/LOAS)","Auxílio-Doença","Auxílio-Acidente","Pensão por Morte","Salário-Maternidade","Revisão de Benefício"];
const TEMP_OPTS = ["🔥 Quente","🟡 Morno","❄️ Frio"];
const ORIGEM_OPTS = ["Instagram","WhatsApp","Indicação","Facebook","Google","Presencial","Outro"];
const STATUS_LEAD = ["Novo contato","Em negociação","Proposta enviada","Aguardando retorno","Convertido","Perdido"];
const ESTADO_CIVIL = ["Solteiro(a)","Casado(a)","Divorciado(a)","Viúvo(a)","União estável","Separado(a)"];
const NACIONALIDADES = ["brasileiro(a)","brasileira naturalizada","estrangeiro(a)"];
const TIMELINE_TIPOS = ["Protocolo INSS","Perícia agendada","Perícia realizada","Exigência cumprida","Recurso interposto","Decisão administrativa","Ação judicial ajuizada","Sentença","Benefício concedido","Benefício indeferido","Outro"];

const statusColor = { "Novo cliente":C.info,"Documentação pendente":C.warn,"Aguardando perícia":C.purple,"Em análise INSS":C.accent,"Recurso em andamento":C.danger,"Benefício concedido":C.success,"Benefício indeferido":C.danger,"Encerrado":C.muted };
const tempColor = { "🔥 Quente":C.danger,"🟡 Morno":C.warn,"❄️ Frio":C.info };
const leadStatusColor = { "Novo contato":C.info,"Em negociação":C.accent,"Proposta enviada":C.purple,"Aguardando retorno":C.warn,"Convertido":C.success,"Perdido":C.muted };

// ─── SESSÃO (login) ───────────────────────────────────────────────────────────
const TOKEN_KEY = "crm_sessao";
function lerToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
function gravarToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }
function sair() { gravarToken(""); window.dispatchEvent(new Event("crm-logout")); }
function authHeaders() { const t = lerToken(); return t ? { Authorization: "Bearer " + t } : {}; }

// ─── GOOGLE SHEETS API (via /api/sheets, protegido por login) ─────────────────
async function chamarSheets(qs, body) {
  const r = await fetch(`/api/sheets?${qs}`, {
    method: body ? "POST" : "GET",
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { sair(); throw new Error("Sessão expirada"); }
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || j.data?.error || "Erro na planilha");
  return j.data;
}
const api = {
  getAll: () => chamarSheets("action=getAll"),
  upsert: (entity, data) => chamarSheets(`action=upsert${cap(entity)}`, data),
  del: (entity, id) => chamarSheets(`action=delete${cap(entity)}&id=${encodeURIComponent(id)}`),
};

// Indeferido: os honorários contratados não entram no faturamento; só conta o que de fato foi pago
function ehIndeferido(c) { return /indeferid/i.test(String(c?.status||"")); }
function valorFaturavel(c) { return ehIndeferido(c) ? recebidoCli(c) : (Number(c.valorHonorarios)||0); }

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── FILA OFFLINE ─────────────────────────────────────────────────────────────
// Ids excluídos aguardando confirmação da planilha (evita que o item "volte" na sincronização)
const excluidos = {
  key: "crm_excluidos",
  get() { try { return new Set(JSON.parse(localStorage.getItem(this.key) || "[]")); } catch { return new Set(); } },
  add(k) { const s = this.get(); s.add(k); try { localStorage.setItem(this.key, JSON.stringify([...s])); } catch {} },
  del(k) { const s = this.get(); s.delete(k); try { localStorage.setItem(this.key, JSON.stringify([...s])); } catch {} },
};

const offlineQueue = {
  key: "crm_offline_queue",
  get() { try { return JSON.parse(localStorage.getItem(this.key) || "[]"); } catch { return []; } },
  add(op) { const q = this.get(); q.push(op); localStorage.setItem(this.key, JSON.stringify(q)); },
  clear() { localStorage.setItem(this.key, "[]"); },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function uid() { return Date.now() + Math.random().toString(36).slice(2, 7); }
function fmtDate(iso) { if (!iso) return ""; const [y,m,d] = diaISO(iso).split("-"); return `${d}/${m}/${y}`; }
function fmtCur(v) { return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0); }
function calcIdade(n) { if (!n) return ""; const h=new Date(),d=new Date(n); let a=h.getFullYear()-d.getFullYear(); if(h.getMonth()-d.getMonth()<0||(h.getMonth()===d.getMonth()&&h.getDate()<d.getDate()))a--; return a; }
function isoLocal(d) { const z=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
function hoje() { return isoLocal(new Date()); }
// Normaliza datas vindas da planilha: "2026-05-29", "2026-05-29T03:00:00.000Z" ou "29/05/2026" viram "2026-05-29"
function diaISO(v) {
  if (!v) return "";
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d=new Date(s); if (!isNaN(d)) return isoLocal(d); }
  return s.slice(0,10);
}
const PERIODOS = [["","Todo o período"],["hoje","Hoje"],["7d","Últimos 7 dias"],["mes","Este mês"],["ano","Este ano"],["custom","Datas selecionadas"]];
function intervaloPeriodo(periodo, ini, fim) {
  const h = new Date();
  if (periodo==="hoje") return [hoje(), hoje()];
  if (periodo==="7d") { const d=new Date(h); d.setDate(d.getDate()-6); return [isoLocal(d), hoje()]; }
  if (periodo==="mes") return [isoLocal(new Date(h.getFullYear(),h.getMonth(),1)), hoje()];
  if (periodo==="ano") return [`${h.getFullYear()}-01-01`, hoje()];
  if (periodo==="custom") return [ini||"0000-00-00", fim||"9999-12-31"];
  return null;
}

// ─── DOCUMENTOS ───────────────────────────────────────────────────────────────
// ─── REPRESENTAÇÃO LEGAL (menor ou incapaz) ─────────────────────────────────
const REP_TIPOS = {
  impubere: "Menor de 16 anos (representado)",
  pubere: "16 ou 17 anos (assistido)",
  curatela: "Maior incapaz (curatela)",
};
const REP_PARENTESCO = ["genitora","genitor","tutora","tutor","curadora","curador","guardiã","guardião","avó","avô"];
function comPronome(v) { if (!v) return "seu(sua) representante legal"; return (/(ora|ã|avó|genitora|tutora|curadora)$/.test(v) ? "sua " : /(or|ão|avô|genitor)$/.test(v) ? "seu " : "seu(sua) ") + v; }
function ehRepresentado(c) { const v = String(c?.representado||"").toLowerCase(); return v==="sim"||v==="true"; }
function tipoRepresentacao(c) {
  if (c.repTipo) return c.repTipo;
  const i = calcIdade(diaISO(c.dataNascimento));
  if (i !== "" && i < 16) return "impubere";
  if (i !== "" && i < 18) return "pubere";
  return "curatela";
}
function qualifPessoa(nome, p) {
  const partes = [String(nome||"___________").toUpperCase(), p.nacionalidade || "brasileiro(a)"];
  if (p.estadoCivil) partes.push(p.estadoCivil);
  if (p.profissao) partes.push(p.profissao);
  let t = partes.join(", ");
  if (p.dataNascimento) t += `, nascido(a) em ${fmtDate(p.dataNascimento)}`;
  t += `, inscrito(a) no CPF sob o n° ${p.cpf || "___________"}`;
  if (p.rg) t += ` e RG n° ${p.rg}`;
  return t;
}
function dadosRep(c) {
  return { nacionalidade:c.repNacionalidade, estadoCivil:c.repEstadoCivil, profissao:c.repProfissao, dataNascimento:c.repDataNascimento, cpf:c.repCpf, rg:c.repRg };
}
// Qualificação completa da parte (com representante, quando houver)
function qualificacaoParte(c) {
  const end = c.endereco || "___________";
  if (!ehRepresentado(c)) return `${qualifPessoa(c.nome, c)}, residente e domiciliado(a) na ${end}`;
  const t = tipoRepresentacao(c);
  const cond = t==="impubere" ? "menor impúbere" : t==="pubere" ? "menor púbere" : "maior civilmente incapaz";
  const verbo = t==="pubere" ? "assistido(a)" : "representado(a)";
  const parent = comPronome(c.repParentesco || (t==="curatela" ? "curador(a)" : ""));
  const cli = { ...c, estadoCivil:"", profissao: t==="curatela" ? c.profissao : "" };
  const endRep = c.repEndereco && normTxt(c.repEndereco)!==normTxt(end) ? `, residente e domiciliado(a) na ${c.repEndereco}` : "";
  return `${qualifPessoa(c.nome, cli)}, ${cond}, residente e domiciliado(a) na ${end}, neste ato ${verbo} por ${parent}, ${qualifPessoa(c.repNome, dadosRep(c))}${endRep}`;
}
// Bloco de assinatura conforme o tipo de representação
function blocoAssinatura(c, papel) {
  const nm = String(c.nome||"___________").toUpperCase();
  if (!ehRepresentado(c)) return `_________________________________________\n${nm}\n${papel}`;
  const rep = String(c.repNome||"___________").toUpperCase();
  const t = tipoRepresentacao(c);
  if (t==="pubere") return `_________________________________________\n${nm}\n${papel}\n\n\n_________________________________________\n${rep}\nAssistente (${c.repParentesco||"representante legal"})`;
  return `_________________________________________\n${rep}\n${c.repParentesco||"Representante legal"} de ${nm}\n${papel}`;
}
function assinanteNome(c) { return ehRepresentado(c) && tipoRepresentacao(c)!=="pubere" ? String(c.repNome||"").toUpperCase() : String(c.nome||"").toUpperCase(); }

function gerarDoc(tipo, c) {
  const dt = new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
  const nm = (c.nome||"___________").toUpperCase();
  const nac = c.nacionalidade || "brasileiro(a)";
  const ec = c.estadoCivil || "estado civil a declarar";
  const prof = c.profissao || "___________";
  const cpf = c.cpf || "___________";
  const rg = c.rg || "___________";
  const end = c.endereco || "___________";
  const ben = c.beneficio || "benefício previdenciário";
  const hon = fmtCur(c.valorHonorarios);
  const parc = c.parcelamentoTotal || 1;
  const vp = fmtCur(c.parcelamentoValor || c.valorHonorarios);
  const qual = qualificacaoParte(c);

  if (tipo === "contrato") return `CONTRATO DE HONORÁRIOS ADVOCATÍCIOS\n\nContrato de Prestação de Serviços Advocatícios que fazem entre si, de um lado, ${qual}, doravante denominado(a) CONTRATANTE; e, de outro lado, YALLEY DA SILVA VASCONCELOS, Advogado, inscrito na OAB/AP n° 3262, com escritório profissional à Rua Tiradentes, n° 624 (altos), Bairro Centro, Macapá/AP - CEP 68900-098, doravante denominado CONTRATADO, ajustam o presente contrato mediante as cláusulas e condições seguintes.\n\nCLÁUSULA 1ª - DO OBJETO\n\nO presente contrato tem por objeto a prestação de serviços advocatícios consistentes na representação administrativa e/ou judicial perante o INSS e demais órgãos competentes, visando ao requerimento, concessão, restabelecimento ou conversão de ${ben}, inclusive com análise de documentos, elaboração de requerimentos, acompanhamento processual e adoção das medidas necessárias à efetivação do direito.\n\nParágrafo único. A interposição de recursos administrativos, ações judiciais autônomas, cumprimento de sentença, execução de valores atrasados ou quaisquer medidas não expressamente previstas dependerão de novo contrato específico.\n\nCLÁUSULA 2ª - DA REMUNERAÇÃO\n\nOs honorários advocatícios correspondem ao valor de ${hon}, a serem pagos em ${parc}x de ${vp}, observando-se a Tabela de Honorários da OAB/AP.\n\n§1°. O(A) CONTRATANTE pagará ao CONTRATADO o percentual de 30% (trinta por cento) sobre os valores retroativos recebidos, seja na via administrativa ou judicial.\n\n§2°. Os valores poderão ser quitados à vista ou mediante desconto direto dos valores retroativos, mediante autorização expressa.\n\n§3°. Eventuais despesas com certidões, cópias, perícias e custas judiciais correrão por conta do(a) CONTRATANTE, mediante apresentação de comprovantes.\n\n§4°. Caso necessária a propositura de ação judicial, os honorários ora pactuados abrangem também essa fase.\n\nCLÁUSULA 3ª - DO PAGAMENTO\n\nOs honorários somente serão devidos em caso de êxito total ou parcial.\n\n§1° - O pagamento deverá ocorrer no prazo máximo de 2 (dois) dias úteis após o crédito do benefício ou dos retroativos.\n\n§2° - O atraso no pagamento ensejará multa de 10% (dez por cento) e juros de mora de 1% (um por cento) ao mês.\n\n§3° - O(A) CONTRATANTE autoriza o CONTRATADO a reter diretamente os honorários no momento do levantamento dos valores.\n\nCLÁUSULA 4ª - DA DURAÇÃO E RESCISÃO\n\nO presente contrato vigorará até a conclusão definitiva do processo administrativo ou judicial.\n\n§1° - A rescisão imotivada pelo(a) CONTRATANTE implicará o pagamento integral dos honorários, nos termos do art. 22, §3°, da Lei n° 8.906/94.\n\n§2° - O não fornecimento de documentos e informações necessárias constitui descumprimento contratual, autorizando a rescisão imediata.\n\nCLÁUSULA 5ª - DO SIGILO E PROTEÇÃO DE DADOS\n\nO(A) CONTRATANTE autoriza o uso de seus dados pessoais e credenciais GOV.BR, exclusivamente para execução dos serviços contratados, conforme a Lei n° 13.709/2018 (LGPD).\n\nCLÁUSULA 6ª - DO FORO\n\nFica eleito o foro da Comarca de Macapá/AP para dirimir eventuais controvérsias.\n\nMacapá/AP, ${dt}.\n\n\n${blocoAssinatura(c,"CONTRATANTE")}\n\n\n_________________________________________\nYALLEY DA SILVA VASCONCELOS\nOAB/AP n° 3262`;

  if (tipo === "hiposuficiencia") return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA ECONÔMICA\n\nEu, ${qual}.\n\nDECLARO, para os devidos fins de direito, especialmente para instruir pedido de concessão dos benefícios da Justiça Gratuita, nos termos do artigo 98 do Código de Processo Civil e artigo 5°, inciso LXXIV, da Constituição Federal, que não possuo condições financeiras de arcar com as custas processuais, despesas judiciais e honorários advocatícios sem prejuízo do meu próprio sustento e de minha família.\n\nDeclaro ainda que as informações acima são verdadeiras, estando ciente de que a falsidade desta declaração poderá implicar nas sanções civis, penais e processuais cabíveis.\n\nTermos em que,\nPede deferimento.\n\nMacapá/AP, ${dt}.\n\n\n${blocoAssinatura(c,"DECLARANTE")}`;

  if (tipo === "procuracao") return `PROCURAÇÃO\n\nOUTORGANTE: ${qual}.\n\nOUTORGADO: YALLEY DA SILVA VASCONCELOS, advogado, inscrito na OAB/AP n° 3262, com endereço profissional à Rua Tiradentes, n° 624 (altos), Bairro Centro, Macapá/AP - CEP 68900-098.\n\n\nA OUTORGANTE nomeia e constitui como seu bastante procurador o OUTORGADO, conferindo-lhe amplos, gerais e ilimitados poderes para representá-la ad judicia et ad extra, em todo o território nacional, POR PRAZO INDETERMINADO, em qualquer instância, juízo, tribunal ou órgão público ou privado, inclusive em processos físicos ou eletrônicos, podendo propor ações, acompanhar processos, apresentar defesa, confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar a direitos, firmar compromissos, celebrar acordos, recorrer, firmar declarações, requerer, acompanhar e revisar benefícios previdenciários e assistenciais, solicitar perícias médicas, administrativas ou judiciais, praticar atos perante o INSS e demais órgãos públicos ou privados, receber valores, levantar alvarás, dar quitação, realizar peticionamento eletrônico, atuar em sistemas judiciais e administrativos, receber citações e intimações eletrônicas, utilizar certificação digital, acessar, tratar e compartilhar dados pessoais e dados sensíveis, nos limites da finalidade deste mandato, ratificando desde já todos os atos anteriormente praticados relacionados ao presente mandato, podendo, ainda, substabelecer, no todo ou em parte, com ou sem reserva de poderes.\n\nA presente procuração referente ao processo de ${ben} é firmada por meio de assinatura eletrônica, nos termos da MP n° 2.200-2/2001 e da Lei n° 14.063/2020, sendo plenamente válida para todos os fins legais.\n\n\nMacapá/AP, ${dt}.\n\n\n${blocoAssinatura(c,"OUTORGANTE")}`;

  return "Tipo não reconhecido.";
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
function normalizarMediaType(rawType, fileName) {
  if (!rawType || rawType === "application/octet-stream") {
    const ext = (fileName || "").split(".").pop().toLowerCase();
    const map = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp", pdf:"application/pdf" };
    return map[ext] || "image/jpeg";
  }
  if (rawType === "image/jpg") return "image/jpeg";
  return rawType;
}

function montarPromptOCR(instrucao, nomeCliente) {
  let t = `Analise este documento (RG, CPF, CNH, certidão ou comprovante de residência) e extraia os dados.
Retorne APENAS JSON válido, sem markdown, sem texto extra:
{"nome":"","cpf":"","rg":"","dataNascimento":"AAAA-MM-DD","endereco":"","nacionalidade":"","estadoCivil":"","profissao":"","cep":"","tipo_documento":"","titular_documento":""}
Regras:
1. Datas em AAAA-MM-DD. Campos não encontrados ficam como string vazia.
2. "tipo_documento": RG, CPF, CNH, Certidão, Comprovante de residência ou Outro.
3. "titular_documento": o nome da pessoa que aparece como titular no documento.
4. Se for COMPROVANTE DE RESIDÊNCIA (conta de luz, água, telefone, internet, banco etc.), preencha SOMENTE "endereco", "cep", "tipo_documento" e "titular_documento". Deixe nome, cpf, rg, dataNascimento, estadoCivil, profissao e nacionalidade vazios, porque o comprovante pode estar em nome de terceiro.`;
  if (nomeCliente) t += `\n5. O cliente cadastrado é: ${nomeCliente}. Se o titular do documento for outra pessoa, NÃO preencha nome, cpf, rg, dataNascimento, estadoCivil, profissao e nacionalidade.`;
  if (instrucao && instrucao.trim()) t += `\n\nORIENTAÇÃO DO ADVOGADO (tem prioridade sobre as regras acima, exceto o formato JSON):\n${instrucao.trim()}`;
  return t;
}

async function extrairDados(base64, mediaType, fileName, instrucao = "", nomeCliente = "") {
  const mt = normalizarMediaType(mediaType, fileName);
  const isPDF = mt === "application/pdf";

  const contentBlock = isPDF
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image",    source: { type: "base64", media_type: mt, data: base64 } };

  const headers = { "Content-Type": "application/json", ...authHeaders() };

  const r = await fetch("/api/claude", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          contentBlock,
          { type: "text", text: montarPromptOCR(instrucao, nomeCliente) }
        ]
      }]
    })
  });

  if (!r.ok) throw new Error(`API erro ${r.status}: ${await r.text()}`);

  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "Erro na API");

  const raw = d.content?.[0]?.text || "{}";
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    throw new Error("JSON inválido na resposta: " + raw.slice(0, 80));
  }
}

// ─── MENSAGEM IA ──────────────────────────────────────────────────────────────
const ASSINATURA = "Yalley Vasconcelos, Advogado";
const MSG_TIPOS = { protocolo:"Processo Protocolado", pericia:"Perícia Agendada", resultado:"Movimentação Processual", aprovado:"Benefício Concedido", recurso:"Recurso Interposto", documento:"📎 Só resumir o documento anexado" };
async function chamarIA(content, maxTokens) {
  const r = await fetch("/api/claude", {
    method:"POST", headers:{"Content-Type":"application/json", ...authHeaders()},
    body: JSON.stringify({ max_tokens: maxTokens, messages:[{ role:"user", content }] })
  });
  if (r.status === 401) { sair(); throw new Error("Sessão expirada"); }
  const d = await r.json().catch(()=>({}));
  if (!r.ok || d.error) throw new Error(d.error?.message || `Erro ${r.status} na IA`);
  return (d.content?.[0]?.text || "").replace(/\s[—–]\s/g, ", ").trim();
}

async function gerarMsgIA(cliente, tipo, orientacao = "") {
  const map = { protocolo:"informar que o processo foi protocolado no INSS", pericia:"informar que a perícia médica foi agendada e orientar sobre o que levar", resultado:"informar que houve movimentação no processo", aprovado:"parabenizar pelo deferimento do benefício", recurso:"informar que foi necessário interpor recurso e explicar os próximos passos" };
  let p = `Mensagem curta profissional para WhatsApp para ${map[tipo]} ao cliente ${String(cliente.nome||"").split(" ")[0]}, processo de ${cliente.beneficio}. Tom acolhedor, máximo 5 linhas. Assine "${ASSINATURA}". Não use travessão.`;
  if (orientacao.trim()) p += `\n\nOrientação do advogado (siga com prioridade): ${orientacao.trim()}`;
  return chamarIA(p, 400);
}

// Lê um documento (decisão, carta de exigência, sentença, extrato...) e gera um resumo simples para o cliente
async function gerarMsgDocumento(cliente, base64, mediaType, fileName, orientacao = "") {
  const mt = normalizarMediaType(mediaType, fileName);
  const bloco = mt === "application/pdf"
    ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data: base64 } }
    : { type:"image", source:{ type:"base64", media_type: mt, data: base64 } };
  let p = `Você é o assistente do advogado previdenciário ${ASSINATURA}. Leia o documento anexo (pode ser decisão do INSS, carta de exigência, comunicado, sentença, despacho, extrato ou outro) e escreva uma mensagem de WhatsApp para o cliente ${String(cliente.nome||"").split(" ")[0]}, cujo processo é de ${cliente.beneficio||"benefício previdenciário"}.

Regras:
1. Linguagem simples, como se explicasse para alguém sem estudo jurídico. Nada de juridiquês; se precisar de um termo técnico, explique entre parênteses.
2. Estrutura: o que aconteceu; o que isso significa para o cliente; o que ele precisa fazer (se precisar) e até quando; próximo passo do escritório.
3. Destaque datas, prazos e valores exatamente como estão no documento. Não invente nada que não esteja no documento; se algo estiver ilegível, diga que o escritório vai confirmar.
4. Se for notícia ruim (indeferimento, exigência), tom tranquilizador e mostre o caminho (recurso, cumprir exigência etc.).
5. Máximo de 10 linhas curtas. Pode usar no máximo 2 emojis. Não use travessão.
6. Termine com a assinatura "${ASSINATURA}".
Responda apenas com o texto da mensagem.`;
  if (orientacao.trim()) p += `\n\nOrientação do advogado (siga com prioridade): ${orientacao.trim()}`;
  return chamarIA([bloco, { type:"text", text:p }], 900);
}

// ─── WHATSAPP WEB ─────────────────────────────────────────────────────────────
// Normaliza o telefone para o formato internacional (55 + DDD + número)
function telWhats(tel) {
  let n = String(tel||"").replace(/\D/g,"").replace(/^0+/,"");
  if (n.length===10 || n.length===11) n = "55"+n;
  return n.length>=12 && n.length<=13 ? n : "";
}
// Abre o WhatsApp Web com a conversa e a mensagem prontas, sempre na mesma aba
function abrirWhatsApp(tel, texto="") {
  const n = telWhats(tel);
  if (!n) { alertaWhats(); return false; }
  const url = `https://web.whatsapp.com/send?phone=${n}${texto?`&text=${encodeURIComponent(texto)}`:""}`;
  const w = window.open(url, "whatsapp_crm");
  if (w) w.focus();
  return true;
}
function alertaWhats() {
  const d = document.createElement("div");
  d.textContent = "Telefone do cliente inválido ou vazio. Corrija na aba Dados (DDD + número).";
  Object.assign(d.style,{position:"fixed",bottom:"20px",left:"50%",transform:"translateX(-50%)",background:"#e05c5c",color:"#fff",padding:"10px 16px",borderRadius:"8px",fontSize:"13px",zIndex:9999,fontFamily:"sans-serif"});
  document.body.appendChild(d); setTimeout(()=>d.remove(),4000);
}

// ─── CEP ──────────────────────────────────────────────────────────────────────
async function buscarCEP(cep) {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep.replace(/\D/g,"")}/json/`);
    const d = await r.json();
    if (d.erro) return null;
    return `${d.logradouro}, ${d.bairro}, ${d.localidade}/${d.uf} - CEP ${d.cep}`;
  } catch { return null; }
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app: { fontFamily:FB, background:C.bg, color:C.text, minHeight:"100vh", display:"flex", flexDirection:"column" },
  header: { background:`linear-gradient(135deg,${C.surface} 0%,#15132a 100%)`, borderBottom:`1px solid ${C.border}`, padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100, gap:12, flexWrap:"wrap" },
  logo: { fontFamily:FD, fontSize:20, color:C.accentLight, letterSpacing:"0.02em" },
  logoSub: { fontSize:10, color:C.muted, fontFamily:FM, letterSpacing:"0.1em", textTransform:"uppercase" },
  nav: { display:"flex", gap:3, background:C.card, borderRadius:10, padding:3, border:`1px solid ${C.border}`, flexWrap:"wrap" },
  navBtn: a => ({ padding:"7px 14px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontFamily:FB, fontWeight:a?600:400, background:a?C.accent:"transparent", color:a?C.bg:C.muted, transition:"all 0.2s", whiteSpace:"nowrap" }),
  main: { flex:1, padding:"20px 24px", maxWidth:1400, margin:"0 auto", width:"100%", boxSizing:"border-box" },
  card: { background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:18, marginBottom:14 },
  cardTitle: { fontFamily:FD, fontSize:17, color:C.accentLight, marginBottom:14, paddingBottom:10, borderBottom:`1px solid ${C.border}` },
  grid2: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 },
  grid3: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 },
  inp: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", color:C.text, fontFamily:FB, fontSize:13, width:"100%", boxSizing:"border-box", outline:"none" },
  sel: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", color:C.text, fontFamily:FB, fontSize:13, width:"100%", boxSizing:"border-box", outline:"none" },
  lbl: { display:"block", fontSize:10, color:C.muted, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.07em", fontFamily:FM },
  btn: v => ({ padding:"8px 16px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:FB, transition:"all 0.2s", background:v==="primary"?C.accent:v==="success"?C.success:v==="danger"?C.danger:v==="info"?C.info:v==="warn"?C.warn:v==="ghost"?"transparent":C.surface, color:v==="primary"?C.bg:v==="ghost"?C.muted:C.text, border:v==="ghost"?`1px solid ${C.border}`:"none" }),
  badge: col => ({ display:"inline-block", padding:"2px 9px", borderRadius:20, fontSize:10, fontWeight:600, background:col+"22", color:col, border:`1px solid ${col}44`, fontFamily:FM }),
  textarea: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", color:C.text, fontFamily:FM, fontSize:12, width:"100%", boxSizing:"border-box", outline:"none", resize:"vertical", lineHeight:1.7 },
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modalBox: { background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, maxWidth:680, width:"100%", maxHeight:"88vh", overflowY:"auto" },
  stat: { background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px", textAlign:"center" },
  statVal: { fontFamily:FD, fontSize:26, display:"block" },
  statLbl: { fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:FM, marginTop:3 },
};

// ─── COMPONENTES BASE ─────────────────────────────────────────────────────────
function F({ label, children }) {
  return <div style={{marginBottom:12}}><label style={S.lbl}>{label}</label>{children}</div>;
}
function Spin({ text="Carregando..." }) {
  return <div style={{textAlign:"center",padding:28,color:C.accent}}><div style={{fontSize:22,marginBottom:6}}>⚡</div><div style={{fontFamily:FM,fontSize:12}}>{text}</div></div>;
}
function Tag({ color, children }) { return <span style={S.badge(color)}>{children}</span>; }

// ─── INDICADOR DE SYNC ────────────────────────────────────────────────────────
function SyncBar({ status, lastSync, onSync }) {
  const map = {
    ok:    { color:C.success, label:"Sincronizado", dot:"●" },
    syncing:{ color:C.accent,  label:"Sincronizando...", dot:"◌" },
    error: { color:C.danger,   label:"Erro de conexão", dot:"●" },
    offline:{ color:C.muted,   label:"Offline", dot:"●" },
  };
  const m = map[status] || map.ok;
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,fontSize:11,fontFamily:FM}}>
      <span style={{color:m.color,fontSize:14}}>{m.dot}</span>
      <span style={{color:m.color}}>{m.label}</span>
      {lastSync && <span style={{color:C.muted}}>• {lastSync}</span>}
      <button onClick={onSync} style={{...S.btn("ghost"),padding:"3px 10px",fontSize:10}}>↺ Sync</button>
    </div>
  );
}

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
function Prog({ pct, color }) {
  return (
    <div style={{height:5,borderRadius:3,background:C.border,position:"relative",overflow:"hidden",marginTop:5}}>
      <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,pct||0)}%`,background:color||C.accent,borderRadius:3,transition:"width 0.5s"}}/>
    </div>
  );
}

// ─── CEP INPUT ────────────────────────────────────────────────────────────────
function CepInput({ value, onChange, onEnderecoFound }) {
  const [loading, setLoading] = useState(false);
  const handleBlur = async () => {
    const clean = value.replace(/\D/g,"");
    if (clean.length !== 8) return;
    setLoading(true);
    const end = await buscarCEP(clean);
    if (end) onEnderecoFound(end);
    setLoading(false);
  };
  return (
    <div style={{display:"flex",gap:8,alignItems:"center"}}>
      <input style={S.inp} value={value} onChange={e=>onChange(e.target.value)} onBlur={handleBlur} placeholder="00000-000" maxLength={9}/>
      {loading && <span style={{color:C.accent,fontSize:12,fontFamily:FM}}>...</span>}
    </div>
  );
}

// ─── UPLOAD OCR ───────────────────────────────────────────────────────────────
const CAMPOS_OCR = { nome:"Nome", cpf:"CPF", rg:"RG", dataNascimento:"Nascimento", endereco:"Endereço", cep:"CEP", nacionalidade:"Nacionalidade", estadoCivil:"Estado civil", profissao:"Profissão" };
const CAMPOS_PESSOAIS = ["nome","cpf","rg","dataNascimento","nacionalidade","estadoCivil","profissao"];
const ATALHOS_OCR = [
  "Comprovante em nome de terceiro: use só o endereço e o CEP",
  "Não altere nome, CPF e RG",
  "Este documento é do cônjuge: extraia só o nome dele para as observações, não altere os dados do cliente",
];
function normTxt(v) { return String(v||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/gi,"").toLowerCase(); }

function DocUpload({ onExtracted, atual = {} }) {
  const [status, setStatus] = useState("idle"); // idle | loading | review | success | error
  const [result, setResult] = useState(null);
  const [marcados, setMarcados] = useState({});
  const [erro, setErro] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [instrucao, setInstrucao] = useState("");
  const [aplicados, setAplicados] = useState(0);
  const ref = useRef();

  const handle = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErro("Arquivo muito grande. Máximo 3MB (limite do servidor). Tire uma foto ou envie só as páginas principais."); setStatus("error"); return; }

    setStatus("loading"); setResult(null); setErro(""); setNomeArquivo(file.name);
    e.target.value = "";

    const reader = new FileReader();
    reader.onerror = () => { setErro("Erro ao ler o arquivo. Tente novamente."); setStatus("error"); };
    reader.onload = async (ev) => {
      try {
        const b64 = ev.target.result.split(",")[1];
        if (!b64) throw new Error("Arquivo vazio ou corrompido.");
        const dados = await extrairDados(b64, file.type, file.name, instrucao, atual.nome || "");
        const temDados = Object.keys(CAMPOS_OCR).some(k => dados[k]);
        if (!temDados) throw new Error("Não foi possível identificar dados no documento. Tente uma foto mais nítida.");

        // Pré-seleção segura: comprovante de residência ou documento de terceiro só traz endereço e CEP;
        // campo já preenchido com valor diferente fica desmarcado para você decidir.
        const comprovante = /comprovante|resid/i.test(dados.tipo_documento || "");
        const titular = dados.titular_documento || dados.nome || "";
        const terceiro = !!(atual.nome && titular && normTxt(titular) !== normTxt(atual.nome));
        const sel = {};
        Object.keys(CAMPOS_OCR).forEach(k => {
          if (!dados[k]) return;
          const pessoal = CAMPOS_PESSOAIS.includes(k);
          const jaTem = atual[k] && normTxt(atual[k]) !== normTxt(dados[k]);
          // Endereço e CEP sempre vêm marcados (são o objetivo do comprovante); dados pessoais só se forem do próprio cliente e não sobrescreverem algo diferente
          sel[k] = pessoal ? (!comprovante && !terceiro && !jaTem) : true;
        });
        setResult({ ...dados, _comprovante: comprovante, _terceiro: terceiro, _titular: titular });
        setMarcados(sel);
        setStatus("review");
      } catch (err) {
        setErro(err.message || "Erro ao processar documento.");
        setStatus("error");
      }
    };
    reader.readAsDataURL(file);
  };

  const aplicar = () => {
    const d = {};
    Object.keys(marcados).forEach(k => { if (marcados[k] && result[k]) d[k] = result[k]; });
    onExtracted(d);
    setAplicados(Object.keys(d).length);
    setStatus("success");
  };

  const labelStatus = {
    idle: { icon: "📄", text: "Enviar RG, CPF, CNH ou comprovante de residência", sub: "JPG, PNG, PDF · máx. 3MB" },
    loading: { icon: "⏳", text: "Extraindo dados...", sub: nomeArquivo },
    review: { icon: "🔎", text: "Confira os dados antes de aplicar", sub: nomeArquivo },
    success: { icon: "✅", text: `${aplicados} campo(s) aplicado(s). Clique para enviar outro`, sub: nomeArquivo },
    error: { icon: "❌", text: "Tentar novamente", sub: "Clique para enviar outro arquivo" },
  }[status];

  return (
    <div>
      <div style={{marginBottom:8}}>
        <label style={S.lbl}>Orientação para a IA (opcional)</label>
        <textarea style={{...S.inp,minHeight:46,resize:"vertical",fontSize:12}} value={instrucao} onChange={e=>setInstrucao(e.target.value)} placeholder="Ex.: o comprovante está em nome da mãe, use só o endereço"/>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:5}}>
          {ATALHOS_OCR.map(a=>(
            <button key={a} type="button" onClick={()=>setInstrucao(a)} style={{background:instrucao===a?C.accent+"33":"transparent",border:`1px solid ${instrucao===a?C.accent:C.border}`,borderRadius:14,color:instrucao===a?C.accentLight:C.muted,fontSize:10,padding:"3px 9px",cursor:"pointer",fontFamily:FB}}>{a}</button>
          ))}
        </div>
      </div>

      <div
        onClick={() => status !== "loading" && ref.current.click()}
        style={{
          border: `2px dashed ${status === "error" ? C.danger : status === "success" ? C.success : status === "review" ? C.accent : C.border}`,
          borderRadius: 10, padding: "18px 16px", textAlign: "center",
          cursor: status === "loading" ? "wait" : "pointer",
          background: status === "success" ? C.success + "0d" : status === "error" ? C.danger + "0d" : "transparent",
          transition: "all 0.2s",
        }}
      >
        <div style={{ fontSize: 22, marginBottom: 5 }}>{labelStatus.icon}</div>
        <div style={{ color: status === "error" ? C.danger : status === "success" ? C.success : C.muted, fontSize: 13, marginBottom: 3 }}>{labelStatus.text}</div>
        <div style={{ color: C.muted, fontSize: 10, fontFamily: FM }}>{labelStatus.sub}</div>
        <input ref={ref} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handle} disabled={status === "loading"} />
      </div>

      {status === "loading" && <Spin text={`Analisando ${nomeArquivo}...`} />}

      {status === "error" && (
        <div style={{ marginTop: 8, background: C.danger + "18", border: `1px solid ${C.danger}44`, borderRadius: 8, padding: "10px 12px", color: C.danger, fontSize: 12, fontFamily: FM }}>⚠ {erro}</div>
      )}

      {status === "review" && result && (
        <div style={{ marginTop: 10, background: C.surface, border:`1px solid ${C.accent}55`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: FM, marginBottom: 6 }}>
            Tipo: <b style={{color:C.text}}>{result.tipo_documento || "não identificado"}</b>
            {result._titular && <> · Titular: <b style={{color:C.text}}>{result._titular}</b></>}
          </div>
          {(result._comprovante || result._terceiro) && (
            <div style={{ fontSize: 11, color: C.warn, marginBottom: 8 }}>
              {result._terceiro ? "O documento parece ser de outra pessoa. " : "Comprovante de residência. "}Dados pessoais vieram desmarcados: só serão aplicados se você marcar.
            </div>
          )}
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Marque o que deve ir para o cadastro:</div>
          {Object.keys(CAMPOS_OCR).filter(k => result[k]).map(k => {
            const mudou = atual[k] && normTxt(atual[k]) !== normTxt(result[k]);
            return (
              <label key={k} style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:12, padding:"5px 0", borderBottom:`1px solid ${C.border}`, cursor:"pointer" }}>
                <input type="checkbox" checked={!!marcados[k]} onChange={e=>setMarcados({...marcados,[k]:e.target.checked})} style={{marginTop:2}}/>
                <span style={{ color: C.muted, fontFamily: FM, minWidth: 95, flexShrink: 0 }}>{CAMPOS_OCR[k]}</span>
                <span style={{ flex:1 }}>
                  <span style={{ color: C.text }}>{String(result[k])}</span>
                  {mudou && <span style={{ display:"block", color: C.warn, fontSize: 10, fontFamily: FM }}>atual: {String(atual[k])}</span>}
                </span>
              </label>
            );
          })}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:10 }}>
            <button type="button" style={S.btn("ghost")} onClick={()=>{ setStatus("idle"); setResult(null); }}>Descartar</button>
            <button type="button" style={S.btn("primary")} onClick={aplicar} disabled={!Object.values(marcados).some(Boolean)}>Aplicar selecionados</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CAMPOS DO REPRESENTANTE LEGAL ────────────────────────────────────────────
function Representante({ form, setForm }) {
  const ativo = ehRepresentado(form);
  const idade = calcIdade(diaISO(form.dataNascimento));
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const tipo = ativo ? tipoRepresentacao(form) : "";
  return (
    <div style={{ border:`1px solid ${ativo?C.purple:C.border}`, borderRadius:10, padding:12, margin:"8px 0 12px", background: ativo?C.purple+"10":"transparent" }}>
      <label style={{ display:"flex", gap:8, alignItems:"center", cursor:"pointer", fontSize:13, flexWrap:"wrap" }}>
        <input type="checkbox" checked={ativo} onChange={e=>{ const on=e.target.checked; setForm(p=>({...p, representado: on?"sim":"", repTipo: on ? (p.repTipo || tipoRepresentacao({...p,repTipo:""})) : p.repTipo })); }}/>
        <b>Cliente menor de idade ou incapaz</b>
        <span style={{ color:C.muted, fontSize:11 }}>(documentos com o representante legal)</span>
      </label>
      {!ativo && idade!=="" && idade<18 && (
        <div style={{ marginTop:6, fontSize:11, color:C.warn }}>Atenção: pela data de nascimento o cliente tem {idade} anos. Marque a opção acima e informe o representante legal.</div>
      )}
      {ativo && (
        <div style={{ marginTop:10 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8 }}>
            <F label="Situação"><select style={S.sel} value={tipo} onChange={e=>set("repTipo",e.target.value)}>{Object.entries(REP_TIPOS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></F>
            <F label="Vínculo"><select style={S.sel} value={form.repParentesco||""} onChange={e=>set("repParentesco",e.target.value)}><option value="">Selecionar</option>{REP_PARENTESCO.map(r=><option key={r}>{r}</option>)}</select></F>
            <F label="Nome do representante"><input style={S.inp} value={form.repNome||""} onChange={e=>set("repNome",e.target.value)}/></F>
            <F label="CPF"><input style={S.inp} value={form.repCpf||""} onChange={e=>set("repCpf",e.target.value)}/></F>
            <F label="RG"><input style={S.inp} value={form.repRg||""} onChange={e=>set("repRg",e.target.value)}/></F>
            <F label="Data de nascimento"><input type="date" style={S.inp} value={diaISO(form.repDataNascimento)} onChange={e=>set("repDataNascimento",e.target.value)}/></F>
            <F label="Nacionalidade"><select style={S.sel} value={form.repNacionalidade||""} onChange={e=>set("repNacionalidade",e.target.value)}><option value="">Selecionar</option>{NACIONALIDADES.map(n=><option key={n}>{n}</option>)}</select></F>
            <F label="Estado civil"><select style={S.sel} value={form.repEstadoCivil||""} onChange={e=>set("repEstadoCivil",e.target.value)}><option value="">Selecionar</option>{ESTADO_CIVIL.map(n=><option key={n}>{n}</option>)}</select></F>
            <F label="Profissão"><input style={S.inp} value={form.repProfissao||""} onChange={e=>set("repProfissao",e.target.value)}/></F>
            <F label="Telefone"><input style={S.inp} value={form.repTelefone||""} onChange={e=>set("repTelefone",e.target.value)}/></F>
          </div>
          <F label="Endereço do representante (deixe vazio se for o mesmo do cliente)"><input style={S.inp} value={form.repEndereco||""} onChange={e=>set("repEndereco",e.target.value)}/></F>
          <div style={{ fontSize:11, color:C.muted, marginTop:4, lineHeight:1.5 }}>
            {tipo==="pubere" ? "16 e 17 anos: o cliente é ASSISTIDO e os dois assinam (cliente e representante)." : tipo==="impubere" ? "Menor de 16 anos: o cliente é REPRESENTADO e só o representante assina." : "Curatela: o curador assina. Confira se a sentença de curatela abrange atos previdenciários."}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MODELOS .DOCX PREENCHIDOS COM O CADASTRO ─────────────────────────────────
const MODELOS_KEY = "crm_modelos_docx";
function lerModelos() { try { return JSON.parse(localStorage.getItem(MODELOS_KEY) || "[]"); } catch { return []; } }
function gravarModelos(l) { try { localStorage.setItem(MODELOS_KEY, JSON.stringify(l)); return true; } catch { return false; } }
function dadosModelo(c) {
  const t = ehRepresentado(c) ? tipoRepresentacao(c) : "";
  const parcelas = lerParcelas(c);
  return {
    nome: String(c.nome||"").toUpperCase(), cpf:c.cpf, rg:c.rg, dataNascimento: fmtDate(c.dataNascimento), idade: String(calcIdade(diaISO(c.dataNascimento))),
    nacionalidade:c.nacionalidade, estadoCivil:c.estadoCivil, profissao:c.profissao, endereco:c.endereco, cep:c.cep, telefone:c.telefone, email:c.email,
    beneficio:c.beneficio, numeroBeneficio:c.numeroBeneficio, status:c.status,
    valorHonorarios: fmtCur(c.valorHonorarios), parcelas: String(c.parcelamentoTotal||1),
    valorParcela: fmtCur(parcelas.find(p=>p.valor)?.valor || c.parcelamentoValor || c.valorHonorarios),
    dataContrato: fmtDate(c.dataCadastro), dataHoje: fmtDate(hoje()),
    dataExtenso: new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"}),
    qualificacao: qualificacaoParte(c), qualificacaoCliente: qualifPessoa(c.nome, c) + `, residente e domiciliado(a) na ${c.endereco||"___________"}`,
    assinante: assinanteNome(c),
    representado: !!t, assistido: t==="pubere",
    repNome: String(c.repNome||"").toUpperCase(), repCpf:c.repCpf, repRg:c.repRg, repDataNascimento: fmtDate(c.repDataNascimento),
    repNacionalidade:c.repNacionalidade, repEstadoCivil:c.repEstadoCivil, repProfissao:c.repProfissao,
    repEndereco: c.repEndereco || c.endereco, repTelefone:c.repTelefone, repParentesco:c.repParentesco,
    qualificacaoRepresentante: c.repNome ? qualifPessoa(c.repNome, dadosRep(c)) : "",
  };
}
const TAGS_MODELO = ["nome","cpf","rg","dataNascimento","idade","nacionalidade","estadoCivil","profissao","endereco","cep","telefone","email","beneficio","numeroBeneficio","valorHonorarios","parcelas","valorParcela","dataContrato","dataHoje","dataExtenso","qualificacao","qualificacaoCliente","assinante","repNome","repCpf","repRg","repParentesco","repEndereco","qualificacaoRepresentante"];

function ModelosDocx({ cliente }) {
  const [modelos, setModelos] = useState(lerModelos());
  const [msg, setMsg] = useState(null);
  const [verTags, setVerTags] = useState(false);
  const ref = useRef();

  const enviar = (f) => {
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) { setMsg({erro:true, t:"Envie um arquivo .docx (Word). Arquivos .doc antigos precisam ser salvos como .docx."}); return; }
    if (f.size > 1.5*1024*1024) { setMsg({erro:true, t:"Modelo muito grande (máx. 1,5MB). Remova imagens pesadas do arquivo."}); return; }
    const fr = new FileReader();
    fr.onload = e => {
      const b64 = String(e.target.result).split(",")[1];
      const nome = f.name.replace(/\.docx$/i,"");
      const novo = [...modelos.filter(m=>m.nome!==nome), { id: uid(), nome, b64 }];
      if (!gravarModelos(novo)) { setMsg({erro:true, t:"Sem espaço no navegador para guardar mais modelos. Exclua algum modelo antigo."}); return; }
      setModelos(novo); setMsg({erro:false, t:`Modelo "${nome}" salvo.`});
    };
    fr.readAsDataURL(f);
  };

  const gerar = (m) => {
    try {
      const zip = new PizZip(atob(m.b64));
      const doc = new Docxtemplater(zip, { paragraphLoop:true, linebreaks:true, delimiters:{ start:"{{", end:"}}" }, nullGetter: () => "________" });
      doc.render(dadosModelo(cliente));
      const out = doc.getZip().generate({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(out);
      a.download = `${m.nome} - ${String(cliente.nome||"cliente").trim()}.docx`; a.click();
      setMsg({erro:false, t:`"${m.nome}" gerado e baixado.`});
    } catch (e) {
      const errs = e?.properties?.errors?.map(x=>x.properties?.explanation).filter(Boolean);
      setMsg({erro:true, t:"Erro no modelo: " + (errs?.length ? errs.slice(0,3).join(" | ") : (e.message||"desconhecido")) + ". Confira se as etiquetas estão escritas como {{nome}}."});
    }
  };

  const excluir = (id) => { const n = modelos.filter(m=>m.id!==id); gravarModelos(n); setModelos(n); };
  const code = (t) => <code style={{color:C.accentLight}}>{t}</code>;

  return (
    <div style={{ marginTop:18, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
      <div style={{ fontFamily:FD, fontSize:16, color:C.accentLight, marginBottom:8 }}>Meus modelos Word (.docx)</div>
      <div onClick={()=>ref.current.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();enviar(e.dataTransfer.files[0]);}}
        style={{ border:`2px dashed ${C.border}`, borderRadius:10, padding:16, textAlign:"center", cursor:"pointer", marginBottom:10 }}>
        <div style={{ fontSize:22, marginBottom:4 }}>📄</div>
        <div style={{ fontSize:13, color:C.muted }}>Enviar modelo .docx com etiquetas como {"{{nome}}"}, {"{{cpf}}"}, {"{{qualificacao}}"}</div>
        <div style={{ fontSize:10, color:C.muted, fontFamily:FM }}>clique ou arraste · o modelo fica salvo neste navegador e serve para todos os clientes</div>
        <input ref={ref} type="file" accept=".docx" style={{display:"none"}} onChange={e=>{enviar(e.target.files[0]); e.target.value="";}}/>
      </div>
      <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:11, marginBottom:10 }}>
        <a href="/modelo-exemplo.docx" download style={{ color:C.info }}>↓ Baixar modelo de exemplo</a>
        <button type="button" onClick={()=>setVerTags(!verTags)} style={{ background:"none", border:"none", color:C.info, cursor:"pointer", fontSize:11, padding:0 }}>{verTags?"Ocultar":"Ver"} lista de etiquetas</button>
      </div>
      {verTags && (
        <div style={{ background:C.surface, borderRadius:8, padding:10, marginBottom:10, fontSize:11, lineHeight:1.8 }}>
          <div style={{ color:C.muted, marginBottom:6 }}>Clique para copiar e cole no Word:</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {TAGS_MODELO.map(t=><button key={t} type="button" onClick={()=>{navigator.clipboard.writeText(`{{${t}}}`); setMsg({erro:false,t:`{{${t}}} copiado`});}} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, color:C.accentLight, fontFamily:FM, fontSize:10, padding:"2px 7px", cursor:"pointer" }}>{`{{${t}}}`}</button>)}
          </div>
          <div style={{ color:C.muted, marginTop:8 }}>
            {code("{{qualificacao}}")} traz a qualificação completa e já inclui o representante quando houver. {code("{{assinante}}")} é o nome de quem assina.
            Texto só para cliente representado: {code("{{#representado}}")} texto {code("{{/representado}}")}. Só para quem não é representado: {code("{{^representado}}")} texto {code("{{/representado}}")}.
          </div>
        </div>
      )}
      {msg && <div style={{ marginBottom:10, fontSize:12, fontFamily:FM, color: msg.erro?C.danger:C.success }}>{msg.erro?"⚠ ":"✓ "}{msg.t}</div>}
      {modelos.length===0 && <div style={{ fontSize:12, color:C.muted }}>Nenhum modelo salvo ainda.</div>}
      {modelos.map(m=>(
        <div key={m.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
          <span style={{ flex:1, fontSize:13 }}>📝 {m.nome}</span>
          <button style={{...S.btn("primary"),padding:"5px 12px"}} onClick={()=>gerar(m)}>Gerar e baixar</button>
          <button onClick={()=>excluir(m.id)} title="Excluir modelo" style={{ background:"none", border:"none", color:C.danger, cursor:"pointer", fontSize:12 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── LINHA DO TEMPO ───────────────────────────────────────────────────────────
function Timeline({ eventos=[], clienteId, onAdd, onDelete }) {
  const [form, setForm] = useState({ tipo:TIMELINE_TIPOS[0], descricao:"", data:hoje() });
  const [open, setOpen] = useState(false);
  const sorted = [...eventos].sort((a,b)=>b.data>a.data?1:-1);
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontFamily:FM,fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Linha do Tempo Processual</span>
        <button style={{...S.btn("primary"),padding:"5px 12px",fontSize:11}} onClick={()=>setOpen(o=>!o)}>+ Evento</button>
      </div>
      {open && (
        <div style={{background:C.surface,borderRadius:8,padding:12,marginBottom:12}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <div style={{flex:"2 1 160px"}}>
              <label style={S.lbl}>Tipo</label>
              <select style={S.sel} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
                {TIMELINE_TIPOS.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{flex:"1 1 120px"}}>
              <label style={S.lbl}>Data</label>
              <input style={S.inp} type="date" value={form.data} onChange={e=>setForm({...form,data:e.target.value})}/>
            </div>
            <div style={{flex:"3 1 200px"}}>
              <label style={S.lbl}>Descrição</label>
              <input style={S.inp} value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})} placeholder="Detalhes do evento..."/>
            </div>
            <div style={{display:"flex",alignItems:"flex-end"}}>
              <button style={S.btn("success")} onClick={()=>{ onAdd({...form,id:uid(),clienteId}); setForm({tipo:TIMELINE_TIPOS[0],descricao:"",data:hoje()}); setOpen(false); }}>Salvar</button>
            </div>
          </div>
        </div>
      )}
      {sorted.length===0 && <p style={{color:C.muted,fontSize:12}}>Nenhum evento registrado.</p>}
      <div style={{position:"relative"}}>
        {sorted.length>0 && <div style={{position:"absolute",left:10,top:0,bottom:0,width:2,background:C.border}}/>}
        {sorted.map((ev,i)=>(
          <div key={ev.id} style={{display:"flex",gap:12,marginBottom:12,position:"relative"}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:C.accent,border:`3px solid ${C.bg}`,flexShrink:0,zIndex:1,marginTop:2}}/>
            <div style={{flex:1,background:C.surface,borderRadius:8,padding:"8px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <span style={{fontWeight:600,fontSize:13}}>{ev.tipo}</span>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:10,fontFamily:FM,color:C.muted}}>{fmtDate(ev.data)}</span>
                  <button onClick={()=>onDelete(ev.id)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:12,padding:"0 4px"}}>✕</button>
                </div>
              </div>
              {ev.descricao && <div style={{fontSize:12,color:C.muted,marginTop:3}}>{ev.descricao}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PARCELAS ─────────────────────────────────────────────────────────────────
// Parcelas serializadas em parcelamentoDatas (JSON).
// Formato atual: {"0":{"venc":"2026-01-15","valor":"1000","pago":true,"dataPgto":"2026-01-14","forma":"PIX","obs":""},...}
// Formato antigo (só a data de vencimento) {"0":"2026-01-15"} continua sendo lido.
const FORMAS_PGTO = ["PIX","Dinheiro","Transferência","Boleto","Cartão de crédito","Cartão de débito","Cheque","Desconto nos retroativos"];
function parseDatas(cliente) {
  try { const d = JSON.parse(cliente.parcelamentoDatas || "{}"); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}
function serializeDatas(datas) { return JSON.stringify(datas); }
function lerParcelas(cliente) {
  const total = Math.max(1, Number(cliente.parcelamentoTotal)||1);
  const pagasLegado = Number(cliente.parcelamentoPagas)||0;
  const vp = cliente.parcelamentoValor;
  const raw = parseDatas(cliente);
  const lista = [];
  for (let i=0;i<total;i++) {
    const r = raw[i];
    const o = (r && typeof r === "object") ? r : { venc: r || "" };
    const pago = o.pago !== undefined ? !!o.pago : i < pagasLegado;
    const temValor = o.valor !== undefined && o.valor !== "";
    lista.push({
      venc: diaISO(o.venc),
      // Parcela paga sem valor registrado (dados antigos) usa o valor padrão antigo
      valor: temValor ? o.valor : (pago ? (vp ?? "") : ""),
      valorManual: temValor || pago,
      pago,
      dataPgto: diaISO(o.dataPgto),
      forma: o.forma || "",
      obs: o.obs || "",
    });
  }
  return lista;
}

function Parcelas({ cliente, onChange }) {
  const total = Math.max(1, Number(cliente.parcelamentoTotal)||1);
  const vp = Number(cliente.parcelamentoValor)||0;
  const lista = lerParcelas(cliente);
  const pagasN = lista.filter(p=>p.pago).length;
  // Honorários são o valor fixo do contrato. Recebido = soma das parcelas pagas. A receber = honorários menos recebido.
  const hon = Number(cliente.valorHonorarios)||0;
  const recebido = lista.filter(p=>p.pago).reduce((t,p)=>t+(Number(p.valor)||0),0);
  const aReceber = Math.max(hon - recebido, 0);
  const restantes = total - pagasN;
  const sugestao = restantes>0 && aReceber>0 ? Math.round((aReceber/restantes)*100)/100 : 0;
  const pct = hon>0 ? Math.min((recebido/hon)*100,100) : (pagasN/total)*100;
  const proxima = lista.map((p,i)=>({...p,n:i+1})).find(p=>!p.pago);

  // Grava a lista no cliente, mantendo "Pagas" sincronizado com as parcelas marcadas
  const gravar = (novaLista, extra={}) => {
    const obj = {};
    novaLista.forEach((p,i)=>{ obj[i] = { venc:p.venc||"", valor:p.valorManual?p.valor:"", pago:!!p.pago, dataPgto:p.dataPgto||"", forma:p.forma||"", obs:p.obs||"" }; });
    onChange({ ...cliente, ...extra, parcelamentoDatas: serializeDatas(obj), parcelamentoPagas: novaLista.filter(p=>p.pago).length });
  };
  const alterar = (i, campos) => gravar(lista.map((p,k)=>k===i?{...p,...campos}:p));
  const marcarPaga = (i) => {
    const p = lista[i];
    if (p.pago) return alterar(i, { pago:false });
    const valor = p.valor !== "" && p.valor !== undefined ? p.valor : (sugestao ? String(sugestao) : "");
    alterar(i, { pago:true, dataPgto: p.dataPgto || hoje(), valor, valorManual: valor!=="" });
  };
  const mudarTotal = (n) => {
    const nt = Math.max(1, Number(n)||1);
    const nova = Array.from({length:nt},(_,i)=>lista[i]||{venc:"",valor:"",valorManual:false,pago:false,dataPgto:"",forma:"",obs:""});
    gravar(nova, { parcelamentoTotal: nt });
  };
  // Preenche os vencimentos seguintes, mês a mês, a partir da 1ª data
  const repetirVencimentos = () => {
    const base = lista[0]?.venc; if (!base) return;
    const [y,m,d] = base.split("-").map(Number);
    gravar(lista.map((p,i)=>{
      if (i===0 || p.venc) return p;
      const dt = new Date(y, m-1+i, 1);
      const ult = new Date(dt.getFullYear(), dt.getMonth()+1, 0).getDate();
      dt.setDate(Math.min(d, ult));
      return {...p, venc: isoLocal(dt)};
    }));
  };

  const mini = { ...S.inp, padding:"6px 8px", fontSize:12, width:"100%", minWidth:0, boxSizing:"border-box" };
  const lblMini = { ...S.lbl, fontSize:9, marginBottom:3 };

  return (
    <div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        <div style={{flex:"1 1 130px"}}>
          <label style={S.lbl}>Honorários (R$)</label>
          <input style={S.inp} type="number" value={cliente.valorHonorarios||""} onChange={e=>onChange({...cliente,valorHonorarios:e.target.value})}/>
        </div>
        <div style={{flex:"1 1 100px"}}>
          <label style={S.lbl}>Parcelas</label>
          <input style={S.inp} type="number" min={1} value={total} onChange={e=>mudarTotal(e.target.value)}/>
        </div>
        <div style={{flex:"1 1 100px"}}>
          <label style={S.lbl}>Pagas</label>
          <input style={{...S.inp,opacity:0.7}} value={`${pagasN} de ${total}`} readOnly title="Marque cada parcela como paga abaixo"/>
        </div>
      </div>

      {ehIndeferido(cliente)&&<div style={{marginBottom:8,fontSize:11,color:C.danger,fontFamily:FM}}>Benefício indeferido: o saldo em aberto não entra no faturamento nem no "A receber" do painel. Só o que já foi pago conta como receita.</div>}
      <Prog pct={pct} color={pct>=100?C.success:C.accent}/>
      <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6,fontSize:11,fontFamily:FM,marginTop:5,color:C.muted}}>
        <span style={{color:C.success}}>Recebido: {fmtCur(recebido)}</span>
        {proxima&&<span>Próxima: {proxima.n}ª {proxima.venc?`em ${fmtDate(proxima.venc)}`:"sem data"}{sugestao?` · sugerido ${fmtCur(proxima.valor||sugestao)}`:""}</span>}
        <span style={{color:C.danger}}>A receber: {fmtCur(aReceber)}</span>
      </div>
      {hon>0 && recebido-hon>0.01 && (
        <div style={{marginTop:6,fontSize:11,color:C.warn,fontFamily:FM}}>Atenção: o valor recebido ({fmtCur(recebido)}) passou dos honorários ({fmtCur(hon)}) em {fmtCur(recebido-hon)}.</div>
      )}
      {hon>0 && pagasN===total && aReceber>0.01 && (
        <div style={{marginTop:6,fontSize:11,color:C.warn,fontFamily:FM}}>Atenção: todas as parcelas estão pagas, mas ainda faltam {fmtCur(aReceber)} para completar os honorários.</div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,marginBottom:6,gap:8,flexWrap:"wrap"}}>
        <label style={{...S.lbl,margin:0}}>Parcelas</label>
        {total>1 && lista[0]?.venc && lista.some((p,i)=>i>0&&!p.venc) && (
          <button style={{...S.btn("ghost"),padding:"4px 10px",fontSize:11}} onClick={repetirVencimentos}>Preencher vencimentos mês a mês</button>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
        {lista.map((p,i)=>{
          const atrasada = !p.pago && p.venc && p.venc < hoje();
          const cor = p.pago ? C.success : atrasada ? C.danger : C.border;
          const rotulo = p.pago ? "✓ Paga" : atrasada ? "Atrasada" : "Em aberto";
          return (
            <div key={i} style={{background:p.pago?C.success+"14":atrasada?C.danger+"14":C.surface,border:`1px solid ${cor}`,borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:FD,fontSize:15,color:C.accentLight}}>{i+1}ª parcela</span>
                <span style={{fontSize:10,fontFamily:FM,color:p.pago?C.success:atrasada?C.danger:C.muted}}>{rotulo}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <div>
                  <label style={lblMini}>Valor (R$)</label>
                  <input style={mini} type="number" value={p.valor??""} placeholder={!p.pago&&sugestao?String(sugestao):""} onChange={e=>alterar(i,{valor:e.target.value,valorManual:e.target.value!==""})}/>
                </div>
                <div>
                  <label style={lblMini}>Vencimento</label>
                  <input style={mini} type="date" value={p.venc||""} onChange={e=>alterar(i,{venc:e.target.value})}/>
                </div>
                <div>
                  <label style={lblMini}>Data do pagamento</label>
                  <input style={mini} type="date" value={p.dataPgto||""} onChange={e=>{ const d=e.target.value; const v=(d&&!p.pago&&(p.valor===""||p.valor===undefined)&&sugestao)?String(sugestao):p.valor; alterar(i,{dataPgto:d, pago: d ? true : p.pago, valor:v, valorManual: v!==""&&v!==undefined}); }}/>
                </div>
                <div>
                  <label style={lblMini}>Forma de pagamento</label>
                  <select style={mini} value={p.forma||""} onChange={e=>alterar(i,{forma:e.target.value})}>
                    <option value="">Selecione</option>
                    {FORMAS_PGTO.map(f=><option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <input style={mini} placeholder="Observação (nº do comprovante, quem pagou...)" value={p.obs||""} onChange={e=>alterar(i,{obs:e.target.value})}/>
              <button onClick={()=>marcarPaga(i)} style={{...S.btn(p.pago?"ghost":"success"),padding:"6px 10px",fontSize:12}}>{p.pago?"Desmarcar pagamento":"Marcar como paga"}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
// ─── FATURAMENTO (card do topo do painel + gráfico por benefício) ─────────────
const COR_RECEBIDO = "#a8862f";   // validado (contraste e daltonismo) contra o fundo escuro
const COR_ARECEBER = "#3f7ab5";
function Faturamento({ clients, onIr }) {
  const [per, setPer] = useState("ano");
  const [dIni, setDIni] = useState("");
  const [dFim, setDFim] = useState("");
  const [ben, setBen] = useState("");
  const [hover, setHover] = useState(null);
  const [tabela, setTabela] = useState(false);
  const iv = intervaloPeriodo(per, dIni, dFim);
  const noPeriodo = (d) => !iv || (d && d >= iv[0] && d <= iv[1]);

  const doPeriodo = clients.filter(c => noPeriodo(diaISO(c.dataCadastro)));
  const sel = doPeriodo.filter(c => !ben || c.beneficio === ben);
  const contratado = sel.reduce((t,c)=>t+valorFaturavel(c),0);
  const indef = sel.filter(ehIndeferido);
  const indefValor = indef.reduce((t,c)=>t+(Number(c.valorHonorarios)||0)-recebidoCli(c),0);
  const recebidoContratos = sel.reduce((t,c)=>t+recebidoCli(c),0);
  const aReceber = Math.max(contratado - recebidoContratos, 0);
  // Dinheiro que entrou no período (pela data de pagamento das parcelas), de qualquer contrato
  const entrou = clients.filter(c=>!ben||c.beneficio===ben).reduce((t,c)=>t+lerParcelas(c).filter(p=>p.pago && (iv ? noPeriodo(p.dataPgto) : true)).reduce((s,p)=>s+(Number(p.valor)||0),0),0);
  const nValidos = sel.length - indef.length;
  const ticket = nValidos ? sel.filter(c=>!ehIndeferido(c)).reduce((t,c)=>t+valorFaturavel(c),0) / nValidos : 0;

  // Agrupamento por benefício (contratos do período)
  const mapa = {};
  doPeriodo.forEach(c => {
    const k = c.beneficio || "Sem benefício";
    const m = mapa[k] || (mapa[k] = { nome:k, contratado:0, recebido:0, n:0 });
    m.contratado += valorFaturavel(c); m.recebido += recebidoCli(c); m.n++; if (ehIndeferido(c)) m.indef=(m.indef||0)+1;
  });
  let linhas = Object.values(mapa).sort((a,b)=>b.contratado-a.contratado);
  if (linhas.length > 8) {
    const resto = linhas.slice(7);
    linhas = [...linhas.slice(0,7), resto.reduce((o,m)=>({ nome:`Outros (${resto.length})`, contratado:o.contratado+m.contratado, recebido:o.recebido+m.recebido, n:o.n+m.n, outros:true }), { contratado:0, recebido:0, n:0 })];
  }
  const max = Math.max(1, ...linhas.map(l=>l.contratado));
  const totalPer = linhas.reduce((t,l)=>t+l.contratado,0) || 1;

  const kpi = (rotulo, valor, sub, cor, ir) => (
    <div className={ir?"card-click":""} onClick={ir?()=>onIr(...ir):undefined} style={{flex:"1 1 150px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",cursor:ir?"pointer":"default"}}>
      <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>{rotulo}</div>
      <div style={{fontSize:20,fontWeight:700,color:cor||C.text,fontFamily:FD,marginTop:2}}>{valor}</div>
      {sub&&<div style={{fontSize:10,color:C.muted,fontFamily:FM}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{...S.card,marginBottom:16,border:`1px solid ${C.accent}55`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>Faturamento {ben?`· ${ben}`:"· todos os benefícios"}</div>
          <div style={{fontFamily:FD,fontSize:34,color:C.accentLight,lineHeight:1.1}}>{fmtCur(contratado)}</div>
          <div style={{fontSize:11,color:C.muted,fontFamily:FM}}>honorários contratados {iv?`de ${fmtDate(iv[0])} a ${fmtDate(iv[1])}`:"em todo o período"} · {nValidos} contrato(s)</div>
          {indef.length>0&&<div className="card-click" onClick={()=>onIr("clientes",{status:"Benefício indeferido"})} title="Ver clientes indeferidos" style={{display:"inline-block",marginTop:4,fontSize:11,color:C.danger,fontFamily:FM,cursor:"pointer",border:`1px solid transparent`,borderRadius:6,padding:"1px 4px"}}>− {indef.length} indeferido(s) fora do faturamento ({fmtCur(indefValor)}) →</div>}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div><label style={S.lbl}>Período</label><select style={{...S.sel,minWidth:150}} value={per} onChange={e=>setPer(e.target.value)}>{PERIODOS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          {per==="custom"&&<>
            <div><label style={S.lbl}>De</label><input type="date" style={S.inp} value={dIni} onChange={e=>setDIni(e.target.value)}/></div>
            <div><label style={S.lbl}>Até</label><input type="date" style={S.inp} value={dFim} onChange={e=>setDFim(e.target.value)}/></div>
          </>}
          <div><label style={S.lbl}>Benefício</label><select style={{...S.sel,minWidth:180}} value={ben} onChange={e=>setBen(e.target.value)}><option value="">Todos</option>{Object.keys(mapa).sort().map(b=><option key={b}>{b}</option>)}</select></div>
        </div>
      </div>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
        {kpi("Recebido no período", fmtCur(entrou), "clique para ver de onde veio →", C.success, ["recebimentos",{per, dIni, dFim, ben}])}
        {kpi("A receber destes contratos", fmtCur(aReceber), `já pago: ${fmtCur(recebidoContratos)}`, C.danger, ["clientes",{grupo:"areceber"}])}
        {kpi("Ticket médio", fmtCur(ticket), "por contrato", C.text)}
        {kpi("Contratos", String(nValidos), indef.length?`+ ${indef.length} indeferido(s) excluído(s)`:(ben?"deste benefício":"no período"), C.info, ["clientes",{}])}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:8}}>
        <div style={{fontFamily:FD,fontSize:15,color:C.accentLight}}>Desempenho por benefício</div>
        <div style={{display:"flex",gap:14,alignItems:"center",fontSize:11,color:C.muted}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:COR_RECEBIDO,display:"inline-block"}}/>Recebido</span>
          <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:COR_ARECEBER,display:"inline-block"}}/>A receber</span>
          <button type="button" onClick={()=>setTabela(!tabela)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,cursor:"pointer",fontSize:10,padding:"2px 8px"}}>{tabela?"Ver gráfico":"Ver tabela"}</button>
        </div>
      </div>
      {linhas.length===0 && <div style={{fontSize:12,color:C.muted,padding:"14px 0"}}>Nenhum contrato no período.</div>}

      {!tabela && linhas.map((l,i)=>{
        const ativo = !ben || l.nome===ben;
        const rec = Math.min(l.recebido, l.contratado), pend = Math.max(l.contratado - l.recebido, 0);
        const w = (l.contratado/max)*100;
        return (
          <div key={l.nome} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}
            onClick={()=>!l.outros&&setBen(ben===l.nome?"":l.nome)} title={l.outros?"":"Clique para filtrar por este benefício"}
            style={{display:"grid",gridTemplateColumns:"minmax(110px,220px) 1fr 150px",gap:10,alignItems:"center",padding:"6px 4px",cursor:l.outros?"default":"pointer",opacity:ativo?1:0.35,borderRadius:6,background:hover===i?C.surface:"transparent",position:"relative"}}>
            <span style={{fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.nome}</span>
            <div style={{height:14,display:"flex",gap:2,width:`${Math.max(w,1.5)}%`}}>
              {rec>0&&<div style={{flex:rec,background:COR_RECEBIDO,borderRadius:pend>0?"0":"0 4px 4px 0"}}/>}
              {pend>0&&<div style={{flex:pend,background:COR_ARECEBER,borderRadius:"0 4px 4px 0"}}/>}
            </div>
            <span style={{fontSize:11,color:C.muted,fontFamily:FM,whiteSpace:"nowrap",textAlign:"right"}}><b style={{color:C.text}}>{fmtCur(l.contratado)}</b> · {Math.round(l.contratado/totalPer*100)}%</span>
            {hover===i&&(
              <div style={{position:"absolute",right:4,top:"100%",zIndex:5,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",fontSize:11,lineHeight:1.6,boxShadow:"0 6px 18px #0008",pointerEvents:"none",minWidth:190}}>
                <div style={{color:C.text,fontWeight:700,marginBottom:2}}>{l.nome}</div>
                <div style={{color:C.muted}}>Contratos: <b style={{color:C.text}}>{l.n-(l.indef||0)}</b>{l.indef?<span style={{color:C.danger}}> (+{l.indef} indeferido)</span>:null}</div>
                <div style={{color:C.muted}}>Contratado: <b style={{color:C.text}}>{fmtCur(l.contratado)}</b></div>
                <div style={{color:C.muted}}><span style={{display:"inline-block",width:8,height:8,background:COR_RECEBIDO,borderRadius:2,marginRight:4}}/>Recebido: <b style={{color:C.text}}>{fmtCur(rec)}</b></div>
                <div style={{color:C.muted}}><span style={{display:"inline-block",width:8,height:8,background:COR_ARECEBER,borderRadius:2,marginRight:4}}/>A receber: <b style={{color:C.text}}>{fmtCur(pend)}</b></div>
                <div style={{color:C.muted}}>Ticket médio: <b style={{color:C.text}}>{fmtCur(l.contratado/((l.n-(l.indef||0))||1))}</b></div>
              </div>
            )}
          </div>
        );
      })}

      {tabela && linhas.length>0 && (
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{color:C.muted,fontFamily:FM,fontSize:10,textTransform:"uppercase"}}>
            <th style={{textAlign:"left",padding:6}}>Benefício</th><th style={{textAlign:"right",padding:6}}>Contratos</th><th style={{textAlign:"right",padding:6}}>Contratado</th><th style={{textAlign:"right",padding:6}}>Recebido</th><th style={{textAlign:"right",padding:6}}>A receber</th><th style={{textAlign:"right",padding:6}}>%</th>
          </tr></thead>
          <tbody>{linhas.map(l=>(
            <tr key={l.nome} onClick={()=>!l.outros&&setBen(ben===l.nome?"":l.nome)} style={{borderTop:`1px solid ${C.border}`,cursor:l.outros?"default":"pointer",opacity:!ben||l.nome===ben?1:0.4}}>
              <td style={{padding:6}}>{l.nome}</td><td style={{padding:6,textAlign:"right"}}>{l.n}</td><td style={{padding:6,textAlign:"right"}}>{fmtCur(l.contratado)}</td><td style={{padding:6,textAlign:"right"}}>{fmtCur(Math.min(l.recebido,l.contratado))}</td><td style={{padding:6,textAlign:"right"}}>{fmtCur(Math.max(l.contratado-l.recebido,0))}</td><td style={{padding:6,textAlign:"right"}}>{Math.round(l.contratado/totalPer*100)}%</td>
            </tr>))}</tbody>
        </table>
      )}
      {ben && <div style={{marginTop:8}}><FiltroPainel texto={ben} onLimpar={()=>setBen("")}/></div>}
    </div>
  );
}

// ─── RECEBIMENTOS (origem do dinheiro recebido) ───────────────────────────────
function BarrasSimples({ titulo, itens, total, onClick, ativo }) {
  const max = Math.max(1, ...itens.map(i=>i.valor));
  return (
    <div style={{...S.card, flex:"1 1 320px", marginBottom:0}}>
      <div style={{fontFamily:FD,fontSize:15,color:C.accentLight,marginBottom:8}}>{titulo}</div>
      {itens.length===0 && <div style={{fontSize:12,color:C.muted}}>Sem dados.</div>}
      {itens.map(i=>(
        <div key={i.nome} onClick={()=>onClick&&onClick(i.nome)} title={onClick?"Clique para filtrar":""}
          style={{display:"grid",gridTemplateColumns:"minmax(90px,160px) 1fr 130px",gap:8,alignItems:"center",padding:"5px 2px",cursor:onClick?"pointer":"default",opacity:!ativo||ativo===i.nome?1:0.35}}>
          <span style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{i.nome}</span>
          <div style={{height:12,width:`${Math.max(i.valor/max*100,1.5)}%`,background:COR_RECEBIDO,borderRadius:"0 4px 4px 0"}}/>
          <span style={{fontSize:11,color:C.muted,fontFamily:FM,textAlign:"right",whiteSpace:"nowrap"}}><b style={{color:C.text}}>{fmtCur(i.valor)}</b> · {Math.round(i.valor/(total||1)*100)}%</span>
        </div>
      ))}
    </div>
  );
}

function Recebimentos({ clients, onSelect, preset = {} }) {
  const [per, setPer] = useState(preset.per ?? "mes");
  const [dIni, setDIni] = useState(preset.dIni || "");
  const [dFim, setDFim] = useState(preset.dFim || "");
  const [ben, setBen] = useState(preset.ben || "");
  const [forma, setForma] = useState("");
  const iv = intervaloPeriodo(per, dIni, dFim);

  const todos = [];
  clients.forEach(c => {
    const lista = lerParcelas(c);
    lista.forEach((p, i) => {
      if (!p.pago) return;
      todos.push({ cli:c, nome:c.nome, beneficio:c.beneficio||"Sem benefício", n:i+1, total:lista.length, valor:Number(p.valor)||0, data:diaISO(p.dataPgto), forma:p.forma||"Não informada", obs:p.obs||"" });
    });
  });
  const semData = todos.filter(t=>!t.data).length;
  const doPer = todos.filter(t => !iv || (t.data && t.data>=iv[0] && t.data<=iv[1]));
  const lista = doPer.filter(t => (!ben||t.beneficio===ben) && (!forma||t.forma===forma)).sort((a,b)=>(b.data||"").localeCompare(a.data||""));
  const total = lista.reduce((s,t)=>s+t.valor,0);
  const nCli = new Set(lista.map(t=>String(t.cli.id))).size;

  const agrupar = (arr, campo) => { const m={}; arr.forEach(t=>{ m[t[campo]]=(m[t[campo]]||0)+t.valor; }); return Object.entries(m).map(([nome,valor])=>({nome,valor})).sort((a,b)=>b.valor-a.valor); };
  const porForma = agrupar(doPer.filter(t=>!ben||t.beneficio===ben), "forma");
  const porBen = agrupar(doPer.filter(t=>!forma||t.forma===forma), "beneficio");

  const exportCSV = () => {
    const linhas = [["Data","Cliente","Benefício","Parcela","Valor","Forma","Observação"].join(";"), ...lista.map(t=>[fmtDate(t.data)||"sem data", t.nome, t.beneficio, `${t.n}/${t.total}`, String(t.valor).replace(".",","), t.forma, (t.obs||"").replace(/;/g,",")].join(";"))];
    const blob = new Blob(["﻿"+linhas.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="recebimentos.csv"; a.click();
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10,marginBottom:14}}>
        <div>
          <h2 style={{fontFamily:FD,fontSize:22,color:C.accentLight,margin:0}}>Recebimentos</h2>
          <p style={{color:C.muted,fontSize:12,margin:"3px 0 0",fontFamily:FM}}>De onde veio o dinheiro recebido{iv?` de ${fmtDate(iv[0])} a ${fmtDate(iv[1])}`:" em todo o período"}</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div><label style={S.lbl}>Período</label><select style={{...S.sel,minWidth:150}} value={per} onChange={e=>setPer(e.target.value)}>{PERIODOS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          {per==="custom"&&<>
            <div><label style={S.lbl}>De</label><input type="date" style={S.inp} value={dIni} onChange={e=>setDIni(e.target.value)}/></div>
            <div><label style={S.lbl}>Até</label><input type="date" style={S.inp} value={dFim} onChange={e=>setDFim(e.target.value)}/></div>
          </>}
          <div><label style={S.lbl}>Benefício</label><select style={{...S.sel,minWidth:170}} value={ben} onChange={e=>setBen(e.target.value)}><option value="">Todos</option>{[...new Set(todos.map(t=>t.beneficio))].sort().map(b=><option key={b}>{b}</option>)}</select></div>
          <div><label style={S.lbl}>Forma</label><select style={{...S.sel,minWidth:140}} value={forma} onChange={e=>setForma(e.target.value)}><option value="">Todas</option>{[...new Set(todos.map(t=>t.forma))].sort().map(f=><option key={f}>{f}</option>)}</select></div>
          <button style={S.btn("ghost")} onClick={exportCSV}>↓ CSV</button>
        </div>
      </div>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        {[["Total recebido",fmtCur(total),C.success],["Pagamentos",String(lista.length),C.info],["Clientes que pagaram",String(nCli),C.accentLight],["Média por pagamento",fmtCur(lista.length?total/lista.length:0),C.text]].map(([r,v,c])=>(
          <div key={r} style={{flex:"1 1 160px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
            <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>{r}</div>
            <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:FD}}>{v}</div>
          </div>
        ))}
      </div>
      {(ben||forma)&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {ben&&<FiltroPainel texto={ben} onLimpar={()=>setBen("")}/>}
        {forma&&<FiltroPainel texto={forma} onLimpar={()=>setForma("")}/>}
      </div>}

      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:14}}>
        <BarrasSimples titulo="Por benefício" itens={porBen} total={porBen.reduce((s,i)=>s+i.valor,0)} onClick={n=>setBen(ben===n?"":n)} ativo={ben}/>
        <BarrasSimples titulo="Por forma de pagamento" itens={porForma} total={porForma.reduce((s,i)=>s+i.valor,0)} onClick={n=>setForma(forma===n?"":n)} ativo={forma}/>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Pagamentos ({lista.length})</div>
        {lista.length===0 && <div style={{fontSize:12,color:C.muted,padding:"10px 0"}}>Nenhum pagamento registrado neste filtro. Os pagamentos entram aqui quando você marca a parcela como paga na aba Financeiro do cliente.</div>}
        {lista.length>0 && (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:640}}>
              <thead><tr style={{color:C.muted,fontFamily:FM,fontSize:10,textTransform:"uppercase"}}>
                <th style={{textAlign:"left",padding:6}}>Data</th><th style={{textAlign:"left",padding:6}}>Cliente</th><th style={{textAlign:"left",padding:6}}>Benefício</th><th style={{textAlign:"center",padding:6}}>Parcela</th><th style={{textAlign:"left",padding:6}}>Forma</th><th style={{textAlign:"right",padding:6}}>Valor</th>
              </tr></thead>
              <tbody>{lista.map((t,i)=>(
                <tr key={i} onClick={()=>onSelect(t.cli)} title="Abrir cliente" className="card-click" style={{borderTop:`1px solid ${C.border}`,cursor:"pointer"}}>
                  <td style={{padding:6,fontFamily:FM,whiteSpace:"nowrap"}}>{t.data?fmtDate(t.data):<span style={{color:C.warn}}>sem data</span>}</td>
                  <td style={{padding:6,fontWeight:600}}>{t.nome}{t.obs&&<div style={{fontSize:10,color:C.muted,fontWeight:400}}>{t.obs}</div>}</td>
                  <td style={{padding:6,color:C.muted}}>{t.beneficio}</td>
                  <td style={{padding:6,textAlign:"center",fontFamily:FM}}>{t.n}/{t.total}</td>
                  <td style={{padding:6}}>{t.forma}</td>
                  <td style={{padding:6,textAlign:"right",fontFamily:FM,fontWeight:700,color:C.success,whiteSpace:"nowrap"}}>{fmtCur(t.valor)}</td>
                </tr>))}
                <tr style={{borderTop:`2px solid ${C.accent}`}}><td colSpan={5} style={{padding:8,fontWeight:700}}>Total</td><td style={{padding:8,textAlign:"right",fontFamily:FM,fontWeight:700,color:C.success}}>{fmtCur(total)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {semData>0 && iv && <div style={{fontSize:11,color:C.warn,marginTop:10}}>Atenção: {semData} pagamento(s) antigo(s) estão sem data registrada e só aparecem em "Todo o período". Abra o cliente e preencha a data do pagamento para entrarem no período certo.</div>}
      </div>
    </div>
  );
}

function Dashboard({ clients, leads, tarefas, onSelectClient, onNewClient, onNewLead, onIr = ()=>{} }) {
  const total = clients.length;
  const ativos = clients.filter(c=>!["Encerrado","Benefício concedido"].includes(c.status)&&!ehIndeferido(c)).length;
  const concedidos = clients.filter(c=>c.status==="Benefício concedido").length;
  const recTotal = clients.reduce((s,c)=>s+valorFaturavel(c),0);
  const recebido = clients.reduce((s,c)=>s+lerParcelas(c).filter(p=>p.pago).reduce((t,p)=>t+(Number(p.valor)||0),0),0);
  const lAtivos = leads.filter(l=>l.status!=="Convertido"&&l.status!=="Perdido").length;
  const lQuentes = leads.filter(l=>l.temperatura==="🔥 Quente"&&l.status!=="Convertido"&&l.status!=="Perdido").length;
  const pendentes = tarefas.filter(t=>!t.concluida&&t.prazo<hoje()).length;
  const recentes = [...clients].sort((a,b)=>diaISO(b.dataCadastro).localeCompare(diaISO(a.dataCadastro))).slice(0,5);
  const tarefasUrgentes = tarefas.filter(t=>!t.concluida).sort((a,b)=>a.prazo>b.prazo?1:-1).slice(0,5);

  return (
    <div>
      <div style={{marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{fontFamily:FD,fontSize:22,color:C.accentLight,margin:0}}>Painel de Controle</h2>
          <p style={{color:C.muted,fontSize:12,margin:"3px 0 0",fontFamily:FM}}>{new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button style={{...S.btn("ghost"),fontSize:12}} onClick={onNewLead}>+ Lead</button>
          <button style={S.btn("primary")} onClick={onNewClient}>+ Novo Cliente</button>
        </div>
      </div>

      <Faturamento clients={clients} onIr={onIr}/>

      <div style={S.grid3}>
        {[
          {val:total,label:"Clientes",color:C.info,ir:["clientes",{}]},
          {val:ativos,label:"Processos Ativos",color:C.accent,ir:["clientes",{grupo:"ativos"}]},
          {val:concedidos,label:"Concedidos",color:C.success,ir:["clientes",{status:"Benefício concedido"}]},
          {val:lAtivos,label:"Leads Ativos",color:C.warn,ir:["leads",{ativos:true}]},
          {val:lQuentes,label:"Leads Quentes 🔥",color:C.danger,ir:["leads",{temp:"🔥 Quente"}]},
          {val:pendentes,label:"Tarefas Vencidas",color:pendentes>0?C.danger:C.success,ir:["agenda",{}]},
          {val:fmtCur(recTotal),label:"Honorários Totais",color:C.purple,ir:["clientes",{}]},
          {val:fmtCur(recebido),label:"Receita Recebida",color:C.success,ir:["recebimentos",{per:""}]},
          {val:fmtCur(recTotal-recebido),label:"A Receber",color:C.danger,ir:["clientes",{grupo:"areceber"}]},
        ].map((s,i)=>(
          <div key={i} role="button" tabIndex={0} title={`Abrir ${s.label}`} className="card-click"
            onClick={()=>onIr(...s.ir)} onKeyDown={e=>{ if(e.key==="Enter") onIr(...s.ir); }}
            style={{...S.stat,cursor:"pointer",position:"relative"}}>
            <span style={{...S.statVal,color:s.color,fontSize:typeof s.val==="string"?18:26}}>{s.val}</span>
            <span style={S.statLbl}>{s.label}</span>
            <span style={{position:"absolute",top:8,right:10,fontSize:11,color:C.muted}}>→</span>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:16}}>
        <div style={S.card}>
          <div style={{...S.cardTitle,cursor:"pointer"}} onClick={()=>onIr("agenda",{})} title="Abrir Agenda">Tarefas Urgentes <span style={{fontSize:11,color:C.muted}}>→</span></div>
          {tarefasUrgentes.length===0&&<p style={{color:C.muted,fontSize:12}}>Sem tarefas pendentes.</p>}
          {tarefasUrgentes.map((t,i)=>{
            const cli = clients.find(c=>c.id===t.clienteId||String(c.id)===String(t.clienteId));
            return (
              <div key={i} onClick={()=>cli?onSelectClient(cli):onIr("agenda",{})} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
                <div>
                  <div style={{fontSize:12,marginBottom:2}}>{t.descricao}</div>
                  <div style={{fontSize:10,color:C.muted,fontFamily:FM}}>{cli?.nome||"—"}</div>
                </div>
                <Tag color={t.prazo<hoje()?C.danger:C.accent}>{fmtDate(t.prazo)}</Tag>
              </div>
            );
          })}
        </div>
        <div style={S.card}>
          <div style={{...S.cardTitle,cursor:"pointer"}} onClick={()=>onIr("clientes",{})} title="Abrir Clientes">Clientes Recentes <span style={{fontSize:11,color:C.muted}}>→</span></div>
          {recentes.map(c=>(
            <div key={c.id} onClick={()=>onSelectClient(c)} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{c.nome}</div>
                <div style={{fontSize:11,color:C.muted,fontFamily:FM}}>{c.beneficio}</div>
              </div>
              <Tag color={statusColor[c.status]||C.muted}>{c.status}</Tag>
            </div>
          ))}
        </div>
      </div>

      <div style={{...S.card,marginTop:14}}>
        <div style={S.cardTitle}>Status dos Processos</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {STATUS_CLI.map(s=>{
            const n=clients.filter(c=>c.status===s).length;
            return (
              <div key={s} className="card-click" onClick={()=>onIr("clientes",{status:s})} title={`Ver clientes: ${s}`} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 12px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`,cursor:"pointer"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:statusColor[s]||C.muted}}/>
                <span style={{fontSize:12}}>{s}</span>
                <span style={{fontFamily:FM,fontSize:11,color:C.accent,fontWeight:700}}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LISTA DE CLIENTES
// ═══════════════════════════════════════════════════════════════════════════
const GRUPOS_CLI = { ativos:"Processos ativos", areceber:"Com valor a receber", pagantes:"Com pagamento recebido" };
function recebidoCli(c) { return lerParcelas(c).filter(p=>p.pago).reduce((t,p)=>t+(Number(p.valor)||0),0); }
function noGrupo(c, g) {
  if (g==="ativos") return !["Encerrado","Benefício concedido"].includes(c.status) && !ehIndeferido(c);
  if (g==="areceber") return valorFaturavel(c) - recebidoCli(c) > 0.009;
  if (g==="pagantes") return recebidoCli(c) > 0;
  return true;
}
function FiltroPainel({ texto, onLimpar }) {
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:8,background:C.accent+"22",border:`1px solid ${C.accent}`,borderRadius:16,padding:"4px 12px",fontSize:12,marginBottom:12}}>
      <span style={{color:C.accentLight}}>Filtro do painel: <b>{texto}</b></span>
      <button onClick={onLimpar} style={{background:"none",border:"none",color:C.accentLight,cursor:"pointer",fontSize:12,padding:0}} title="Limpar filtro">✕</button>
    </div>
  );
}

function ClientesList({ clients, tarefas, onSelect, onNew, preset = {} }) {
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState(preset.status||"");
  const [fGrupo, setFGrupo] = useState(preset.grupo||"");
  const [fBen, setFBen] = useState("");
  const [fPer, setFPer] = useState("");
  const [dIni, setDIni] = useState("");
  const [dFim, setDFim] = useState("");
  const intervalo = intervaloPeriodo(fPer, dIni, dFim);

  const filtered = clients.filter(c=>{
    const q=search.toLowerCase();
    const dc=diaISO(c.dataCadastro);
    return (!q||c.nome?.toLowerCase().includes(q)||String(c.cpf).includes(q)||String(c.telefone).includes(q)||String(c.numeroBeneficio||"").includes(q))
      &&(!fStatus||c.status===fStatus)&&(!fBen||c.beneficio===fBen)
      &&(!intervalo||(dc&&dc>=intervalo[0]&&dc<=intervalo[1]))
      &&(!fGrupo||noGrupo(c,fGrupo));
  }).sort((a,b)=>diaISO(b.dataCadastro).localeCompare(diaISO(a.dataCadastro)));
  const totalHon = filtered.reduce((t,c)=>t+valorFaturavel(c),0);
  const totalRec = filtered.reduce((t,c)=>t+recebidoCli(c),0);

  const exportCSV = () => {
    const header = ["Nome","CPF","Telefone","Benefício","Status","Honorários","Cadastro"].join(";");
    const rows = filtered.map(c=>[c.nome,c.cpf,c.telefone,c.beneficio,c.status,c.valorHonorarios,fmtDate(c.dataCadastro)].join(";"));
    const blob = new Blob([[header,...rows].join("\n")],{type:"text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="clientes.csv"; a.click();
  };

  return (
    <div>
      <div style={{marginBottom:16,display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"1 1 180px"}}><label style={S.lbl}>Buscar</label><input style={S.inp} placeholder="Nome, CPF, telefone, NB..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div style={{flex:"1 1 150px"}}><label style={S.lbl}>Status</label><select style={S.sel} value={fStatus} onChange={e=>setFStatus(e.target.value)}><option value="">Todos</option>{STATUS_CLI.map(s=><option key={s}>{s}</option>)}</select></div>
        <div style={{flex:"1 1 180px"}}><label style={S.lbl}>Benefício</label><select style={S.sel} value={fBen} onChange={e=>setFBen(e.target.value)}><option value="">Todos</option>{[...new Set([...BENEFICIOS, ...clients.map(c=>c.beneficio).filter(Boolean)])].sort().map(b=><option key={b}>{b}</option>)}</select></div>
        <div style={{flex:"1 1 160px"}}><label style={S.lbl}>Contrato fechado em</label><select style={S.sel} value={fPer} onChange={e=>setFPer(e.target.value)}>{PERIODOS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        {fPer==="custom"&&<>
          <div style={{flex:"1 1 140px"}}><label style={S.lbl}>De</label><input type="date" style={S.inp} value={dIni} onChange={e=>setDIni(e.target.value)}/></div>
          <div style={{flex:"1 1 140px"}}><label style={S.lbl}>Até</label><input type="date" style={S.inp} value={dFim} onChange={e=>setDFim(e.target.value)}/></div>
        </>}
        <button style={S.btn("ghost")} onClick={exportCSV}>↓ CSV</button>
        <button style={S.btn("primary")} onClick={onNew}>+ Novo Cliente</button>
      </div>
      {(intervalo||fBen||fStatus||fGrupo||search)&&<div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
        <div style={{flex:"1 1 160px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>Contratos fechados</div>
          <div style={{fontSize:22,fontWeight:700,color:C.accent,fontFamily:FD}}>{filtered.length}</div>
        </div>
        <div style={{flex:"1 1 160px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>Faturamento (contratado)</div>
          <div style={{fontSize:22,fontWeight:700,color:C.accentLight,fontFamily:FD}}>{fmtCur(totalHon)}</div>
        </div>
        <div style={{flex:"1 1 160px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>Recebido / A receber</div>
          <div style={{fontSize:16,fontWeight:700,fontFamily:FD,marginTop:4}}><span style={{color:C.success}}>{fmtCur(totalRec)}</span> <span style={{color:C.muted,fontSize:12}}>/</span> <span style={{color:C.danger}}>{fmtCur(Math.max(totalHon-totalRec,0))}</span></div>
        </div>
        <div style={{flex:"1 1 160px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:C.muted,fontFamily:FM,textTransform:"uppercase",letterSpacing:1}}>Período</div>
          <div style={{fontSize:13,fontWeight:600,marginTop:6}}>{!intervalo?"Todo o período":fPer==="custom"?`${dIni?fmtDate(dIni):"início"} a ${dFim?fmtDate(dFim):"sem limite"}`:`${fmtDate(intervalo[0])} a ${fmtDate(intervalo[1])}`}{fBen?` · ${fBen}`:""}</div>
        </div>
      </div>}
      {fGrupo&&<FiltroPainel texto={GRUPOS_CLI[fGrupo]} onLimpar={()=>setFGrupo("")}/>}
      <div style={{fontSize:11,color:C.muted,fontFamily:FM,marginBottom:10}}>{filtered.length} cliente(s)</div>
      {filtered.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Nenhum cliente encontrado.</div>}
      {filtered.map(c=>{
        const pct=c.parcelamentoTotal?(Number(c.parcelamentoPagas)/Number(c.parcelamentoTotal))*100:0;
        const tarefasPend=tarefas.filter(t=>String(t.clienteId)===String(c.id)&&!t.concluida&&t.prazo<hoje()).length;
        return (
          <div key={c.id} onClick={()=>onSelect(c)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,cursor:"pointer",marginBottom:8,transition:"border 0.2s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{c.nome}</div>
                <div style={{fontSize:11,color:C.muted,fontFamily:FM,marginBottom:4}}>CPF: {c.cpf} · {c.telefone} · {c.profissao}{c.numeroBeneficio?` · NB: ${c.numeroBeneficio}`:""}</div>
                <div style={{fontSize:12,color:C.muted}}>{c.beneficio}</div>
                <div style={{marginTop:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:FM,color:C.muted,marginBottom:2}}>
                    <span>{fmtCur(c.valorHonorarios)}</span>
                    <span>{c.parcelamentoPagas||0}/{c.parcelamentoTotal||1} parc.</span>
                  </div>
                  <Prog pct={pct} color={pct===100?C.success:C.accent}/>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
                <Tag color={statusColor[c.status]||C.muted}>{c.status}</Tag>
                {tarefasPend>0&&<Tag color={C.danger}>{tarefasPend} vencida(s)</Tag>}
                <span style={{fontSize:10,color:C.muted,fontFamily:FM}}>{fmtDate(c.dataCadastro)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DETALHE DO CLIENTE
// ═══════════════════════════════════════════════════════════════════════════
function ClienteDetalhe({ cliente, tarefas, mensagens, timeline, onBack, onSave, onSaveTarefa, onDelTarefa, onSaveMensagem, onAddTimeline, onDelTimeline, onDelete }) {
  const [confirmaExc, setConfirmaExc] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [tab, setTab] = useState("dados");
  const [form, setForm] = useState({...cliente});
  const [saving, setSaving] = useState(false);
  const [docTipo, setDocTipo] = useState("contrato");
  const [docText, setDocText] = useState("");
  const [msgTipo, setMsgTipo] = useState("protocolo");
  const [msgText, setMsgText] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [novaTarefa, setNovaTarefa] = useState({descricao:"",prazo:""});
  const [novaMensagem, setNovaMensagem] = useState("");

  const save = async () => { setSaving(true); await onSave(form); setSaving(false); };


  const [msgOrient, setMsgOrient] = useState("");
  const [msgArquivo, setMsgArquivo] = useState(null);
  const [msgErro, setMsgErro] = useState("");
  const msgFileRef = useRef();
  const [msgDrag, setMsgDrag] = useState(false);
  const [msgEnviada, setMsgEnviada] = useState(false);
  const escolherArquivoMsg = (f) => { if(!f) return; if(f.size>3*1024*1024){ setMsgErro("Arquivo muito grande. Máximo 3MB (limite do servidor). Tire uma foto ou envie só as páginas principais."); return; } setMsgErro(""); setMsgArquivo(f); };
  const gerarMsg = async () => {
    setMsgErro("");
    if (msgTipo==="documento" && !msgArquivo) { setMsgErro("Anexe o documento no quadro acima primeiro."); return; }
    setMsgLoading(true);
    try {
      let t;
      if (msgArquivo) {
        const b64 = await new Promise((ok,ko)=>{ const fr=new FileReader(); fr.onload=e=>ok(String(e.target.result).split(",")[1]); fr.onerror=()=>ko(new Error("Erro ao ler o arquivo")); fr.readAsDataURL(msgArquivo); });
        const contexto = msgTipo!=="documento" ? `Contexto escolhido pelo advogado: ${MSG_TIPOS[msgTipo]}. ` : "";
        t = await gerarMsgDocumento(form, b64, msgArquivo.type, msgArquivo.name, contexto + msgOrient);
      } else {
        t = await gerarMsgIA(form, msgTipo, msgOrient);
      }
      setMsgText(t);
    } catch (e) { setMsgErro(e.message || "Erro ao gerar a mensagem"); }
    setMsgLoading(false);
  };

  const wpp = (t) => abrirWhatsApp(form.telefone, t);

  const addTarefa = () => {
    if (!novaTarefa.descricao) return;
    onSaveTarefa({id:uid(),clienteId:form.id,...novaTarefa,concluida:false});
    setNovaTarefa({descricao:"",prazo:""});
  };

  const tabs = [{k:"dados",l:"Dados"},{k:"financeiro",l:"Financeiro"},{k:"docs",l:"Documentos"},{k:"timeline",l:"Histórico"},{k:"tarefas",l:"Tarefas"},{k:"msgs",l:"Comunicação"}];
  const minhasTarefas = tarefas.filter(t=>String(t.clienteId)===String(form.id));
  const minhasMensagens = mensagens.filter(m=>String(m.clienteId)===String(form.id));
  const meuTimeline = timeline.filter(e=>String(e.clienteId)===String(form.id));
  const pct = form.parcelamentoTotal?(Number(form.parcelamentoPagas)/Number(form.parcelamentoTotal))*100:0;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{...S.btn("ghost"),padding:"6px 12px"}}>← Voltar</button>
        <div style={{flex:1}}>
          <h2 style={{fontFamily:FD,fontSize:19,color:C.accentLight,margin:0}}>{form.nome}</h2>
          <span style={{fontFamily:FM,fontSize:10,color:C.muted}}>{form.beneficio}{form.numeroBeneficio?` · NB: ${form.numeroBeneficio}`:""}</span>
        </div>
        <Tag color={statusColor[form.status]||C.muted}>{form.status}</Tag>
        {onDelete&&<button onClick={()=>setConfirmaExc(true)} title="Excluir cliente" style={{...S.btn("ghost"),padding:"6px 12px",color:C.danger,borderColor:C.danger+"66"}}>🗑 Excluir</button>}
      </div>

      {confirmaExc&&(
        <div onClick={()=>!excluindo&&setConfirmaExc(false)} style={{position:"fixed",inset:0,background:"#000a",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{...S.card,maxWidth:440,width:"100%",border:`1px solid ${C.danger}`}}>
            <div style={{fontFamily:FD,fontSize:18,color:C.danger,marginBottom:8}}>Excluir cliente?</div>
            <div style={{fontSize:13,lineHeight:1.6,marginBottom:6}}>Você está excluindo <b>{form.nome}</b>. A linha dele será apagada da planilha, junto com as tarefas e o histórico processual.</div>
            <div style={{fontSize:12,color:C.warn,marginBottom:14}}>Essa ação não pode ser desfeita. Se o caso só terminou, prefira mudar o status para "Encerrado" ou "Benefício indeferido".</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button style={S.btn("ghost")} disabled={excluindo} onClick={()=>setConfirmaExc(false)}>Cancelar</button>
              <button style={S.btn("danger")} disabled={excluindo} onClick={async()=>{ setExcluindo(true); await onDelete(cliente); }}>{excluindo?"Excluindo...":"Excluir definitivamente"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {tabs.map(t=><button key={t.k} style={{...S.navBtn(tab===t.k),borderRadius:7}} onClick={()=>setTab(t.k)}>{t.l}</button>)}
      </div>

      {tab==="dados" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Dados Pessoais</div>
          <div style={{marginBottom:16}}>
            <DocUpload atual={form} onExtracted={d=>setForm(p=>({...p,...d}))}/>
          </div>
          <div style={S.grid2}>
            <F label="Nome Completo"><input style={S.inp} value={form.nome||""} onChange={e=>setForm({...form,nome:e.target.value})}/></F>
            <F label="CPF"><input style={S.inp} value={form.cpf||""} onChange={e=>setForm({...form,cpf:e.target.value})}/></F>
            <F label="RG"><input style={S.inp} value={form.rg||""} onChange={e=>setForm({...form,rg:e.target.value})}/></F>
            <F label="Data de Nascimento">
              <input style={S.inp} type="date" value={diaISO(form.dataNascimento)} onChange={e=>setForm({...form,dataNascimento:e.target.value})}/>
              {form.dataNascimento&&<div style={{fontSize:10,color:C.muted,marginTop:3,fontFamily:FM}}>{calcIdade(form.dataNascimento)} anos</div>}
            </F>
            <F label="Nacionalidade"><select style={S.sel} value={form.nacionalidade||""} onChange={e=>setForm({...form,nacionalidade:e.target.value})}><option value="">Selecionar</option>{NACIONALIDADES.map(n=><option key={n}>{n}</option>)}</select></F>
            <F label="Estado Civil"><select style={S.sel} value={form.estadoCivil||""} onChange={e=>setForm({...form,estadoCivil:e.target.value})}><option value="">Selecionar</option>{ESTADO_CIVIL.map(n=><option key={n}>{n}</option>)}</select></F>
            <F label="Profissão"><input style={S.inp} value={form.profissao||""} onChange={e=>setForm({...form,profissao:e.target.value})}/></F>
            <F label="Telefone"><input style={S.inp} value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})}/></F>
            <F label="E-mail"><input style={S.inp} value={form.email||""} onChange={e=>setForm({...form,email:e.target.value})}/></F>
            <F label="Número do Benefício/NB"><input style={S.inp} value={form.numeroBeneficio||""} onChange={e=>setForm({...form,numeroBeneficio:e.target.value})} placeholder="NB ou nº do processo"/></F>
            <F label="Benefício"><select style={S.sel} value={form.beneficio||""} onChange={e=>setForm({...form,beneficio:e.target.value})}>{[...new Set([form.beneficio, ...BENEFICIOS].filter(Boolean))].map(b=><option key={b}>{b}</option>)}</select></F>
            <F label="Status"><select style={S.sel} value={form.status||""} onChange={e=>setForm({...form,status:e.target.value})}>{STATUS_CLI.map(s=><option key={s}>{s}</option>)}</select></F>
            <F label="Data do contrato"><input type="date" style={S.inp} value={diaISO(form.dataCadastro)} onChange={e=>setForm({...form,dataCadastro:e.target.value})}/></F>
          </div>
          <F label="CEP"><CepInput value={form.cep||""} onChange={v=>setForm({...form,cep:v})} onEnderecoFound={e=>setForm(p=>({...p,endereco:e}))}/></F>
          <F label="Endereço Completo"><input style={S.inp} value={form.endereco||""} onChange={e=>setForm({...form,endereco:e.target.value})}/></F>
          <Representante form={form} setForm={setForm}/>
          <F label="Observações"><textarea style={{...S.textarea,minHeight:70}} value={form.observacoes||""} onChange={e=>setForm({...form,observacoes:e.target.value})}/></F>
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
            <button style={S.btn("primary")} onClick={save} disabled={saving}>{saving?"Salvando...":"Salvar Alterações"}</button>
          </div>
        </div>
      )}

      {tab==="financeiro" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Gestão Financeira</div>
          <Parcelas cliente={form} onChange={setForm}/>
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
            <button style={S.btn("primary")} onClick={save} disabled={saving}>{saving?"Salvando...":"Salvar"}</button>
          </div>
        </div>
      )}

      {tab==="docs" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Gerar Documentos</div>
          <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 200px"}}>
              <label style={S.lbl}>Tipo</label>
              <select style={S.sel} value={docTipo} onChange={e=>setDocTipo(e.target.value)}>
                <option value="contrato">Contrato de Honorários</option>
                <option value="procuracao">Procuração Ad Judicia</option>
                <option value="hiposuficiencia">Declaração de Hipossuficiência</option>
              </select>
            </div>
            <div style={{display:"flex",alignItems:"flex-end"}}>
              <button style={S.btn("primary")} onClick={()=>setDocText(gerarDoc(docTipo,form))}>Gerar</button>
            </div>
          </div>
          {docText && (
            <div>
              <textarea style={{...S.textarea,minHeight:360}} value={docText} onChange={e=>setDocText(e.target.value)}/>
              <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
                <button style={S.btn("ghost")} onClick={()=>navigator.clipboard.writeText(docText)}>Copiar</button>
                <button style={S.btn("success")} onClick={()=>{const b=new Blob([docText],{type:"text/plain"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`${docTipo}_${form.nome?.replace(/ /g,"_")}.txt`;a.click();}}>↓ Baixar .txt</button>
              </div>
            </div>
          )}
          <ModelosDocx cliente={form}/>
        </div>
      )}

      {tab==="timeline" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Histórico Processual</div>
          <Timeline eventos={meuTimeline} clienteId={form.id} onAdd={onAddTimeline} onDelete={onDelTimeline}/>
        </div>
      )}

      {tab==="tarefas" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Tarefas</div>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <div style={{flex:"2 1 180px"}}><label style={S.lbl}>Descrição</label><input style={S.inp} value={novaTarefa.descricao} onChange={e=>setNovaTarefa({...novaTarefa,descricao:e.target.value})} placeholder="Ex: Protocolar recurso"/></div>
            <div style={{flex:"1 1 120px"}}><label style={S.lbl}>Prazo</label><input style={S.inp} type="date" value={novaTarefa.prazo} onChange={e=>setNovaTarefa({...novaTarefa,prazo:e.target.value})}/></div>
            <div style={{display:"flex",alignItems:"flex-end"}}><button style={S.btn("primary")} onClick={addTarefa}>Adicionar</button></div>
          </div>
          {minhasTarefas.length===0&&<p style={{color:C.muted,fontSize:12}}>Nenhuma tarefa.</p>}
          {minhasTarefas.sort((a,b)=>Number(a.concluida)-Number(b.concluida)).map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <input type="checkbox" checked={!!t.concluida} onChange={()=>onSaveTarefa({...t,concluida:!t.concluida})} style={{accentColor:C.accent}}/>
              <div style={{flex:1,fontSize:12,textDecoration:t.concluida?"line-through":"none",color:t.concluida?C.muted:C.text}}>{t.descricao}</div>
              {t.prazo&&<Tag color={t.concluida?C.muted:t.prazo<hoje()?C.danger:C.accent}>{fmtDate(t.prazo)}</Tag>}
              <button onClick={()=>onDelTarefa(t.id)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:12}}>✕</button>
            </div>
          ))}
        </div>
      )}

      {tab==="msgs" && (
        <div>
          <div style={S.card}>
            <div style={S.cardTitle}>Gerar Mensagem com IA</div>
            <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{flex:"1 1 200px"}}>
                <label style={S.lbl}>Tipo</label>
                <select style={S.sel} value={msgTipo} onChange={e=>setMsgTipo(e.target.value)}>
                  {Object.entries(MSG_TIPOS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"flex-end"}}><button style={S.btn("info")} onClick={gerarMsg} disabled={msgLoading}>{msgLoading?"Gerando...":"Gerar"}</button></div>
            </div>
            <label style={S.lbl}>Documento para resumir (opcional)</label>
            <div
              onClick={()=>!msgLoading&&msgFileRef.current.click()}
              onDragOver={e=>{e.preventDefault();setMsgDrag(true);}}
              onDragLeave={()=>setMsgDrag(false)}
              onDrop={e=>{e.preventDefault();setMsgDrag(false);escolherArquivoMsg(e.dataTransfer.files[0]);}}
              style={{border:`2px dashed ${msgDrag?C.accent:msgArquivo?C.success:C.border}`,borderRadius:10,padding:"18px 16px",textAlign:"center",cursor:"pointer",marginBottom:10,background:msgArquivo?C.success+"0d":msgDrag?C.accent+"0d":"transparent",transition:"all 0.2s"}}>
              <div style={{fontSize:22,marginBottom:5}}>{msgArquivo?"✅":"📄"}</div>
              <div style={{fontSize:13,color:msgArquivo?C.success:C.muted,marginBottom:3}}>{msgArquivo?msgArquivo.name:"Enviar decisão, carta de exigência, sentença, extrato ou outro documento"}</div>
              <div style={{fontSize:10,color:C.muted,fontFamily:FM}}>{msgArquivo?"A mensagem será um resumo deste documento · clique para trocar":"JPG, PNG, PDF · máx. 3MB · clique ou arraste o arquivo"}</div>
              <input ref={msgFileRef} type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={e=>{ const f=e.target.files[0]; e.target.value=""; escolherArquivoMsg(f); }}/>
            </div>
            {msgArquivo&&<div style={{display:"flex",justifyContent:"flex-end",marginTop:-6,marginBottom:10}}><button type="button" onClick={()=>setMsgArquivo(null)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:11,fontFamily:FM}}>✕ remover arquivo</button></div>}
            <div style={{marginBottom:10}}>
              <label style={S.lbl}>Orientação para a IA (opcional)</label>
              <textarea style={{...S.textarea,minHeight:44,fontSize:12}} value={msgOrient} onChange={e=>setMsgOrient(e.target.value)} placeholder={msgArquivo?"Ex.: explique que vamos recorrer e que ela não precisa ir ao INSS":"Ex.: avise que a perícia é dia 20/10 às 8h na APS Centro"}/>
            </div>
            {msgErro&&<div style={{marginBottom:10,background:C.danger+"18",border:`1px solid ${C.danger}44`,borderRadius:8,padding:"8px 12px",color:C.danger,fontSize:12,fontFamily:FM}}>⚠ {msgErro}</div>}
            {msgLoading&&<Spin text={msgArquivo?"Lendo o documento e redigindo...":"Redigindo mensagem..."}/>}
            {msgText&&(
              <div>
                <textarea style={{...S.textarea,minHeight:120}} value={msgText} onChange={e=>setMsgText(e.target.value)}/>
                <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
                  <button style={S.btn("ghost")} onClick={()=>navigator.clipboard.writeText(msgText)}>Copiar</button>
                  <button style={S.btn("success")} onClick={()=>{ if(wpp(msgText)) { onSaveMensagem({id:uid(),clienteId:form.id,de:"escritorio",texto:msgText,data:hoje()}); setMsgEnviada(true); setTimeout(()=>setMsgEnviada(false),4000); } }}>{msgEnviada?"✓ Aberto no WhatsApp Web":"Enviar pelo WhatsApp Web"}</button>
                </div>
              </div>
            )}
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Histórico de Comunicações</div>
            <div style={{marginBottom:12}}>
              <textarea style={{...S.textarea,minHeight:70}} value={novaMensagem} onChange={e=>setNovaMensagem(e.target.value)} placeholder="Registrar comunicação..."/>
              <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
                <button style={S.btn("ghost")} onClick={()=>{ if(!novaMensagem.trim())return; if(wpp(novaMensagem)) { onSaveMensagem({id:uid(),clienteId:form.id,de:"escritorio",texto:novaMensagem,data:hoje()}); setNovaMensagem(""); } }}>Enviar pelo WhatsApp Web</button>
                <button style={S.btn("primary")} onClick={()=>{ if(!novaMensagem.trim())return; onSaveMensagem({id:uid(),clienteId:form.id,de:"escritorio",texto:novaMensagem,data:hoje()}); setNovaMensagem(""); }}>Registrar</button>
              </div>
            </div>
            {minhasMensagens.length===0&&<p style={{color:C.muted,fontSize:12}}>Nenhuma comunicação registrada.</p>}
            {[...minhasMensagens].reverse().map((m,i)=>(
              <div key={i} style={{background:C.surface,borderRadius:8,padding:10,marginBottom:6,borderLeft:`3px solid ${C.accent}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:10,fontFamily:FM,color:C.accent}}>Escritório</span>
                  <span style={{fontSize:10,fontFamily:FM,color:C.muted}}>{fmtDate(m.data)}</span>
                </div>
                <div style={{fontSize:12,lineHeight:1.6}}>{m.texto}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMULÁRIO NOVO CLIENTE
// ═══════════════════════════════════════════════════════════════════════════
function NovoCliente({ onSave, onCancel }) {
  const [form, setForm] = useState({ nome:"",cpf:"",rg:"",dataNascimento:"",telefone:"",email:"",profissao:"",nacionalidade:"brasileiro(a)",estadoCivil:"",cep:"",endereco:"",beneficio:BENEFICIOS[0],status:"Novo cliente",valorHonorarios:"",parcelamentoTotal:1,parcelamentoPagas:0,parcelamentoValor:"",dataCadastro:hoje(),observacoes:"",numeroBeneficio:"" });
  const save = () => { if(!form.nome||!form.cpf)return alert("Nome e CPF obrigatórios."); onSave({...form,id:uid()}); };
  return (
    <div style={S.modal}>
      <div style={S.modalBox}>
        <h3 style={{fontFamily:FD,color:C.accentLight,marginTop:0,marginBottom:16}}>Novo Cliente</h3>
        <div style={{marginBottom:14}}><DocUpload atual={form} onExtracted={d=>setForm(p=>({...p,...d}))}/></div>
        <div style={S.grid2}>
          <F label="Nome *"><input style={S.inp} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/></F>
          <F label="CPF *"><input style={S.inp} value={form.cpf} onChange={e=>setForm({...form,cpf:e.target.value})} placeholder="000.000.000-00"/></F>
          <F label="RG"><input style={S.inp} value={form.rg} onChange={e=>setForm({...form,rg:e.target.value})}/></F>
          <F label="Nascimento"><input style={S.inp} type="date" value={diaISO(form.dataNascimento)} onChange={e=>setForm({...form,dataNascimento:e.target.value})}/></F>
          <F label="Nacionalidade"><select style={S.sel} value={form.nacionalidade} onChange={e=>setForm({...form,nacionalidade:e.target.value})}>{NACIONALIDADES.map(n=><option key={n}>{n}</option>)}</select></F>
          <F label="Estado Civil"><select style={S.sel} value={form.estadoCivil} onChange={e=>setForm({...form,estadoCivil:e.target.value})}><option value="">Selecionar</option>{ESTADO_CIVIL.map(n=><option key={n}>{n}</option>)}</select></F>
          <F label="Profissão"><input style={S.inp} value={form.profissao} onChange={e=>setForm({...form,profissao:e.target.value})}/></F>
          <F label="Telefone"><input style={S.inp} value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="(96) 99000-0000"/></F>
          <F label="Benefício"><select style={S.sel} value={form.beneficio} onChange={e=>setForm({...form,beneficio:e.target.value})}>{BENEFICIOS.map(b=><option key={b}>{b}</option>)}</select></F>
          <F label="Nº Benefício/NB"><input style={S.inp} value={form.numeroBeneficio} onChange={e=>setForm({...form,numeroBeneficio:e.target.value})}/></F>
          <F label="Honorários (R$)"><input style={S.inp} type="number" value={form.valorHonorarios} onChange={e=>setForm({...form,valorHonorarios:e.target.value})}/></F>
          <F label="Parcelas"><input style={S.inp} type="number" min={1} value={form.parcelamentoTotal} onChange={e=>setForm({...form,parcelamentoTotal:Number(e.target.value)})}/></F>
        </div>
        <F label="CEP"><CepInput value={form.cep} onChange={v=>setForm({...form,cep:v})} onEnderecoFound={e=>setForm(p=>({...p,endereco:e}))}/></F>
        <F label="Endereço"><input style={S.inp} value={form.endereco} onChange={e=>setForm({...form,endereco:e.target.value})}/></F>
        <Representante form={form} setForm={setForm}/>
        <F label="Observações"><textarea style={{...S.textarea,minHeight:60}} value={form.observacoes} onChange={e=>setForm({...form,observacoes:e.target.value})}/></F>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
          <button style={S.btn("ghost")} onClick={onCancel}>Cancelar</button>
          <button style={S.btn("primary")} onClick={save}>Cadastrar</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════
function LeadCard({ lead, onClick, onConvert }) {
  const wpp = (e) => { e.stopPropagation(); abrirWhatsApp(lead.telefone); };
  return (
    <div onClick={onClick} style={{background:C.card,border:`1px solid ${tempColor[lead.temperatura]||C.border}`,borderLeft:`4px solid ${tempColor[lead.temperatura]||C.border}`,borderRadius:10,padding:12,cursor:"pointer",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{lead.nome}</div>
          <div style={{fontSize:11,color:C.muted,fontFamily:FM,marginBottom:4}}>{lead.telefone} · {lead.origem}</div>
          <div style={{fontSize:11,color:C.accentLight}}>{lead.beneficioInteresse}</div>
          {lead.observacoes&&<div style={{fontSize:10,color:C.muted,marginTop:4,fontStyle:"italic",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{lead.observacoes}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <Tag color={tempColor[lead.temperatura]||C.muted}>{lead.temperatura}</Tag>
          <Tag color={leadStatusColor[lead.status]||C.muted}>{lead.status}</Tag>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginTop:8,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
        <button style={{...S.btn("ghost"),padding:"4px 10px",fontSize:11}} onClick={wpp}>WhatsApp</button>
        {!["Convertido","Perdido"].includes(lead.status)&&<button style={{...S.btn("success"),padding:"4px 10px",fontSize:11}} onClick={e=>{e.stopPropagation();onConvert(lead);}}>Converter</button>}
      </div>
    </div>
  );
}

function LeadDetalhe({ lead, followUps, onBack, onSave, onSaveFollowUp, onDelFollowUp, onConvert }) {
  const [form, setForm] = useState({...lead});
  const [saving, setSaving] = useState(false);
  const [novoFU, setNovoFU] = useState({descricao:"",prazo:""});
  const meusFU = followUps.filter(f=>String(f.leadId)===String(lead.id));
  const save = async () => { setSaving(true); await onSave(form); setSaving(false); };
  const wpp = (t) => abrirWhatsApp(form.telefone, t);
  const msgs = [
    {label:"Apresentação inicial", texto:`Olá ${form.nome?.split(" ")[0]}! Sou a Yalley Vasconcelos, advogada previdenciária em Macapá. Vi que você tem interesse em ${form.beneficioInteresse}. Posso te ajudar a conquistar esse benefício! Podemos conversar?`},
    {label:"Lembrete de retorno", texto:`Olá ${form.nome?.split(" ")[0]}! Passando para saber se você teve oportunidade de pensar sobre o ${form.beneficioInteresse}. Quando podemos conversar?`},
    {label:"Urgência", texto:`Olá ${form.nome?.split(" ")[0]}! Seu caso de ${form.beneficioInteresse} tem prazo. Posso fazer uma análise gratuita agora?`},
  ];
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{...S.btn("ghost"),padding:"6px 12px"}}>← Voltar</button>
        <div style={{flex:1}}>
          <h2 style={{fontFamily:FD,fontSize:19,color:C.accentLight,margin:0}}>{form.nome}</h2>
          <span style={{fontFamily:FM,fontSize:10,color:C.muted}}>Lead · {form.origem}</span>
        </div>
        <Tag color={tempColor[form.temperatura]||C.muted}>{form.temperatura}</Tag>
        {!["Convertido","Perdido"].includes(form.status)&&<button style={S.btn("success")} onClick={()=>onConvert(form)}>Converter em Cliente</button>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={S.card}>
          <div style={S.cardTitle}>Dados do Lead</div>
          <div style={S.grid2}>
            <F label="Nome"><input style={S.inp} value={form.nome||""} onChange={e=>setForm({...form,nome:e.target.value})}/></F>
            <F label="Telefone"><input style={S.inp} value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})}/></F>
            <F label="Benefício"><select style={S.sel} value={form.beneficioInteresse||""} onChange={e=>setForm({...form,beneficioInteresse:e.target.value})}>{[...new Set([form.beneficioInteresse, ...BENEFICIOS].filter(Boolean))].map(b=><option key={b}>{b}</option>)}</select></F>
            <F label="Origem"><select style={S.sel} value={form.origem||""} onChange={e=>setForm({...form,origem:e.target.value})}>{ORIGEM_OPTS.map(o=><option key={o}>{o}</option>)}</select></F>
            <F label="Temperatura"><select style={S.sel} value={form.temperatura||""} onChange={e=>setForm({...form,temperatura:e.target.value})}>{TEMP_OPTS.map(t=><option key={t}>{t}</option>)}</select></F>
            <F label="Status"><select style={S.sel} value={form.status||""} onChange={e=>setForm({...form,status:e.target.value})}>{STATUS_LEAD.map(s=><option key={s}>{s}</option>)}</select></F>
          </div>
          <F label="Observações"><textarea style={{...S.textarea,minHeight:80}} value={form.observacoes||""} onChange={e=>setForm({...form,observacoes:e.target.value})}/></F>
          <div style={{display:"flex",justifyContent:"flex-end"}}><button style={S.btn("primary")} onClick={save} disabled={saving}>{saving?"Salvando...":"Salvar"}</button></div>
        </div>
        <div>
          <div style={S.card}>
            <div style={S.cardTitle}>Follow-ups</div>
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{flex:"2 1 140px"}}><label style={S.lbl}>Ação</label><input style={S.inp} value={novoFU.descricao} onChange={e=>setNovoFU({...novoFU,descricao:e.target.value})} placeholder="Ex: Ligar para tirar dúvidas"/></div>
              <div style={{flex:"1 1 110px"}}><label style={S.lbl}>Prazo</label><input style={S.inp} type="date" value={novoFU.prazo} onChange={e=>setNovoFU({...novoFU,prazo:e.target.value})}/></div>
              <div style={{display:"flex",alignItems:"flex-end"}}><button style={S.btn("primary")} onClick={()=>{if(!novoFU.descricao)return;onSaveFollowUp({id:uid(),leadId:lead.id,...novoFU,concluido:false});setNovoFU({descricao:"",prazo:""});}}>+</button></div>
            </div>
            {meusFU.length===0&&<p style={{color:C.muted,fontSize:12}}>Nenhum follow-up.</p>}
            {meusFU.sort((a,b)=>Number(a.concluido)-Number(b.concluido)).map(f=>(
              <div key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                <input type="checkbox" checked={!!f.concluido} onChange={()=>onSaveFollowUp({...f,concluido:!f.concluido})} style={{accentColor:C.accent}}/>
                <div style={{flex:1,fontSize:12,textDecoration:f.concluido?"line-through":"none",color:f.concluido?C.muted:C.text}}>{f.descricao}</div>
                {f.prazo&&<Tag color={f.concluido?C.muted:f.prazo<hoje()?C.danger:C.accent}>{fmtDate(f.prazo)}</Tag>}
                <button onClick={()=>onDelFollowUp(f.id)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:12}}>✕</button>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Mensagens WhatsApp</div>
            {msgs.map((m,i)=>(
              <div key={i} style={{background:C.surface,borderRadius:8,padding:10,marginBottom:8}}>
                <div style={{fontSize:10,color:C.accent,fontFamily:FM,marginBottom:5}}>{m.label}</div>
                <div style={{fontSize:11,color:C.muted,marginBottom:6,lineHeight:1.6}}>{m.texto}</div>
                <button style={{...S.btn("success"),padding:"4px 12px",fontSize:11}} onClick={()=>wpp(m.texto)}>Enviar</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeadsList({ leads, followUps, onNew, onSaveLead, onSaveFollowUp, onDelFollowUp, onConvert, preset = {} }) {
  const [search, setSearch] = useState("");
  const [fTemp, setFTemp] = useState(preset.temp||"");
  const [fStatus, setFStatus] = useState("");
  const [fAtivos, setFAtivos] = useState(!!preset.ativos);
  const [selected, setSelected] = useState(null);

  const filtered = leads.filter(l=>{
    const q=search.toLowerCase();
    return(!q||l.nome?.toLowerCase().includes(q)||String(l.telefone).includes(q))&&(!fTemp||l.temperatura===fTemp)&&(!fStatus||l.status===fStatus)&&(!fAtivos||!["Convertido","Perdido"].includes(l.status));
  });

  const col = (label,items,color,empty) => (
    <div style={{flex:"1 1 230px",minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:color}}/>
        <span style={{fontFamily:FM,fontSize:10,color,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
        <Tag color={color}>{items.length}</Tag>
      </div>
      {items.length===0
        ?<div style={{background:C.card,border:`1px dashed ${C.border}`,borderRadius:10,padding:16,textAlign:"center",color:C.muted,fontSize:11}}>{empty}</div>
        :items.map(l=><LeadCard key={l.id} lead={l} onClick={()=>setSelected(l)} onConvert={onConvert}/>)
      }
    </div>
  );

  if (selected) return (
    <LeadDetalhe lead={selected} followUps={followUps}
      onBack={()=>setSelected(null)}
      onSave={async(d)=>{await onSaveLead(d);setSelected(d);}}
      onSaveFollowUp={onSaveFollowUp} onDelFollowUp={onDelFollowUp}
      onConvert={(l)=>{onConvert(l);setSelected(null);}}
    />
  );

  const quentes=filtered.filter(l=>l.temperatura==="🔥 Quente"&&!["Convertido","Perdido"].includes(l.status));
  const mornos=filtered.filter(l=>l.temperatura==="🟡 Morno"&&!["Convertido","Perdido"].includes(l.status));
  const frios=filtered.filter(l=>l.temperatura==="❄️ Frio"&&!["Convertido","Perdido"].includes(l.status));
  const conv=filtered.filter(l=>l.status==="Convertido");
  const perd=filtered.filter(l=>l.status==="Perdido");

  return (
    <div>
      <div style={{marginBottom:14,display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"1 1 160px"}}><label style={S.lbl}>Buscar</label><input style={S.inp} placeholder="Nome ou telefone..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div style={{flex:"1 1 130px"}}><label style={S.lbl}>Temperatura</label><select style={S.sel} value={fTemp} onChange={e=>setFTemp(e.target.value)}><option value="">Todas</option>{TEMP_OPTS.map(t=><option key={t}>{t}</option>)}</select></div>
        <div style={{flex:"1 1 150px"}}><label style={S.lbl}>Status</label><select style={S.sel} value={fStatus} onChange={e=>setFStatus(e.target.value)}><option value="">Todos</option>{STATUS_LEAD.map(s=><option key={s}>{s}</option>)}</select></div>
        <button style={S.btn("primary")} onClick={onNew}>+ Novo Lead</button>
      </div>
      {fAtivos&&<FiltroPainel texto="Leads ativos (sem convertidos e perdidos)" onLimpar={()=>setFAtivos(false)}/>}
      <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:8}}>
        {col("🔥 Quentes",quentes,C.danger,"Nenhum lead quente")}
        {col("🟡 Mornos",mornos,C.warn,"Nenhum lead morno")}
        {col("❄️ Frios",frios,C.info,"Nenhum lead frio")}
        {col("Convertidos",conv,C.success,"Nenhum convertido")}
        {col("Perdidos",perd,C.muted,"Nenhum perdido")}
      </div>
    </div>
  );
}

function NovoLead({ onSave, onCancel }) {
  const [form, setForm] = useState({nome:"",telefone:"",beneficioInteresse:BENEFICIOS[4],temperatura:"🔥 Quente",origem:"WhatsApp",status:"Novo contato",observacoes:"",dataCadastro:hoje()});
  const save = () => { if(!form.nome||!form.telefone)return alert("Nome e telefone obrigatórios."); onSave({...form,id:uid()}); };
  return (
    <div style={S.modal}>
      <div style={S.modalBox}>
        <h3 style={{fontFamily:FD,color:C.accentLight,marginTop:0,marginBottom:16}}>Novo Lead</h3>
        <div style={S.grid2}>
          <F label="Nome *"><input style={S.inp} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/></F>
          <F label="Telefone *"><input style={S.inp} value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="(96) 99000-0000"/></F>
          <F label="Benefício"><select style={S.sel} value={form.beneficioInteresse} onChange={e=>setForm({...form,beneficioInteresse:e.target.value})}>{BENEFICIOS.map(b=><option key={b}>{b}</option>)}</select></F>
          <F label="Origem"><select style={S.sel} value={form.origem} onChange={e=>setForm({...form,origem:e.target.value})}>{ORIGEM_OPTS.map(o=><option key={o}>{o}</option>)}</select></F>
          <F label="Temperatura"><select style={S.sel} value={form.temperatura} onChange={e=>setForm({...form,temperatura:e.target.value})}>{TEMP_OPTS.map(t=><option key={t}>{t}</option>)}</select></F>
          <F label="Status"><select style={S.sel} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{STATUS_LEAD.filter(s=>s!=="Convertido").map(s=><option key={s}>{s}</option>)}</select></F>
        </div>
        <F label="Observações"><textarea style={{...S.textarea,minHeight:60}} value={form.observacoes} onChange={e=>setForm({...form,observacoes:e.target.value})} placeholder="Contexto, objeções, expectativas..."/></F>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
          <button style={S.btn("ghost")} onClick={onCancel}>Cancelar</button>
          <button style={S.btn("primary")} onClick={save}>Cadastrar</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENDA GLOBAL
// ═══════════════════════════════════════════════════════════════════════════
function AgendaGlobal({ clients, leads, tarefas, followUps, onSaveTarefa, onDelTarefa, onSaveFollowUp }) {
  const hj = hoje();
  const allTarefas = tarefas.map(t=>({ ...t, nome: clients.find(c=>String(c.id)===String(t.clienteId))?.nome||"?", tipo:"tarefa" }));
  const allFU = followUps.map(f=>({ ...f, nome: leads.find(l=>String(l.id)===String(f.leadId))?.nome||"?", tipo:"followup", concluida:f.concluido }));
  const all = [...allTarefas,...allFU].sort((a,b)=>a.prazo>b.prazo?1:-1);
  const venc=all.filter(i=>!i.concluida&&i.prazo<hj);
  const hoje_=all.filter(i=>!i.concluida&&i.prazo===hj);
  const fut=all.filter(i=>!i.concluida&&i.prazo>hj);
  const conc=all.filter(i=>i.concluida||i.concluido);

  const toggle = (item) => {
    if (item.tipo==="tarefa") onSaveTarefa({...item,concluida:!item.concluida});
    else onSaveFollowUp({...item,concluido:!item.concluido});
  };

  const renderGroup = (label,items,color) => items.length>0&&(
    <div style={{marginBottom:18}}>
      <div style={{fontFamily:FM,fontSize:10,color,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{label} ({items.length})</div>
      {items.map(t=>(
        <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:5}}>
          <input type="checkbox" checked={!!(t.concluida||t.concluido)} onChange={()=>toggle(t)} style={{accentColor:C.accent}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:12,textDecoration:(t.concluida||t.concluido)?"line-through":"none"}}>{t.descricao}</div>
            <div style={{fontSize:10,fontFamily:FM,color:C.muted,marginTop:2}}>{t.nome} · {t.tipo==="followup"?"Lead":"Cliente"}</div>
          </div>
          {t.prazo&&<Tag color={(t.concluida||t.concluido)?C.muted:t.prazo<hj?C.danger:color}>{fmtDate(t.prazo)}</Tag>}
          {t.tipo==="tarefa"&&<button onClick={()=>onDelTarefa(t.id)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:12}}>✕</button>}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <h2 style={{fontFamily:FD,fontSize:20,color:C.accentLight,marginBottom:18}}>Agenda Geral</h2>
      {all.length===0&&<p style={{color:C.muted}}>Nenhuma tarefa ou follow-up cadastrado.</p>}
      {renderGroup("Vencidas",venc,C.danger)}
      {renderGroup("Hoje",hoje_,C.accent)}
      {renderGroup("Próximas",fut,C.info)}
      {renderGroup("Concluídas",conc,C.muted)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
function Login({ onOk }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [load, setLoad] = useState(false);
  const entrar = async (e) => {
    e.preventDefault(); setErro(""); setLoad(true);
    try {
      const r = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ senha }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.token) throw new Error(j.error || "Não foi possível entrar");
      gravarToken(j.token); onOk();
    } catch (er) { setErro(er.message); }
    setLoad(false);
  };
  return (
    <div style={{...S.app, alignItems:"center", justifyContent:"center", padding:16}}>
      <form onSubmit={entrar} style={{...S.card, width:"100%", maxWidth:360, textAlign:"center"}}>
        <div style={S.logo}>Yalley Vasconcelos</div>
        <div style={{...S.logoSub, marginBottom:20}}>CRM Previdenciário · OAB/AP 3262</div>
        <label style={{...S.lbl, textAlign:"left"}}>Senha de acesso</label>
        <input type="password" autoFocus autoComplete="current-password" style={S.inp} value={senha} onChange={e=>setSenha(e.target.value)}/>
        {erro && <div style={{color:C.danger, fontSize:12, marginTop:8, fontFamily:FM}}>⚠ {erro}</div>}
        <button type="submit" disabled={load||!senha} style={{...S.btn("primary"), width:"100%", marginTop:14}}>{load?"Entrando...":"Entrar"}</button>
        <div style={{fontSize:10, color:C.muted, marginTop:12}}>Acesso restrito ao escritório. A sessão vale por 30 dias neste aparelho.</div>
      </form>
    </div>
  );
}

export default function Raiz() {
  const [logado, setLogado] = useState(!!lerToken());
  useEffect(() => { const f = () => setLogado(false); window.addEventListener("crm-logout", f); return () => window.removeEventListener("crm-logout", f); }, []);
  return logado ? <App/> : <Login onOk={()=>setLogado(true)}/>;
}

function App() {
  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [tarefas, setTarefas] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [mensagens, setMensagens] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [view, setView] = useState("dashboard");
  const [preset, setPreset] = useState({ v:0, f:{} });
  const irPara = (v, f={}) => { setPreset(p=>({ v:p.v+1, f })); setSelectedClient(null); setView(v); window.scrollTo(0,0); };
  const [selectedClient, setSelectedClient] = useState(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  const [syncStatus, setSyncStatus] = useState("syncing");
  const [lastSync, setLastSync] = useState("");
  const [loading, setLoading] = useState(true);
  const syncTimer = useRef(null);

  // Merge: mantém registros locais que ainda não chegaram ao Sheets
  const mergeWithLocal = useCallback((remotoBruto, local) => {
    const exc = excluidos.get();
    const remoto = remotoBruto.filter(x => ![...exc].some(k => k.endsWith(":"+String(x.id))));
    const idsRemoto = new Set(remoto.map(x => String(x.id)));
    // Itens locais que o Sheets ainda não confirmou ficam preservados
    const apenasLocal = local.filter(x => !idsRemoto.has(String(x.id)));
    // Para itens que já existem nos dois, prevalece o Sheets (fonte da verdade)
    return [...remoto, ...apenasLocal];
  }, []);

  // Carrega dados do Sheets
  const loadData = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const d = await api.getAll();

      // Usa o setter funcional para acessar o estado atual e fazer o merge
      setClients(prev => mergeWithLocal(d.clientes || [], prev));
      setLeads(prev => mergeWithLocal(d.leads || [], prev));
      setTarefas(prev => mergeWithLocal(d.tarefas || [], prev));
      setFollowUps(prev => mergeWithLocal(d.followups || [], prev));
      setMensagens(prev => mergeWithLocal(d.mensagens || [], prev));
      if (d.timeline) setTimeline(prev => mergeWithLocal(d.timeline, prev));

      setSyncStatus("ok");
      setLastSync(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));

      // Processa fila offline: reenvia tudo que ficou pendente
      const queue = offlineQueue.get();
      if (queue.length > 0) {
        for (const op of queue) {
          try {
            if (op.op === "del") { await api.del(op.entity, op.id); excluidos.del(`${op.entity}:${op.id}`); }
            else await api.upsert(op.entity, op.data);
          } catch {}
        }
        offlineQueue.clear();
      }
    } catch {
      setSyncStatus("error");
    } finally {
      setLoading(false);
    }
  }, [mergeWithLocal]);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap";
    document.head.appendChild(link);
    loadData();
    syncTimer.current = setInterval(loadData, SYNC_INTERVAL);
    return () => clearInterval(syncTimer.current);
  }, [loadData]);

  // Operações CRUD com retry e fallback offline
  const persist = async (entity, data, setFn) => {
    // 1. Atualiza estado local imediatamente (optimistic update)
    setFn(prev => {
      const exists = prev.find(x => String(x.id) === String(data.id));
      return exists ? prev.map(x => String(x.id) === String(data.id) ? data : x) : [...prev, data];
    });

    // 2. Tenta enviar ao Sheets com 1 retry automático
    let tentativas = 0;
    while (tentativas < 2) {
      try {
        await api.upsert(entity, data);
        setSyncStatus("ok");
        return; // sucesso, sai do loop
      } catch {
        tentativas++;
        if (tentativas < 2) {
          // Aguarda 2s antes de tentar de novo
          await new Promise(res => setTimeout(res, 2000));
        }
      }
    }

    // 3. Após 2 tentativas falhas, coloca na fila offline
    offlineQueue.add({ entity, data });
    setSyncStatus("offline");
  };

  const remove = async (entity, id, setFn) => {
    const k = `${entity}:${id}`;
    excluidos.add(k);
    setFn(prev => prev.filter(x => String(x.id) !== String(id)));
    for (let t = 0; t < 2; t++) {
      try { await api.del(entity, id); excluidos.del(k); return true; }
      catch { if (t === 0) await new Promise(r => setTimeout(r, 1500)); }
    }
    offlineQueue.add({ op:"del", entity, id });
    setSyncStatus("offline");
    return false;
  };
  const delCliente = async (c) => {
    const id = String(c.id);
    await Promise.all([
      ...tarefas.filter(t => String(t.clienteId) === id).map(t => remove("Tarefa", t.id, setTarefas)),
      ...timeline.filter(e => String(e.clienteId) === id).map(e => remove("Timeline", e.id, setTimeline)),
    ]);
    const ok = await remove("Cliente", c.id, setClients);
    setSelectedClient(null);
    return ok;
  };

  const saveCliente = (c) => persist("Cliente", c, setClients);
  const saveLead = (l) => persist("Lead", l, setLeads);
  const saveTarefa = (t) => persist("Tarefa", t, setTarefas);
  const delTarefa = (id) => remove("Tarefa", id, setTarefas);
  const saveFollowUp = (f) => persist("Followup", f, setFollowUps);
  const delFollowUp = (id) => remove("Followup", id, setFollowUps);
  const saveMensagem = (m) => persist("Mensagem", m, setMensagens);
  const saveTimeline = (e) => persist("Timeline", e, setTimeline);
  const delTimeline = (id) => remove("Timeline", id, setTimeline);

  const addClient = async (c) => {
    await saveCliente(c);
    setShowNewClient(false);
    setSelectedClient(c);
    setView("clientes");
  };

  const addLead = async (l) => {
    await saveLead(l);
    setShowNewLead(false);
  };

  const convertLead = async (lead) => {
    const c = {
      id: uid(), nome:lead.nome, cpf:"", rg:"", dataNascimento:"", telefone:lead.telefone,
      email:"", profissao:"", nacionalidade:"brasileiro(a)", estadoCivil:"", cep:"", endereco:"",
      beneficio:lead.beneficioInteresse, status:"Novo cliente", valorHonorarios:"",
      parcelamentoTotal:1, parcelamentoPagas:0, parcelamentoValor:"",
      dataCadastro:hoje(), observacoes:`Convertido de lead em ${hoje()}. ${lead.observacoes||""}`,
      numeroBeneficio:"",
    };
    await saveLead({...lead, status:"Convertido"});
    await saveCliente(c);
    setSelectedClient(c);
    setView("clientes");
  };

  const navItems = [
    { key:"dashboard", label:"Painel" },
    { key:"leads",     label:"Leads" },
    { key:"clientes",  label:"Clientes" },
    { key:"agenda",    label:"Agenda" },
    { key:"recebimentos", label:"Recebimentos" },
  ];

  const leadsQ = leads.filter(l=>l.temperatura==="🔥 Quente"&&!["Convertido","Perdido"].includes(l.status)).length;
  const pendAgenda = tarefas.filter(t=>!t.concluida&&t.prazo<hoje()).length + followUps.filter(f=>!f.concluido&&f.prazo<hoje()).length;

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div>
          <div style={S.logo}>Yalley Vasconcelos</div>
          <div style={S.logoSub}>CRM Previdenciário · OAB/AP 3262</div>
        </div>
        <nav style={S.nav}>
          {navItems.map(n=>(
            <button key={n.key} style={S.navBtn(view===n.key&&!selectedClient)} onClick={()=>irPara(n.key)}>
              {n.label}
              {n.key==="leads"&&leadsQ>0?` 🔥${leadsQ}`:""}
              {n.key==="agenda"&&pendAgenda>0?` (${pendAgenda})`:""}
            </button>
          ))}
        </nav>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <SyncBar status={syncStatus} lastSync={lastSync} onSync={loadData}/>
          <button onClick={sair} title="Sair do CRM neste aparelho" style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,cursor:"pointer",fontSize:11,padding:"4px 10px",fontFamily:FB}}>Sair</button>
        </div>
      </header>

      <main style={S.main}>
        {loading ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:300}}>
            <Spin text="Carregando dados do Google Sheets..."/>
          </div>
        ) : selectedClient ? (
          <ClienteDetalhe
            cliente={selectedClient}
            tarefas={tarefas}
            mensagens={mensagens}
            timeline={timeline}
            onBack={()=>setSelectedClient(null)}
            onSave={async(c)=>{await saveCliente(c);setSelectedClient(c);}}
            onSaveTarefa={saveTarefa}
            onDelTarefa={delTarefa}
            onSaveMensagem={saveMensagem}
            onAddTimeline={saveTimeline}
            onDelTimeline={delTimeline}
            onDelete={delCliente}
          />
        ) : view==="dashboard" ? (
          <Dashboard clients={clients} leads={leads} tarefas={tarefas}
            onSelectClient={c=>{setSelectedClient(c);}}
            onNewClient={()=>setShowNewClient(true)}
            onNewLead={()=>{setView("leads");setShowNewLead(true);}}
            onIr={irPara}
          />
        ) : view==="leads" ? (
          <LeadsList key={"l"+preset.v} preset={preset.f} leads={leads} followUps={followUps}
            onNew={()=>setShowNewLead(true)}
            onSaveLead={saveLead}
            onSaveFollowUp={saveFollowUp}
            onDelFollowUp={delFollowUp}
            onConvert={convertLead}
          />
        ) : view==="clientes" ? (
          <ClientesList key={"c"+preset.v} preset={preset.f} clients={clients} tarefas={tarefas} onSelect={c=>setSelectedClient(c)} onNew={()=>setShowNewClient(true)}/>
        ) : view==="recebimentos" ? (
          <Recebimentos key={"r"+preset.v} preset={preset.f} clients={clients} onSelect={c=>setSelectedClient(c)}/>
        ) : view==="agenda" ? (
          <AgendaGlobal clients={clients} leads={leads} tarefas={tarefas} followUps={followUps}
            onSaveTarefa={saveTarefa} onDelTarefa={delTarefa} onSaveFollowUp={saveFollowUp}
          />
        ) : null}
      </main>

      {showNewClient&&<NovoCliente onSave={addClient} onCancel={()=>setShowNewClient(false)}/>}
      {showNewLead&&<NovoLead onSave={addLead} onCancel={()=>setShowNewLead(false)}/>}
    </div>
  );
}
