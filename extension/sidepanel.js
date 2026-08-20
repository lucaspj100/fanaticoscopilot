const DEFAULT_ENDPOINT = "https://fanaticoscopilot.lovable.app";
// URLs de preview do Lovable exigem sessão e não são acessíveis por uma extensão.
const isPreviewUrl = (u) => /id-preview--|lovableproject\.com/.test(u || "");

const els = {
  toggle: document.getElementById("toggle"),
  status: document.getElementById("status"),
  cards: document.getElementById("cards"),
  transcript: document.getElementById("transcript"),
  endpoint: document.getElementById("endpoint"),
  dot: document.getElementById("dot"),
  diag: document.getElementById("diag"),
  diagTotal: document.getElementById("diag-total"),
  diagFirst: document.getElementById("diag-first"),
  diagFull: document.getElementById("diag-full"),
  net: document.getElementById("net"),
  diagToggle: document.getElementById("diag-toggle"),
  diagPanel: document.getElementById("diag-panel"),
  decision: document.getElementById("decision"),
  memoria: document.getElementById("memoria"),
};

/* ---------- etapa manual da call (fonte da verdade) ---------- */

const ETAPAS = ["rapport", "di", "spin", "apresentacao", "gatilho", "fechamento"];
let etapaAtual = "rapport";

function paintEtapas() {
  document
    .querySelectorAll(".etapa-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.etapa === etapaAtual));
}

function setEtapa(etapa, { broadcast = true } = {}) {
  if (!ETAPAS.includes(etapa)) return;
  etapaAtual = etapa;
  paintEtapas();
  chrome.storage.local.set({ etapaAtual: etapa });
  if (broadcast) chrome.runtime.sendMessage({ type: "COPILOT_ETAPA", etapa }).catch(() => {});
}

chrome.storage.local.get(["etapaAtual"]).then(({ etapaAtual: e }) => setEtapa(e || "rapport", { broadcast: false }));
document
  .querySelectorAll(".etapa-btn")
  .forEach((b) => b.addEventListener("click", () => setEtapa(b.dataset.etapa)));

/* ---------- memória viva da call ---------- */

const MEM_LABELS = [
  ["objetivo", "Objetivo"],
  ["problema", "Problema"],
  ["implicacao", "Implicação"],
  ["necessidade", "Necessidade"],
  ["criterioCompra", "Critério"],
  ["pontosQueGostou", "Gostou"],
  ["objecoes", "Objeções"],
  ["sinaisCompra", "Sinais de compra"],
  ["informacoesImportantes", "Outros"],
];

let memoriaAtual = null;
let memoriaAt = null;

function renderMemoria(memoria, alterados = []) {
  memoriaAtual = memoria;
  const linhas = MEM_LABELS.map(([k, label]) => {
    const v = memoria?.[k];
    const txt = Array.isArray(v) ? v.join(" · ") : v;
    return txt ? [k, label, txt] : null;
  }).filter(Boolean);

  if (!linhas.length) {
    const p = document.createElement("li");
    p.className = "vazio";
    p.textContent = "Nada registrado ainda nesta call.";
    els.memoria.replaceChildren(p);
    return;
  }
  els.memoria.replaceChildren(
    ...linhas.map(([k, label, txt]) => {
      const li = document.createElement("li");
      const s = document.createElement("span");
      s.textContent = label;
      const b = document.createElement("b");
      b.textContent = txt;
      li.append(s, b);
      if (alterados.includes(k)) li.classList.add("novo");
      return li;
    }),
  );
}


/* ---------- modos: CALL (padrão) x DIAGNÓSTICO ---------- */

function setDiag(on) {
  els.diagPanel.hidden = !on;
  els.diagToggle.textContent = on ? "Ocultar diagnóstico" : "Ver diagnóstico";
  chrome.storage.local.set({ diagOpen: on });
}
chrome.storage.local.get(["diagOpen"]).then(({ diagOpen }) => setDiag(!!diagOpen));
els.diagToggle.addEventListener("click", () => setDiag(els.diagPanel.hidden));

const ETAPAS_DIAG = [
  ["vad", "VAD / fim de fala"],
  ["prep", "Preparo + envio do áudio"],
  ["upload", "Rede (upload)"],
  ["stt", "Speech-to-Text"],
  ["classificacao", "Classificação"],
  ["ia", "IA (frase)"],
];

const fmt = (ms) => (ms == null ? "—" : ms <= 0 ? "antes do fim da fala" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms} ms`);

function renderTiming(t) {
  els.diag.replaceChildren(
    ...ETAPAS_DIAG.map(([k, label]) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = fmt(t[k]);
      li.append(label, b);
      return li;
    }),
  );
  els.diagTotal.textContent = t.total != null ? `· TOTAL ${fmt(t.total)}` : "";
  els.diagFirst.textContent = fmt(t.primeiroAlerta);
  els.diagFull.textContent = fmt(t.total);
  els.diagFirst.classList.toggle("slow", (t.primeiroAlerta ?? 0) > 1000);
  els.diagFull.classList.toggle("slow", (t.total ?? 0) > 3000);
}

function renderNet(n) {
  const linhas = [
    [`${n.method} ${n.url}`, ""],
    ["HTTP", n.status != null ? String(n.status) : n.kind || "sem resposta"],
    ["Resultado", n.ok ? "OK" : n.kind ? `Erro de ${n.kind}` : "Erro"],
    ["Tempo", fmt(n.ms)],
  ];
  if (n.error) linhas.push(["Mensagem", n.error]);
  els.net.replaceChildren(
    ...linhas.map(([label, value]) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = value;
      li.append(label, b);
      if (!n.ok) li.classList.add("slow");
      return li;
    }),
  );
}

function renderDecision(d) {
  const linhas = [["Decisão", d.decisao || "—"]];
  if (d.confianca != null) linhas.push(["Confiança", String(d.confianca)]);
  if (d.tipo) linhas.push(["type", d.tipo]);
  if (d.etapa) linhas.push(["stage", d.etapa]);
  if (d.orientacao) linhas.push(["orientation", d.orientacao]);
  if (d.frase) linhas.push(["suggested_phrase", d.frase]);
  if (d.motivo) linhas.push(["Motivo", d.motivo]);
  if (d.aviso) linhas.push(["Aviso", d.aviso]);
  if (d.debug) linhas.push(["payload", JSON.stringify(d.debug).slice(0, 400)]);
  els.decision.replaceChildren(
    ...linhas.map(([label, value]) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = value;
      li.append(label, b);
      return li;
    }),
  );
}

/* ---------- modo de exibição: sidepanel · compacto · ambos ---------- */

let overlayMode = "sidepanel";

function paintModes() {
  document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === overlayMode));
}

async function applyMode(mode, { announce } = {}) {
  overlayMode = mode;
  paintModes();
  chrome.storage.local.set({ overlayMode: mode });
  const res = await chrome.runtime.sendMessage({
    type: "COPILOT_OVERLAY_MODE",
    enabled: mode === "compacto" || mode === "ambos",
  });
  if (announce && res && !res.ok) els.status.textContent = `⚠ ${res.error}`;
}

chrome.storage.local.get(["overlayMode"]).then(({ overlayMode: m }) => {
  overlayMode = m || "sidepanel";
  paintModes();
});
document.querySelectorAll(".mode").forEach((b) =>
  b.addEventListener("click", () => applyMode(b.dataset.mode, { announce: true })),
);

let running = false;

chrome.storage.local.get(["endpoint"]).then(({ endpoint }) => {
  const url = !endpoint || isPreviewUrl(endpoint) ? DEFAULT_ENDPOINT : endpoint;
  els.endpoint.value = url;
  chrome.storage.local.set({ endpoint: url });
});
els.endpoint.addEventListener("change", () => {
  chrome.storage.local.set({ endpoint: els.endpoint.value.trim() });
});

const STATUS_TEXT = {
  ouvindo: "COPILOTO ATIVO — OUVINDO",
  falando: "Cliente falando…",
  transcrevendo: "Processando…",
};

function setRunning(on) {
  running = on;
  els.toggle.textContent = on ? "Parar" : "Iniciar";
  els.toggle.classList.toggle("on", on);
  els.dot.classList.toggle("on", on);
}

/* ---------- estabilidade do card ---------- */
/* Grupos: 5 fechamento/sim · 4 objeção · 3 pergunta direta
   2 aprofundamento · 1 alerta de processo */
const GRUPO = {
  fechou: 5,
  intencao_compra: 5,
  pedido_decisao: 5,
  financeiro: 4,
  pensar: 4,
  segunda_opiniao: 4,
  tempo: 4,
  nao_negocie: 4,
  isolar_financeiro: 4,
  metodologia: 3,
  criterio_compra: 3,
  validar_solucao: 3,
  quatro_fatores: 3,
  aprofunde: 2,
  aprofunde_objetivo: 2,
  falta_problema: 2,
  falta_implicacao: 2,
  interesse: 2,
  personalize: 1,
  di_ausente: 1,
  rapport_longo: 1,
};

const ETAPA_LABEL = {
  rapport: "Rapport",
  di: "Regra do jogo / D.I.",
  spin: "Pré-speech / SPIN",
  apresentacao: "Apresentação",
  gatilho: "Gatilho de fechamento",
  fechamento: "Fechamento",
};

const HOLD_MS = 20000; // mantém a mesma situação na tela enquanto ela continua

let atual = null; // { card, el, at }

function buildCard(card) {
  const el = document.createElement("article");
  el.className = `card ${card.nivel || "alerta"}`;
  el.innerHTML = `
    <div class="tag"><span class="rotulo"></span><span class="etapa"></span></div>
    <div class="orient"></div>
    <div class="frase-wrap" hidden>
      <div class="frase-label">FALE:</div>
      <div class="frase" title="Clique para copiar"></div>
    </div>
    <div class="meta"></div>`;
  return el;
}

function fillCard(el, card) {
  el.className = `card ${card.nivel || "alerta"}`;
  el.querySelector(".rotulo").textContent = card.rotulo || card.tipo;
  el.querySelector(".etapa").textContent = ETAPA_LABEL[card.etapa] || "";
  if (card.orientacao) el.querySelector(".orient").textContent = card.orientacao;

  const wrap = el.querySelector(".frase-wrap");
  if (card.frase) {
    wrap.hidden = false;
    const frase = el.querySelector(".frase");
    frase.textContent = `“${card.frase}”`;
    frase.onclick = () => navigator.clipboard.writeText(card.frase);
  }
  el.querySelector(".meta").textContent =
    card.fonte === "ia" ? `frase da IA · ${card.ms ?? "?"} ms` : "alerta instantâneo · aguardando frase…";
}

function renderCard(card) {
  if (!card || card.tipo === "nenhum") return;
  const agora = Date.now();

  // Mesma situação: atualiza o card no lugar (a IA só completa a frase).
  if (atual && atual.card.tipo === card.tipo) {
    const merged = { ...atual.card, ...card, frase: card.frase || atual.card.frase };
    fillCard(atual.el, merged);
    atual = { card: merged, el: atual.el, at: atual.at };
    return;
  }

  if (atual) {
    const novo = GRUPO[card.tipo] ?? 0;
    const velho = GRUPO[atual.card.tipo] ?? 0;
    const antigo = agora - atual.at > HOLD_MS;
    // Só troca por algo mais importante — ou quando o card já envelheceu.
    if (novo <= velho && !antigo) return;
  }

  const el = buildCard(card);
  fillCard(el, card);
  els.cards.replaceChildren(el); // no máximo UMA situação visível
  atual = { card, el, at: agora };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "COPILOT_ARMED") refreshArmState();
  if (msg?.type === "COPILOT_CARD") renderCard(msg.card);
  if (msg?.type === "COPILOT_TIMING") renderTiming(msg.timing);
  if (msg?.type === "COPILOT_NET") renderNet(msg.net);
  if (msg?.type === "COPILOT_DECISION") renderDecision(msg.decision);
  if (msg?.type === "COPILOT_STATUS") {
    els.status.textContent = msg.status === "erro" ? `⚠ ${msg.error}` : STATUS_TEXT[msg.status] || msg.status;
  }
  if (msg?.type === "COPILOT_TRANSCRIPT") {
    const li = document.createElement("li");
    li.textContent = `${msg.parcial ? "· " : ""}${msg.text}  (${msg.ms} ms)`;
    els.transcript.prepend(li);
    while (els.transcript.children.length > 20) els.transcript.lastElementChild.remove();
  }
});

async function refreshArmState() {
  try {
    const st = await chrome.runtime.sendMessage({ type: "COPILOT_QUERY_STATE" });
    if (!st?.ok || running) return;
    els.status.textContent = st.armed
      ? "Pronto. Clique em Iniciar para capturar esta aba."
      : "Clique no ícone do United Copilot na barra do Chrome (com a aba do Zoom em foco) para autorizar a captura.";
  } catch {
    /* ignora */
  }
}
refreshArmState();

els.toggle.addEventListener("click", async () => {
  if (running) {
    await chrome.runtime.sendMessage({ type: "COPILOT_STOP" });
    setRunning(false);
    els.status.textContent = "Parado.";
    return;
  }
  els.status.textContent = "Conectando à aba…";
  const res = await chrome.runtime.sendMessage({
    type: "COPILOT_START",
    endpoint: els.endpoint.value.trim() || DEFAULT_ENDPOINT,
  });
  if (res?.ok) {
    setRunning(true);
    els.status.textContent = `COPILOTO ATIVO — OUVINDO · ${res.tabTitle}`;
  } else {
    els.status.textContent = `⚠ ${res?.error || chrome.runtime.lastError?.message || "Falha ao iniciar."}`;
  }
});
