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
  turno: document.getElementById("turno"),
  memoria: document.getElementById("memoria"),
  health: document.getElementById("health"),
  healthFlag: document.getElementById("health-flag"),
};

/* ---------- diagnóstico do pipeline: CAPTURA / TRANSCRIÇÃO / COPILOT ---------- */

function segs(ms) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms atrás` : `${(ms / 1000).toFixed(1)} s atrás`;
}

function renderHealth(h) {
  if (!h) return;
  const a = h.audio || {};
  const audioOk = h.running && a.msSinceChunk != null && a.msSinceChunk < 5000;
  const linhas = [
    ["CAPTURA — áudio chegando", audioOk ? "SIM" : "NÃO"],
    ["CAPTURA — último chunk", segs(a.msSinceChunk)],
    ["CAPTURA — chunks recebidos", String(a.audioChunksReceived ?? 0)],
    ["CAPTURA — AudioContext", h.audioContext || "—"],
    ["CAPTURA — track", h.track?.present ? `${h.track.readyState}${h.track.muted ? " (mudo)" : ""}` : "ausente"],
    ["CAPTURA — VAD início/fim", `${a.vadSpeechStartCount ?? 0} / ${a.vadSpeechEndCount ?? 0}`],
    ["TRANSCRIÇÃO — último transcript", segs(a.msSinceTranscript)],
    ["TRANSCRIÇÃO — transcript_final", String(a.transcriptFinalCount ?? 0)],
    ["TRANSCRIÇÃO — STT pendentes", String(a.sttPending ?? 0)],
    ["TRANSCRIÇÃO — STT ok/falhas", `${a.sttRequestsCompleted ?? 0} / ${a.sttRequestsFailed ?? 0}`],
    ["COPILOT — última decisão", segs(a.msSinceDecision)],
    ["COPILOT — último turno commitado", String(h.turnos?.lastCommittedTurnId ?? 0)],
    ["COPILOT — turnos na fila", String(h.turnos?.pendentes ?? 0)],
    ["COPILOT — memória atualizada", String(a.memoryUpdates ?? 0)],
    ["RECUPERAÇÕES", String(a.recoveries ?? 0)],
  ];
  els.health.replaceChildren(
    ...linhas.map(([k, v]) => {
      const li = document.createElement("li");
      li.textContent = k;
      const b = document.createElement("b");
      b.textContent = v;
      li.appendChild(b);
      return li;
    }),
  );
  const problema = h.alerta || h.recuperando || h.falhaRecuperacao || (h.running && !audioOk ? "captura sem áudio" : null);
  els.healthFlag.textContent = problema ? `· ⚠ ${problema}` : h.running ? "· ok" : "";
}

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
  CopilotLog.setEtapa(etapa);
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
  ["spinStatus", "SPIN"],
  ["spinImplicacoes", "Implicações (SPIN)"],
  ["spinPerguntasJaExploradas", "Eixos explorados"],
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

  // V2.8 — leitura comercial: rota dominante, motivações e critério de compra.
  if (memoria?.rota) linhas.push(["rota", "ROTA DOMINANTE", memoria.rota.replace(/_/g, " ")]);
  const motiv = Object.entries(memoria?.motivacoes || {})
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v.toFixed(1)}`);
  if (motiv.length) linhas.push(["motivacoes", "MOTIVAÇÕES", motiv.join(" · ")]);
  if (memoria?.criteriosCompra?.length)
    linhas.push(["criteriosCompra", "CRITÉRIOS DE COMPRA", memoria.criteriosCompra.join(" · ")]);
  if (memoria?.ganchos?.length)
    linhas.push([
      "ganchos",
      "GANCHOS P/ APRESENTAÇÃO",
      memoria.ganchos.map((g) => `${g.necessidade} → ${g.featureRelacionada}`).join(" · "),
    ]);

  // Mapa vivo do cliente (V2.6) — o que já sabemos e o que ainda falta.
  const mapa = memoria?.mapa || {};
  const faltando = [];
  for (const [slot, dado] of Object.entries(mapa)) {
    const rot = slot.replace(/_/g, " ").toUpperCase();
    if (!dado || dado.estado === "nao_explorado") {
      faltando.push(rot.toLowerCase());
      continue;
    }
    const sufixo = dado.estado === "parcial" ? " (parcial)" : "";
    const prof = dado.profundidade ? ` [${dado.profundidade}]` : "";
    linhas.push([`mapa.${slot}`, rot + sufixo + prof, dado.valor || "sim"]);
  }
  if (faltando.length) linhas.push(["mapa.lacunas", "AINDA NÃO EXPLORADO", faltando.slice(0, 6).join(" · ")]);
  if (mapa.minimizacao && mapa.minimizacao.estado === "respondido") {
    linhas.push(["mapa.minimizacao_alerta", "ATENÇÃO", "cliente minimizou a dor — não encerre o SPIN"]);
  }


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
  linhas.push(["etapa_manual", d.etapaManual || etapaAtual]);
  linhas.push([
    "memoria",
    memoriaAt ? `${MEM_LABELS.filter(([k]) => { const v = memoriaAtual?.[k]; return Array.isArray(v) ? v.length : v; }).length} campos` : "vazia",
  ]);

  if (d.orientacao) linhas.push(["orientation", d.orientacao]);
  if (d.frase) linhas.push(["suggested_phrase", d.frase]);
  if (d.porque) linhas.push(["porque", d.porque]);
  if (d.acao) linhas.push(["acao", d.acao]);
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

const ETAPA_LABEL = {
  rapport: "Rapport",
  di: "Regra do jogo / D.I.",
  spin: "Pré-speech / SPIN",
  apresentacao: "Apresentação",
  gatilho: "Gatilho de fechamento",
  fechamento: "Fechamento",
};

/* A recomendação ativa vive no background (fonte única da verdade).
   Aqui só renderizamos o estado recebido; nada é decidido localmente. */

let atual = null; // { card, el, turnId }
let currentTurnId = 0;
let ultimaTranscricao = null; // { turnId, text }

function buildCard(card) {
  const el = document.createElement("article");
  el.className = `card ${card.nivel || "alerta"}`;
  el.innerHTML = `
    <div class="tag"><span class="rotulo"></span><span class="etapa"></span></div>
    <div class="orient"></div>
    <div class="frase-wrap" hidden>
      <div class="frase-label">FALE AGORA</div>
      <div class="frase" title="Clique para copiar"></div>
    </div>
    <div class="porque-wrap" hidden>
      <div class="frase-label">POR QUÊ</div>
      <div class="porque"></div>
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
  } else {
    wrap.hidden = true;
  }

  const pq = el.querySelector(".porque-wrap");
  if (card.porque) {
    pq.hidden = false;
    el.querySelector(".porque").textContent = card.porque;
  } else {
    pq.hidden = true;
  }

  el.querySelector(".meta").textContent =
    card.fonte === "ia" ? `frase da IA · ${card.ms ?? "?"} ms` : "alerta instantâneo · aguardando frase…";
}

function showEstado(texto, classe) {
  const el = document.createElement("div");
  el.className = `estado ${classe || ""}`;
  el.textContent = texto;
  els.cards.replaceChildren(el);
}

function renderTurnoDiag() {
  if (!els.turno) return;
  const linhas = [
    ["ÚLTIMO TURNO TRANSCRITO", ultimaTranscricao ? String(ultimaTranscricao.turnId) : "—"],
    ["Texto", ultimaTranscricao?.text || "—"],
    ["CARD ATUAL", atual ? `turnId ${atual.turnId} · ${atual.card.tipo}` : "nenhum"],
  ];
  els.turno.replaceChildren(
    ...linhas.map(([label, value]) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = value;
      li.append(label, b);
      return li;
    }),
  );
}

/** Renderiza SEMPRE o estado central do background (fonte única da verdade). */
let seenSequence = -1;
function renderActive(state) {
  if (!state) return;
  const sequence = state.sequence ?? 0;
  if (sequence < seenSequence) return; // resposta fora de ordem: descarta
  seenSequence = sequence;
  currentTurnId = Math.max(currentTurnId, state.turnId || 0);

  if (state.kind === "card" && state.rec) {
    const card = state.rec;
    if (atual && atual.el && atual.card.id === card.id) {
      fillCard(atual.el, card); // mesmo card: atualiza no lugar
      atual = { card, el: atual.el, turnId: card.turnId ?? currentTurnId };
    } else {
      const el = buildCard(card);
      fillCard(el, card);
      els.cards.replaceChildren(el); // no máximo UMA recomendação visível
      atual = { card, el, turnId: card.turnId ?? currentTurnId };
    }
  } else {
    atual = null;
    if (state.kind === "analisando") showEstado("Analisando…", "analisando");
    else if (state.kind === "silencio") showEstado("Sem intervenção agora.", "silencio");
    else els.cards.replaceChildren();
  }
  renderTurnoDiag();
}


chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "COPILOT_ARMED") refreshArmState();
  // Estado central: única origem do que o sidepanel mostra.
  if (msg?.type === "COPILOT_ACTIVE_REC") renderActive(msg.state);
  if (msg?.type === "COPILOT_TURN_START" && msg.turnId === 1) {
    ultimaTranscricao = null;
    seenSequence = -1;
    renderTurnoDiag();
  }
  if (msg?.type === "COPILOT_CARD") CopilotLog.card(msg.card);
  if (msg?.type === "COPILOT_TIMING") {
    CopilotLog.latency(msg.timing, msg.turnId);
    renderTiming(msg.timing);
  }
  if (msg?.type === "COPILOT_NET") renderNet(msg.net);
  if (msg?.type === "COPILOT_HEALTH") {
    renderHealth(msg.health);
    const h = msg.health || {};
    if (h.evento || h.alerta || h.recuperando || h.falhaRecuperacao) {
      CopilotLog.add("pipeline_health", h);
    }
  }
  if (msg?.type === "COPILOT_DECISION") {
    CopilotLog.decision(msg.decision);
    renderDecision(msg.decision);
  }
  if (msg?.type === "COPILOT_MEMORY") {
    memoriaAt = msg.at || null;
    CopilotLog.memory(msg.memoria, msg.alterados || []);
    renderMemoria(msg.memoria, msg.alterados || []);
  }
  if (msg?.type === "COPILOT_ETAPA" && msg.from === "overlay") setEtapa(msg.etapa, { broadcast: false });

  if (msg?.type === "COPILOT_STATUS") {
    els.status.textContent = msg.status === "erro" ? `⚠ ${msg.error}` : STATUS_TEXT[msg.status] || msg.status;
  }
  if (msg?.type === "COPILOT_TRANSCRIPT") {
    const turnId = msg.turnId ?? currentTurnId;
    // Histórico interno COMPLETO (a UI mostra só os últimos itens).
    CopilotLog.transcript({ turnId, text: msg.text, parcial: !!msg.parcial, ms: msg.ms });
    if (msg.final) {
      ultimaTranscricao = { turnId, text: msg.text };
      renderTurnoDiag();
    }
    const li = document.createElement("li");
    li.textContent = `#${turnId} ${msg.parcial ? "· " : ""}${msg.text}  (${msg.ms} ms)`;
    els.transcript.prepend(li);
    while (els.transcript.children.length > 20) els.transcript.lastElementChild.remove();
  }
});

// Reload do sidepanel: recupera a recomendação atualmente válida.
chrome.runtime
  .sendMessage({ type: "GET_ACTIVE_RECOMMENDATION" })
  .then((res) => res?.ok && renderActive(res.state))
  .catch(() => {});


/* ---------- exportação do teste da call ---------- */

const btnExport = document.getElementById("export-json");
const btnCopy = document.getElementById("copy-diag");

btnExport.addEventListener("click", () => {
  if (!CopilotLog.sessionId) {
    els.status.textContent = "⚠ Nenhuma sessão registrada ainda. Clique em Iniciar.";
    return;
  }
  CopilotLog.download();
  els.status.textContent = `Arquivo exportado: ${CopilotLog.fileName()}`;
});

btnCopy.addEventListener("click", async () => {
  if (!CopilotLog.sessionId) {
    els.status.textContent = "⚠ Nenhuma sessão registrada ainda. Clique em Iniciar.";
    return;
  }
  try {
    await navigator.clipboard.writeText(CopilotLog.toText());
    btnCopy.textContent = "Copiado ✓";
    setTimeout(() => (btnCopy.textContent = "Copiar diagnóstico"), 1800);
  } catch {
    els.status.textContent = "⚠ Não foi possível copiar para a área de transferência.";
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
    CopilotLog.stop();
    els.status.textContent = `Parado. Sessão ${CopilotLog.sessionId} pronta para exportar.`;
    return;
  }
  els.status.textContent = "Conectando à aba…";
  // Nova sessão de call: zera cards, turnos e memória local.
  els.cards.replaceChildren();
  atual = null;
  currentTurnId = 0;
  ultimaTranscricao = null;
  renderTurnoDiag();
  memoriaAt = null;
  renderMemoria(null, []);
  CopilotLog.start(etapaAtual);
  const res = await chrome.runtime.sendMessage({
    type: "COPILOT_START",
    endpoint: els.endpoint.value.trim() || DEFAULT_ENDPOINT,
    etapa: etapaAtual,
  });

  if (res?.ok) {
    setRunning(true);
    els.status.textContent = `COPILOTO ATIVO — OUVINDO · ${res.tabTitle}`;
  } else {
    els.status.textContent = `⚠ ${res?.error || chrome.runtime.lastError?.message || "Falha ao iniciar."}`;
  }
});
renderMemoria(null, []);
