const DEFAULT_ENDPOINT = "https://id-preview--ca4edc97-ed9d-42d0-af3c-3c6e44cfad3b.lovable.app";

const els = {
  toggle: document.getElementById("toggle"),
  status: document.getElementById("status"),
  cards: document.getElementById("cards"),
  transcript: document.getElementById("transcript"),
  endpoint: document.getElementById("endpoint"),
  dot: document.getElementById("dot"),
};

let running = false;
let lastTipo = null;

chrome.storage.local.get(["endpoint"]).then(({ endpoint }) => {
  els.endpoint.value = endpoint || DEFAULT_ENDPOINT;
});
els.endpoint.addEventListener("change", () => {
  chrome.storage.local.set({ endpoint: els.endpoint.value.trim() });
});

const STATUS_TEXT = {
  ouvindo: "Ouvindo a call…",
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
  if (msg?.type === "COPILOT_CARD") renderCard(msg.card);
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
    els.status.textContent = `Capturando: ${res.tabTitle}`;
  } else {
    els.status.textContent = `⚠ ${res?.error || "Falha ao iniciar."}`;
  }
});

void lastTipo;
