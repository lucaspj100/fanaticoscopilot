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
};

const ETAPAS_DIAG = [
  ["vad", "VAD / fim de fala"],
  ["prep", "Preparo + envio do áudio"],
  ["upload", "Rede (upload)"],
  ["stt", "Speech-to-Text"],
  ["classificacao", "Classificação"],
  ["ia", "IA (sugestão)"],
];

const fmt = (ms) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms} ms`);

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

let running = false;
let lastTipo = null;

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

// Prioridade comercial: só troca o card quando surge algo mais relevante.
const PRIORIDADE = {
  fechou: 100,
  intencao_compra: 90,
  nao_negocie: 85,
  pensar: 80,
  financeiro: 78,
  segunda_opiniao: 74,
  tempo: 70,
  isolar_financeiro: 66,
  pedido_decisao: 64,
  validar_solucao: 60,
  metodologia: 56,
  quatro_fatores: 52,
  falta_implicacao: 50,
  aprofunde: 46,
  criterio_compra: 44,
  personalize: 40,
  di_ausente: 36,
  interesse: 34,
  rapport_longo: 20,
};

const ETAPA_LABEL = {
  rapport: "Rapport",
  di: "Regra do jogo / D.I.",
  spin: "Pré-speech / SPIN",
  apresentacao: "Apresentação",
  gatilho: "Gatilho de fechamento",
  fechamento: "Fechamento",
};

let atual = null;

function renderCard(card) {
  if (!card || card.tipo === "nenhum") return;

  // Refino da IA sobre o card de regra do mesmo momento sempre entra.
  const refino = atual && card.fonte === "ia" && atual.fonte === "regra";
  if (atual && !refino && (PRIORIDADE[card.tipo] ?? 0) < (PRIORIDADE[atual.tipo] ?? 0) && card.fonte === "regra") {
    return; // situação menos relevante: não rouba a tela do vendedor
  }

  const el = document.createElement("article");
  el.className = `card ${card.nivel || "alerta"}`;
  el.innerHTML = `
    <div class="tag">${card.rotulo || card.tipo}<span class="etapa">${ETAPA_LABEL[card.etapa] || ""}</span></div>
    <div class="orient"></div>
    <div class="frase-wrap" hidden>
      <div class="frase-label">PERGUNTE:</div>
      <div class="frase" title="Clique para copiar"></div>
    </div>
    <div class="meta">${card.fonte === "regra" ? "regra instantânea" : "IA"} · ${card.ms ?? "?"} ms</div>`;
  el.querySelector(".orient").textContent = card.orientacao || "";
  if (card.frase) {
    el.querySelector(".frase-wrap").hidden = false;
    const frase = el.querySelector(".frase");
    frase.textContent = `“${card.frase}”`;
    frase.addEventListener("click", () => navigator.clipboard.writeText(card.frase));
  }
  els.cards.replaceChildren(el); // no máximo UMA situação visível
  atual = card;
  lastTipo = card.tipo;
}


chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "COPILOT_ARMED") refreshArmState();
  if (msg?.type === "COPILOT_CARD") renderCard(msg.card);
  if (msg?.type === "COPILOT_TIMING") renderTiming(msg.timing);
  if (msg?.type === "COPILOT_NET") renderNet(msg.net);
  if (msg?.type === "COPILOT_STATUS") {
    els.status.textContent = msg.status === "erro" ? `⚠ ${msg.error}` : STATUS_TEXT[msg.status] || msg.status;
  }
  if (msg?.type === "COPILOT_TRANSCRIPT") {
    const li = document.createElement("li");
    li.textContent = `${msg.text}  (${msg.ms} ms)`;
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

void lastTipo;
