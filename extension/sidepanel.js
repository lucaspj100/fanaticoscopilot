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

function renderCard(card) {
  // Substitui o card de regra pelo card da IA do mesmo tipo (refino).
  const first = els.cards.firstElementChild;
  if (first && first.dataset.tipo === card.tipo && first.dataset.fonte === "regra" && card.fonte === "ia") {
    first.remove();
  }
  const el = document.createElement("article");
  el.className = `card ${card.nivel || "alerta"}`;
  el.dataset.tipo = card.tipo;
  el.dataset.fonte = card.fonte || "ia";
  el.innerHTML = `
    <div class="tag">${card.rotulo || card.tipo}</div>
    <div class="orient"></div>
    <div class="frase" title="Clique para copiar"></div>
    <div class="meta">${card.fonte === "regra" ? "regra instantânea" : "IA"} · ${card.ms ?? "?"} ms</div>`;
  el.querySelector(".orient").textContent = card.orientacao || "";
  const frase = el.querySelector(".frase");
  frase.textContent = card.frase ? `“${card.frase}”` : "";
  frase.addEventListener("click", () => navigator.clipboard.writeText(card.frase || ""));
  els.cards.prepend(el);
  while (els.cards.children.length > 4) els.cards.lastElementChild.remove();
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
