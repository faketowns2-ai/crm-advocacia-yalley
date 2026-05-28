import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3VGOv4dSFIayqIFzcEYm-2f52KFsV-KYKsyIZHu8eibgXnZLomdhqy4_wwRNbOKEFDQ/exec";
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
const STATUS_CLI = ["Novo cliente","Documentação pendente","Aguardando perícia","Em análise INSS","Recurso em andamento","Benefício concedido","Encerrado"];
const BENEFICIOS = ["Aposentadoria por Invalidez","Aposentadoria por Tempo de Contribuição","Aposentadoria por Idade","Benefício de Prestação Continuada (BPC/LOAS)","Auxílio-Doença","Auxílio-Acidente","Pensão por Morte","Salário-Maternidade","Revisão de Benefício"];
const TEMP_OPTS = ["🔥 Quente","🟡 Morno","❄️ Frio"];
const ORIGEM_OPTS = ["Instagram","WhatsApp","Indicação","Facebook","Google","Presencial","Outro"];
const STATUS_LEAD = ["Novo contato","Em negociação","Proposta enviada","Aguardando retorno","Convertido","Perdido"];
const ESTADO_CIVIL = ["Solteiro(a)","Casado(a)","Divorciado(a)","Viúvo(a)","União estável","Separado(a)"];
const NACIONALIDADES = ["brasileiro(a)","brasileira naturalizada","estrangeiro(a)"];
const TIMELINE_TIPOS = ["Protocolo INSS","Perícia agendada","Perícia realizada","Exigência cumprida","Recurso interposto","Decisão administrativa","Ação judicial ajuizada","Sentença","Benefício concedido","Benefício indeferido","Outro"];

const statusColor = { "Novo cliente":C.info,"Documentação pendente":C.warn,"Aguardando perícia":C.purple,"Em análise INSS":C.accent,"Recurso em andamento":C.danger,"Benefício concedido":C.success,"Encerrado":C.muted };
const tempColor = { "🔥 Quente":C.danger,"🟡 Morno":C.warn,"❄️ Frio":C.info };
const leadStatusColor = { "Novo contato":C.info,"Em negociação":C.accent,"Proposta enviada":C.purple,"Aguardando retorno":C.warn,"Convertido":C.success,"Perdido":C.muted };

// ─── GOOGLE SHEETS API ────────────────────────────────────────────────────────
const api = {
  async getAll() {
    const r = await fetch(`${SCRIPT_URL}?action=getAll`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
  async upsert(entity, data) {
    const r = await fetch(`${SCRIPT_URL}?action=upsert${cap(entity)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
  async del(entity, id) {
    const r = await fetch(`${SCRIPT_URL}?action=delete${cap(entity)}&id=${id}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  },
};

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── FILA OFFLINE ─────────────────────────────────────────────────────────────
const offlineQueue = {
  key: "crm_offline_queue",
  get() { try { return JSON.parse(localStorage.getItem(this.key) || "[]"); } catch { return []; } },
  add(op) { const q = this.get(); q.push(op); localStorage.setItem(this.key, JSON.stringify(q)); },
  clear() { localStorage.setItem(this.key, "[]"); },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function uid() { return Date.now() + Math.random().toString(36).slice(2, 7); }
function fmtDate(iso) { if (!iso) return ""; const [y,m,d] = String(iso).split("-"); return `${d}/${m}/${y}`; }
function fmtCur(v) { return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0); }
function calcIdade(n) { if (!n) return ""; const h=new Date(),d=new Date(n); let a=h.getFullYear()-d.getFullYear(); if(h.getMonth()-d.getMonth()<0||(h.getMonth()===d.getMonth()&&h.getDate()<d.getDate()))a--; return a; }
function hoje() { return new Date().toISOString().split("T")[0]; }

// ─── DOCUMENTOS ───────────────────────────────────────────────────────────────
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

  if (tipo === "contrato") return `CONTRATO DE HONORÁRIOS ADVOCATÍCIOS\n\nContrato de Prestação de Serviços Advocatícios que fazem entre si, de um lado, ${nm}, ${nac}, ${ec}, ${prof}, inscrito(a) no CPF sob o n° ${cpf}, residente e domiciliado(a) na ${end}, doravante denominado(a) CONTRATANTE; e, de outro lado, YALLEY DA SILVA VASCONCELOS, Advogado, inscrito na OAB/AP n° 3262, com escritório profissional à Rua Tiradentes, n° 624 (altos), Bairro Centro, Macapá/AP - CEP 68900-098, doravante denominado CONTRATADO, ajustam o presente contrato mediante as cláusulas e condições seguintes.\n\nCLÁUSULA 1ª - DO OBJETO\n\nO presente contrato tem por objeto a prestação de serviços advocatícios consistentes na representação administrativa e/ou judicial perante o INSS e demais órgãos competentes, visando ao requerimento, concessão, restabelecimento ou conversão de ${ben}, inclusive com análise de documentos, elaboração de requerimentos, acompanhamento processual e adoção das medidas necessárias à efetivação do direito.\n\nParágrafo único. A interposição de recursos administrativos, ações judiciais autônomas, cumprimento de sentença, execução de valores atrasados ou quaisquer medidas não expressamente previstas dependerão de novo contrato específico.\n\nCLÁUSULA 2ª - DA REMUNERAÇÃO\n\nOs honorários advocatícios correspondem ao valor de ${hon}, a serem pagos em ${parc}x de ${vp}, observando-se a Tabela de Honorários da OAB/AP.\n\n§1°. O(A) CONTRATANTE pagará ao CONTRATADO o percentual de 30% (trinta por cento) sobre os valores retroativos recebidos, seja na via administrativa ou judicial.\n\n§2°. Os valores poderão ser quitados à vista ou mediante desconto direto dos valores retroativos, mediante autorização expressa.\n\n§3°. Eventuais despesas com certidões, cópias, perícias e custas judiciais correrão por conta do(a) CONTRATANTE, mediante apresentação de comprovantes.\n\n§4°. Caso necessária a propositura de ação judicial, os honorários ora pactuados abrangem também essa fase.\n\nCLÁUSULA 3ª - DO PAGAMENTO\n\nOs honorários somente serão devidos em caso de êxito total ou parcial.\n\n§1° - O pagamento deverá ocorrer no prazo máximo de 2 (dois) dias úteis após o crédito do benefício ou dos retroativos.\n\n§2° - O atraso no pagamento ensejará multa de 10% (dez por cento) e juros de mora de 1% (um por cento) ao mês.\n\n§3° - O(A) CONTRATANTE autoriza o CONTRATADO a reter diretamente os honorários no momento do levantamento dos valores.\n\nCLÁUSULA 4ª - DA DURAÇÃO E RESCISÃO\n\nO presente contrato vigorará até a conclusão definitiva do processo administrativo ou judicial.\n\n§1° - A rescisão imotivada pelo(a) CONTRATANTE implicará o pagamento integral dos honorários, nos termos do art. 22, §3°, da Lei n° 8.906/94.\n\n§2° - O não fornecimento de documentos e informações necessárias constitui descumprimento contratual, autorizando a rescisão imediata.\n\nCLÁUSULA 5ª - DO SIGILO E PROTEÇÃO DE DADOS\n\nO(A) CONTRATANTE autoriza o uso de seus dados pessoais e credenciais GOV.BR, exclusivamente para execução dos serviços contratados, conforme a Lei n° 13.709/2018 (LGPD).\n\nCLÁUSULA 6ª - DO FORO\n\nFica eleito o foro da Comarca de Macapá/AP para dirimir eventuais controvérsias.\n\nMacapá/AP, ${dt}.\n\n\n_________________________________________\n${nm}\nCONTRATANTE\n\n\n_________________________________________\nYALLEY DA SILVA VASCONCELOS\nOAB/AP n° 3262`;

  if (tipo === "hiposuficiencia") return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA ECONÔMICA\n\nEu, ${nm}, ${nac}, ${ec}, ${prof}, inscrito(a) no CPF sob o n° ${cpf}, residente e domiciliado(a) na ${end}.\n\nDECLARO, para os devidos fins de direito, especialmente para instruir pedido de concessão dos benefícios da Justiça Gratuita, nos termos do artigo 98 do Código de Processo Civil e artigo 5°, inciso LXXIV, da Constituição Federal, que não possuo condições financeiras de arcar com as custas processuais, despesas judiciais e honorários advocatícios sem prejuízo do meu próprio sustento e de minha família.\n\nDeclaro ainda que as informações acima são verdadeiras, estando ciente de que a falsidade desta declaração poderá implicar nas sanções civis, penais e processuais cabíveis.\n\nTermos em que,\nPede deferimento.\n\nMacapá/AP, ${dt}.\n\n\n_________________________________________\n${nm}\nDECLARANTE`;

  if (tipo === "procuracao") return `PROCURAÇÃO\n\nOUTORGANTE: ${nm}, ${nac}, ${ec}, ${prof}, inscrito(a) no CPF sob o n° ${cpf}, residente e domiciliado(a) na ${end}.\n\nOUTORGADO: YALLEY DA SILVA VASCONCELOS, advogado, inscrito na OAB/AP n° 3262, com endereço profissional à Rua Tiradentes, n° 624 (altos), Bairro Centro, Macapá/AP - CEP 68900-098.\n\n\nA OUTORGANTE nomeia e constitui como seu bastante procurador o OUTORGADO, conferindo-lhe amplos, gerais e ilimitados poderes para representá-la ad judicia et ad extra, em todo o território nacional, POR PRAZO INDETERMINADO, em qualquer instância, juízo, tribunal ou órgão público ou privado, inclusive em processos físicos ou eletrônicos, podendo propor ações, acompanhar processos, apresentar defesa, confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar a direitos, firmar compromissos, celebrar acordos, recorrer, firmar declarações, requerer, acompanhar e revisar benefícios previdenciários e assistenciais, solicitar perícias médicas, administrativas ou judiciais, praticar atos perante o INSS e demais órgãos públicos ou privados, receber valores, levantar alvarás, dar quitação, realizar peticionamento eletrônico, atuar em sistemas judiciais e administrativos, receber citações e intimações eletrônicas, utilizar certificação digital, acessar, tratar e compartilhar dados pessoais e dados sensíveis, nos limites da finalidade deste mandato, ratificando desde já todos os atos anteriormente praticados relacionados ao presente mandato, podendo, ainda, substabelecer, no todo ou em parte, com ou sem reserva de poderes.\n\nA presente procuração referente ao processo de ${ben} é firmada por meio de assinatura eletrônica, nos termos da MP n° 2.200-2/2001 e da Lei n° 14.063/2020, sendo plenamente válida para todos os fins legais.\n\n\nMacapá/AP, ${dt}.\n\n\n_________________________________________\n${nm}\nOUTORGANTE`;

  return "Tipo não reconhecido.";
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
async function extrairDados(base64, mediaType) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{ role:"user", content:[
      { type: mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64} },
      { type:"text", text:`Extraia os dados deste documento e retorne APENAS JSON válido sem markdown:\n{"nome":"","cpf":"","rg":"","dataNascimento":"AAAA-MM-DD","endereco":"","nacionalidade":"","estadoCivil":"","profissao":"","cep":"","tipo_documento":""}` }
    ]}] })
  });
  const d = await r.json();
  try { return JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim()); } catch { return {}; }
}

// ─── MENSAGEM IA ──────────────────────────────────────────────────────────────
async function gerarMsgIA(cliente, tipo) {
  const map = { protocolo:"informar que o processo foi protocolado no INSS", pericia:"informar que a perícia médica foi agendada e orientar sobre o que levar", resultado:"informar que houve movimentação no processo", aprovado:"parabenizar pelo deferimento do benefício", recurso:"informar que foi necessário interpor recurso e explicar os próximos passos" };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:300, messages:[{ role:"user", content:`Mensagem curta profissional para WhatsApp para ${map[tipo]} ao cliente ${cliente.nome.split(" ")[0]}, processo de ${cliente.beneficio}. Tom acolhedor, máximo 5 linhas. Assine "Yalley Vasconcelos, Advogado". Sem travessão.` }] })
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
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
function DocUpload({ onExtracted }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const ref = useRef();
  const handle = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLoading(true); setResult(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target.result.split(",")[1];
      const d = await extrairDados(b64, file.type||"image/jpeg");
      setResult(d); onExtracted(d); setLoading(false);
    };
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <div onClick={()=>ref.current.click()} style={{border:`2px dashed ${C.border}`,borderRadius:10,padding:"22px 16px",textAlign:"center",cursor:"pointer"}}>
        <div style={{fontSize:24,marginBottom:6}}>📄</div>
        <div style={{color:C.muted,fontSize:13,marginBottom:3}}>Enviar RG, CPF, CNH ou comprovante de residência</div>
        <div style={{color:C.muted,fontSize:10,fontFamily:FM}}>JPG, PNG, PDF</div>
        <input ref={ref} type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={handle}/>
      </div>
      {loading && <Spin text="Extraindo dados..."/>}
      {result && !loading && (
        <div style={{marginTop:10,background:C.surface,borderRadius:8,padding:12}}>
          <div style={{color:C.success,fontFamily:FM,fontSize:11,marginBottom:8}}>Dados extraídos automaticamente:</div>
          {Object.entries(result).filter(([k,v])=>v&&k!=="tipo_documento").map(([k,v])=>(
            <div key={k} style={{display:"flex",gap:8,marginBottom:4,fontSize:12}}>
              <span style={{color:C.muted,fontFamily:FM,minWidth:130}}>{k}:</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}
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
function Parcelas({ cliente, onChange }) {
  const total = Number(cliente.parcelamentoTotal)||1;
  const pagas = Number(cliente.parcelamentoPagas)||0;
  const vp = Number(cliente.parcelamentoValor)||0;
  const pct = (pagas/total)*100;
  const vencidas = [];
  for (let i=0;i<total;i++) {
    const dataVenc = cliente[`parcela_${i}_venc`] || "";
    const atrasada = dataVenc && dataVenc < hoje() && i >= pagas;
    vencidas.push({ n:i+1, venc:dataVenc, paga: i<pagas, atrasada });
  }
  return (
    <div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        <div style={{flex:"1 1 130px"}}>
          <label style={S.lbl}>Honorários (R$)</label>
          <input style={S.inp} type="number" value={cliente.valorHonorarios||""} onChange={e=>onChange({...cliente,valorHonorarios:e.target.value,parcelamentoValor:(Number(e.target.value)/(Number(cliente.parcelamentoTotal)||1)).toFixed(2)})}/>
        </div>
        <div style={{flex:"1 1 100px"}}>
          <label style={S.lbl}>Parcelas</label>
          <input style={S.inp} type="number" min={1} value={total} onChange={e=>onChange({...cliente,parcelamentoTotal:Number(e.target.value),parcelamentoValor:(Number(cliente.valorHonorarios)/Number(e.target.value)).toFixed(2)})}/>
        </div>
        <div style={{flex:"1 1 100px"}}>
          <label style={S.lbl}>Pagas</label>
          <input style={S.inp} type="number" min={0} max={total} value={pagas} onChange={e=>onChange({...cliente,parcelamentoPagas:Number(e.target.value)})}/>
        </div>
        <div style={{flex:"1 1 100px"}}>
          <label style={S.lbl}>Valor/Parcela</label>
          <input style={S.inp} type="number" value={vp} onChange={e=>onChange({...cliente,parcelamentoValor:e.target.value})}/>
        </div>
      </div>
      <Prog pct={pct} color={pct===100?C.success:C.accent}/>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontFamily:FM,marginTop:5,color:C.muted}}>
        <span style={{color:C.success}}>Recebido: {fmtCur(pagas*vp)}</span>
        <span style={{color:C.danger}}>A receber: {fmtCur((total-pagas)*vp)}</span>
      </div>
      {total>1 && (
        <div style={{marginTop:12}}>
          <label style={S.lbl}>Datas de Vencimento</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>
            {vencidas.map(p=>(
              <div key={p.n} style={{background:p.paga?C.success+"22":p.atrasada?C.danger+"22":C.surface,border:`1px solid ${p.paga?C.success:p.atrasada?C.danger:C.border}`,borderRadius:7,padding:"4px 8px",display:"flex",flexDirection:"column",alignItems:"center",minWidth:70}}>
                <span style={{fontSize:10,fontFamily:FM,color:p.paga?C.success:p.atrasada?C.danger:C.muted}}>{p.paga?"✓ Paga":p.atrasada?"Atrasada":`${p.n}ª`}</span>
                <input type="date" value={cliente[`parcela_${p.n-1}_venc`]||""} onChange={e=>onChange({...cliente,[`parcela_${p.n-1}_venc`]:e.target.value})} style={{border:"none",background:"transparent",color:C.text,fontSize:10,fontFamily:FM,width:95,marginTop:2}}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function Dashboard({ clients, leads, tarefas, onSelectClient, onNewClient, onNewLead }) {
  const total = clients.length;
  const ativos = clients.filter(c=>!["Encerrado","Benefício concedido"].includes(c.status)).length;
  const concedidos = clients.filter(c=>c.status==="Benefício concedido").length;
  const recTotal = clients.reduce((s,c)=>s+(Number(c.valorHonorarios)||0),0);
  const recebido = clients.reduce((s,c)=>s+((Number(c.parcelamentoPagas)||0)*(Number(c.parcelamentoValor)||0)),0);
  const lAtivos = leads.filter(l=>l.status!=="Convertido"&&l.status!=="Perdido").length;
  const lQuentes = leads.filter(l=>l.temperatura==="🔥 Quente"&&l.status!=="Convertido"&&l.status!=="Perdido").length;
  const pendentes = tarefas.filter(t=>!t.concluida&&t.prazo<hoje()).length;
  const recentes = [...clients].sort((a,b)=>b.dataCadastro>a.dataCadastro?1:-1).slice(0,5);
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

      <div style={S.grid3}>
        {[
          {val:total,label:"Clientes",color:C.info},
          {val:ativos,label:"Processos Ativos",color:C.accent},
          {val:concedidos,label:"Concedidos",color:C.success},
          {val:lAtivos,label:"Leads Ativos",color:C.warn},
          {val:lQuentes,label:"Leads Quentes 🔥",color:C.danger},
          {val:pendentes,label:"Tarefas Vencidas",color:pendentes>0?C.danger:C.success},
          {val:fmtCur(recTotal),label:"Honorários Totais",color:C.purple},
          {val:fmtCur(recebido),label:"Receita Recebida",color:C.success},
          {val:fmtCur(recTotal-recebido),label:"A Receber",color:C.danger},
        ].map((s,i)=>(
          <div key={i} style={S.stat}>
            <span style={{...S.statVal,color:s.color,fontSize:typeof s.val==="string"?18:26}}>{s.val}</span>
            <span style={S.statLbl}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:16}}>
        <div style={S.card}>
          <div style={S.cardTitle}>Tarefas Urgentes</div>
          {tarefasUrgentes.length===0&&<p style={{color:C.muted,fontSize:12}}>Sem tarefas pendentes.</p>}
          {tarefasUrgentes.map((t,i)=>{
            const cli = clients.find(c=>c.id===t.clienteId||String(c.id)===String(t.clienteId));
            return (
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
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
          <div style={S.cardTitle}>Clientes Recentes</div>
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
              <div key={s} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 12px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
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
function ClientesList({ clients, tarefas, onSelect, onNew }) {
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fBen, setFBen] = useState("");

  const filtered = clients.filter(c=>{
    const q=search.toLowerCase();
    return (!q||c.nome?.toLowerCase().includes(q)||String(c.cpf).includes(q)||String(c.telefone).includes(q)||String(c.numeroBeneficio||"").includes(q))
      &&(!fStatus||c.status===fStatus)&&(!fBen||c.beneficio===fBen);
  });

  const exportCSV = () => {
    const header = ["Nome","CPF","Telefone","Benefício","Status","Honorários","Cadastro"].join(";");
    const rows = filtered.map(c=>[c.nome,c.cpf,c.telefone,c.beneficio,c.status,c.valorHonorarios,c.dataCadastro].join(";"));
    const blob = new Blob([[header,...rows].join("\n")],{type:"text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="clientes.csv"; a.click();
  };

  return (
    <div>
      <div style={{marginBottom:16,display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"1 1 180px"}}><label style={S.lbl}>Buscar</label><input style={S.inp} placeholder="Nome, CPF, telefone, NB..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div style={{flex:"1 1 150px"}}><label style={S.lbl}>Status</label><select style={S.sel} value={fStatus} onChange={e=>setFStatus(e.target.value)}><option value="">Todos</option>{STATUS_CLI.map(s=><option key={s}>{s}</option>)}</select></div>
        <div style={{flex:"1 1 180px"}}><label style={S.lbl}>Benefício</label><select style={S.sel} value={fBen} onChange={e=>setFBen(e.target.value)}><option value="">Todos</option>{BENEFICIOS.map(b=><option key={b}>{b}</option>)}</select></div>
        <button style={S.btn("ghost")} onClick={exportCSV}>↓ CSV</button>
        <button style={S.btn("primary")} onClick={onNew}>+ Novo Cliente</button>
      </div>
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
function ClienteDetalhe({ cliente, tarefas, mensagens, timeline, onBack, onSave, onSaveTarefa, onDelTarefa, onSaveMensagem, onAddTimeline, onDelTimeline }) {
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

  const gerarDoc = () => setDocText(gerarDoc_(docTipo, form));
  function gerarDoc_(t, c) { return gerarDoc(t, c); }

  const gerarMsg = async () => { setMsgLoading(true); const t=await gerarMsgIA(form,msgTipo); setMsgText(t); setMsgLoading(false); };

  const wpp = (t) => { const n=form.telefone.replace(/\D/g,""); window.open(`https://wa.me/55${n}?text=${encodeURIComponent(t)}`,"_blank"); };

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
      </div>

      <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {tabs.map(t=><button key={t.k} style={{...S.navBtn(tab===t.k),borderRadius:7}} onClick={()=>setTab(t.k)}>{t.l}</button>)}
      </div>

      {tab==="dados" && (
        <div style={S.card}>
          <div style={S.cardTitle}>Dados Pessoais</div>
          <div style={{marginBottom:16}}>
            <DocUpload onExtracted={d=>setForm(p=>({...p,...d}))}/>
          </div>
          <div style={S.grid2}>
            <F label="Nome Completo"><input style={S.inp} value={form.nome||""} onChange={e=>setForm({...form,nome:e.target.value})}/></F>
            <F label="CPF"><input style={S.inp} value={form.cpf||""} onChange={e=>setForm({...form,cpf:e.target.value})}/></F>
            <F label="RG"><input style={S.inp} value={form.rg||""} onChange={e=>setForm({...form,rg:e.target.value})}/></F>
            <F label="Data de Nascimento">
              <input style={S.inp} type="date" value={form.dataNascimento||""} onChange={e=>setForm({...form,dataNascimento:e.target.value})}/>
              {form.dataNascimento&&<div style={{fontSize:10,color:C.muted,marginTop:3,fontFamily:FM}}>{calcIdade(form.dataNascimento)} anos</div>}
            </F>
            <F label="Nacionalidade"><select style={S.sel} value={form.nacionalidade||""} onChange={e=>setForm({...form,nacionalidade:e.target.value})}><option value="">Selecionar</option>{NACIONALIDADES.map(n=><option key={n}>{n}</option>)}</select></F>
            <F label="Estado Civil"><select style={S.sel} value={form.estadoCivil||""} onChange={e=>setForm({...form,estadoCivil:e.target.value})}><option value="">Selecionar</option>{ESTADO_CIVIL.map(n=><option key={n}>{n}</option>)}</select></F>
            <F label="Profissão"><input style={S.inp} value={form.profissao||""} onChange={e=>setForm({...form,profissao:e.target.value})}/></F>
            <F label="Telefone"><input style={S.inp} value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})}/></F>
            <F label="E-mail"><input style={S.inp} value={form.email||""} onChange={e=>setForm({...form,email:e.target.value})}/></F>
            <F label="Número do Benefício/NB"><input style={S.inp} value={form.numeroBeneficio||""} onChange={e=>setForm({...form,numeroBeneficio:e.target.value})} placeholder="NB ou nº do processo"/></F>
            <F label="Benefício"><select style={S.sel} value={form.beneficio||""} onChange={e=>setForm({...form,beneficio:e.target.value})}>{BENEFICIOS.map(b=><option key={b}>{b}</option>)}</select></F>
            <F label="Status"><select style={S.sel} value={form.status||""} onChange={e=>setForm({...form,status:e.target.value})}>{STATUS_CLI.map(s=><option key={s}>{s}</option>)}</select></F>
          </div>
          <F label="CEP"><CepInput value={form.cep||""} onChange={v=>setForm({...form,cep:v})} onEnderecoFound={e=>setForm(p=>({...p,endereco:e}))}/></F>
          <F label="Endereço Completo"><input style={S.inp} value={form.endereco||""} onChange={e=>setForm({...form,endereco:e.target.value})}/></F>
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
                  <option value="protocolo">Processo Protocolado</option>
                  <option value="pericia">Perícia Agendada</option>
                  <option value="resultado">Movimentação Processual</option>
                  <option value="aprovado">Benefício Concedido</option>
                  <option value="recurso">Recurso Interposto</option>
                </select>
              </div>
              <div style={{display:"flex",alignItems:"flex-end"}}><button style={S.btn("info")} onClick={gerarMsg} disabled={msgLoading}>{msgLoading?"Gerando...":"Gerar"}</button></div>
            </div>
            {msgLoading&&<Spin text="Redigindo mensagem..."/>}
            {msgText&&(
              <div>
                <textarea style={{...S.textarea,minHeight:120}} value={msgText} onChange={e=>setMsgText(e.target.value)}/>
                <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
                  <button style={S.btn("ghost")} onClick={()=>navigator.clipboard.writeText(msgText)}>Copiar</button>
                  <button style={S.btn("success")} onClick={()=>wpp(msgText)}>WhatsApp</button>
                </div>
              </div>
            )}
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Histórico de Comunicações</div>
            <div style={{marginBottom:12}}>
              <textarea style={{...S.textarea,minHeight:70}} value={novaMensagem} onChange={e=>setNovaMensagem(e.target.value)} placeholder="Registrar comunicação..."/>
              <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
                <button style={S.btn("ghost")} onClick={()=>wpp(novaMensagem)}>WhatsApp</button>
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
        <div style={{marginBottom:14}}><DocUpload onExtracted={d=>setForm(p=>({...p,...d}))}/></div>
        <div style={S.grid2}>
          <F label="Nome *"><input style={S.inp} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/></F>
          <F label="CPF *"><input style={S.inp} value={form.cpf} onChange={e=>setForm({...form,cpf:e.target.value})} placeholder="000.000.000-00"/></F>
          <F label="RG"><input style={S.inp} value={form.rg} onChange={e=>setForm({...form,rg:e.target.value})}/></F>
          <F label="Nascimento"><input style={S.inp} type="date" value={form.dataNascimento} onChange={e=>setForm({...form,dataNascimento:e.target.value})}/></F>
          <F label="Nacionalidade"><select style={S.sel} value={form.nacionalidade} onChange={e=>setForm({...form,nacionalidade:e.target.value})}>{NACIONALIDADES.map(n=><option key={n}>{n}</option>)}</select></F>
          <F label="Estado Civil"><select style={S.sel} value={form.estadoCivil} onChange={e=>setForm({...form,estadoCivil:e.target.value})}><option value="">Selecionar</option>{ESTADO_CIVIL.map(n=><option key={n}>{n}</option>)}</select></F>
          <F label="Profissão"><input style={S.inp} value={form.profissao} onChange={e=>setForm({...form,profissao:e.target.value})}/></F>
          <F label="Telefone"><input style={S.inp} value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="(96) 99000-0000"/></F>
          <F label="Benefício"><select style={S.sel} value={form.beneficio} onChange={e=>setForm({...form,beneficio:e.target.value})}>{BENEFICIOS.map(b=><option key={b}>{b}</option>)}</select></F>
          <F label="Nº Benefício/NB"><input style={S.inp} value={form.numeroBeneficio} onChange={e=>setForm({...form,numeroBeneficio:e.target.value})}/></F>
          <F label="Honorários (R$)"><input style={S.inp} type="number" value={form.valorHonorarios} onChange={e=>setForm({...form,valorHonorarios:e.target.value,parcelamentoValor:(Number(e.target.value)/Number(form.parcelamentoTotal||1)).toFixed(2)})}/></F>
          <F label="Parcelas"><input style={S.inp} type="number" min={1} value={form.parcelamentoTotal} onChange={e=>setForm({...form,parcelamentoTotal:Number(e.target.value),parcelamentoValor:(Number(form.valorHonorarios)/Number(e.target.value)).toFixed(2)})}/></F>
        </div>
        <F label="CEP"><CepInput value={form.cep} onChange={v=>setForm({...form,cep:v})} onEnderecoFound={e=>setForm(p=>({...p,endereco:e}))}/></F>
        <F label="Endereço"><input style={S.inp} value={form.endereco} onChange={e=>setForm({...form,endereco:e.target.value})}/></F>
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
  const wpp = (e) => { e.stopPropagation(); const n=lead.telefone.replace(/\D/g,""); window.open(`https://wa.me/55${n}`,"_blank"); };
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
  const wpp = (t) => { const n=form.telefone.replace(/\D/g,""); window.open(`https://wa.me/55${n}?text=${encodeURIComponent(t)}`,"_blank"); };
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
            <F label="Benefício"><select style={S.sel} value={form.beneficioInteresse||""} onChange={e=>setForm({...form,beneficioInteresse:e.target.value})}>{BENEFICIOS.map(b=><option key={b}>{b}</option>)}</select></F>
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

function LeadsList({ leads, followUps, onNew, onSaveLead, onSaveFollowUp, onDelFollowUp, onConvert }) {
  const [search, setSearch] = useState("");
  const [fTemp, setFTemp] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [selected, setSelected] = useState(null);

  const filtered = leads.filter(l=>{
    const q=search.toLowerCase();
    return(!q||l.nome?.toLowerCase().includes(q)||String(l.telefone).includes(q))&&(!fTemp||l.temperatura===fTemp)&&(!fStatus||l.status===fStatus);
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
export default function App() {
  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [tarefas, setTarefas] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [mensagens, setMensagens] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [view, setView] = useState("dashboard");
  const [selectedClient, setSelectedClient] = useState(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  const [syncStatus, setSyncStatus] = useState("syncing");
  const [lastSync, setLastSync] = useState("");
  const [loading, setLoading] = useState(true);
  const syncTimer = useRef(null);

  // Carrega dados do Sheets
  const loadData = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const d = await api.getAll();
      setClients(d.clientes||[]);
      setLeads(d.leads||[]);
      setTarefas(d.tarefas||[]);
      setFollowUps(d.followups||[]);
      setMensagens(d.mensagens||[]);
      // timeline vem junto com tarefas ou como campo separado
      if (d.timeline) setTimeline(d.timeline);
      setSyncStatus("ok");
      setLastSync(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));
      // Processa fila offline
      const queue = offlineQueue.get();
      if (queue.length > 0) {
        for (const op of queue) {
          try { await api.upsert(op.entity, op.data); } catch {}
        }
        offlineQueue.clear();
      }
    } catch {
      setSyncStatus("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap";
    document.head.appendChild(link);
    loadData();
    syncTimer.current = setInterval(loadData, SYNC_INTERVAL);
    return () => clearInterval(syncTimer.current);
  }, [loadData]);

  // Operações CRUD com fallback offline
  const persist = async (entity, data, setFn) => {
    setFn(prev => {
      const exists = prev.find(x => String(x.id) === String(data.id));
      return exists ? prev.map(x => String(x.id) === String(data.id) ? data : x) : [...prev, data];
    });
    try {
      await api.upsert(entity, data);
      setSyncStatus("ok");
    } catch {
      offlineQueue.add({ entity, data });
      setSyncStatus("offline");
    }
  };

  const remove = async (entity, id, setFn) => {
    setFn(prev => prev.filter(x => String(x.id) !== String(id)));
    try { await api.del(entity, id); } catch { setSyncStatus("offline"); }
  };

  const saveCliente = (c) => persist("Cliente", c, setClients);
  const saveLead = (l) => persist("Lead", l, setLeads);
  const saveTarefa = (t) => persist("Tarefa", t, setTarefas);
  const delTarefa = (id) => remove("Tarefa", id, setTarefas);
  const saveFollowUp = (f) => persist("Followup", f, setFollowUps);
  const delFollowUp = (id) => remove("Followup", id, setFollowUps);
  const saveMensagem = (m) => persist("Mensagem", m, setMensagens);
  const saveTimeline = (e) => persist("Tarefa", {...e, _tipo:"timeline"}, setTimeline);
  const delTimeline = (id) => remove("Tarefa", id, setTimeline);

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
            <button key={n.key} style={S.navBtn(view===n.key&&!selectedClient)} onClick={()=>{setView(n.key);setSelectedClient(null);}}>
              {n.label}
              {n.key==="leads"&&leadsQ>0?` 🔥${leadsQ}`:""}
              {n.key==="agenda"&&pendAgenda>0?` (${pendAgenda})`:""}
            </button>
          ))}
        </nav>
        <SyncBar status={syncStatus} lastSync={lastSync} onSync={loadData}/>
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
          />
        ) : view==="dashboard" ? (
          <Dashboard clients={clients} leads={leads} tarefas={tarefas}
            onSelectClient={c=>{setSelectedClient(c);}}
            onNewClient={()=>setShowNewClient(true)}
            onNewLead={()=>{setView("leads");setShowNewLead(true);}}
          />
        ) : view==="leads" ? (
          <LeadsList leads={leads} followUps={followUps}
            onNew={()=>setShowNewLead(true)}
            onSaveLead={saveLead}
            onSaveFollowUp={saveFollowUp}
            onDelFollowUp={delFollowUp}
            onConvert={convertLead}
          />
        ) : view==="clientes" ? (
          <ClientesList clients={clients} tarefas={tarefas} onSelect={c=>setSelectedClient(c)} onNew={()=>setShowNewClient(true)}/>
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
