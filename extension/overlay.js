/**
 * United Copilot — modo compacto (teleprompter).
 * Overlay flutuante injetado na aba da call, próximo à câmera (topo central).
 * Mostra somente: rótulo, orientação curta e frase sugerida.
 */
(() => {
  if (window.__unitedCopilotOverlay) {
    window.__unitedCopilotOverlay.show();
    return;
  }

  const POS_KEY = "overlayPos";
  // O card pertence a um TURNO de fala. A prioridade só arbitra o MESMO turno.
  const GRUPO = {
    fechou: 5, intencao_compra: 5, pedido_decisao: 5,
    financeiro: 4, pensar: 4, segunda_opiniao: 4, tempo: 4, nao_negocie: 4, isolar_financeiro: 4,
    metodologia: 3, criterio_compra: 3, validar_solucao: 3, quatro_fatores: 3,
    aprofunde: 2, aprofunde_objetivo: 2, falta_problema: 2, falta_implicacao: 2, interesse: 2,
    personalize: 1, di_ausente: 1, rapport_longo: 1,
  };

  const host = document.createElement("div");
  host.id = "united-copilot-overlay-host";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
  <style>
    :host { all: initial; }
    .wrap {
      position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
      width: min(560px, 72vw); pointer-events: auto;
      font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #f2f7fb;
      background: rgba(10, 14, 19, 0.82);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 16px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.45);
      padding: 12px 14px 13px;
      opacity: 0; transition: opacity .18s ease, transform .18s ease;
    }
    .wrap.visible { opacity: 1; }
    .wrap.min { padding: 8px 12px; width: auto; }
    .wrap.min .body { display: none; }
    .bar { display: flex; align-items: center; gap: 10px; cursor: grab; user-select: none; }
    .bar:active { cursor: grabbing; }
    .rotulo {
      font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
      color: var(--c, #ffb020); white-space: nowrap;
    }
    .etapa {
      font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
      color: rgba(242,247,251,.6); border: 1px solid rgba(255,255,255,.16);
      border-radius: 999px; padding: 2px 7px; white-space: nowrap;
    }
    .spacer { flex: 1; }

    .ctrl {
      all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px;
      display: grid; place-items: center; color: rgba(242,247,251,.55); font-size: 13px; line-height: 1;
    }
    .ctrl:hover { background: rgba(255,255,255,.08); color: #f2f7fb; }
    .body { margin-top: 6px; }
    .orient { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    .frase {
      margin-top: 9px; padding: 10px 12px; border-radius: 11px;
      background: rgba(255,255,255,0.06); border-left: 3px solid var(--c, #ffb020);
      font-size: 19px; line-height: 1.4; font-weight: 500;
    }
    .frase b { display: block; font-size: 10px; letter-spacing: .16em; color: rgba(242,247,251,.5); margin-bottom: 3px; font-weight: 800; }
    .porque { margin-top: 7px; font-size: 12.5px; line-height: 1.4; color: rgba(242,247,251,.6); }
    .porque b { font-size: 10px; letter-spacing: .16em; font-weight: 800; color: rgba(242,247,251,.45); margin-right: 6px; }
    .idle { color: rgba(242,247,251,.45); font-size: 14px; }
  </style>
  <div class="wrap" part="wrap">
    <div class="bar" id="bar">
      <span class="rotulo" id="rotulo">UNITED COPILOT</span>
      <span class="etapa" id="etapa">RAPPORT</span>
      <span class="spacer"></span>

      <button class="ctrl" id="reset" title="Voltar à posição padrão">⌖</button>
      <button class="ctrl" id="min" title="Minimizar">–</button>
      <button class="ctrl" id="close" title="Fechar">✕</button>
    </div>
    <div class="body" id="body">
      <div class="orient idle" id="orient">Aguardando a fala do cliente…</div>
      <div class="frase" id="frase" hidden><b>FALE AGORA</b><span id="frase-txt"></span></div>
      <div class="porque" id="porque" hidden><b>POR QUÊ</b><span id="porque-txt"></span></div>
    </div>
  </div>`;

  document.documentElement.appendChild(host);

  const wrap = root.querySelector(".wrap");
  const $ = (id) => root.getElementById(id);
  const COR = { alerta: "#ff4d4d", aviso: "#ff8a3d", atencao: "#ffb020", positivo: "#21d07a" };

  /* ---------- posição (arrastar + persistir) ---------- */
  function applyPos(pos) {
    if (!pos) {
      wrap.style.top = "18px";
      wrap.style.left = "50%";
      wrap.style.transform = "translateX(-50%)";
      return;
    }
    wrap.style.transform = "none";
    wrap.style.left = `${pos.x}px`;
    wrap.style.top = `${pos.y}px`;
  }
  chrome.storage.local.get([POS_KEY]).then((s) => applyPos(s[POS_KEY]));

  let drag = null;
  $("bar").addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("ctrl")) return;
    const r = wrap.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    $("bar").setPointerCapture(e.pointerId);
  });
  $("bar").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = Math.max(4, Math.min(window.innerWidth - wrap.offsetWidth - 4, e.clientX - drag.dx));
    const y = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
    applyPos({ x, y });
  });
  $("bar").addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null;
    const r = wrap.getBoundingClientRect();
    chrome.storage.local.set({ [POS_KEY]: { x: Math.round(r.left), y: Math.round(r.top) } });
  });

  $("reset").addEventListener("click", () => {
    chrome.storage.local.remove(POS_KEY);
    applyPos(null);
  });
  $("min").addEventListener("click", () => wrap.classList.toggle("min"));
  $("close").addEventListener("click", () => api.hide(true));

  /* ---------- cards (ciclo de vida por turno de fala) ---------- */
  let atual = null; // { card, turnId }
  let currentTurnId = 0;

  function paint(card) {
    const cor = COR[card.nivel] || COR.atencao;
    wrap.style.setProperty("--c", cor);
    $("rotulo").textContent = card.rotulo || card.tipo || "SITUAÇÃO";
    const orient = $("orient");
    orient.textContent = card.orientacao || "";
    orient.classList.remove("idle");
    const frase = $("frase");
    if (card.frase) {
      frase.hidden = false;
      $("frase-txt").textContent = card.frase;
    } else {
      frase.hidden = true;
    }
    const porque = $("porque");
    if (card.porque) {
      porque.hidden = false;
      $("porque-txt").textContent = card.porque;
    } else {
      porque.hidden = true;
    }
    wrap.classList.remove("min");
  }

  /** Estado sem card: rótulo neutro e área da frase oculta. */
  function paintEstado(texto) {
    wrap.style.setProperty("--c", COR.atencao);
    $("rotulo").textContent = "UNITED COPILOT";
    const orient = $("orient");
    orient.textContent = texto;
    orient.classList.add("idle");
    $("frase").hidden = true;
    $("porque").hidden = true;
  }

  function novoTurno(turnId) {
    if (turnId === 1) { currentTurnId = 0; atual = null; } // nova sessão de call
    if (turnId <= currentTurnId) return;
    currentTurnId = turnId;
    atual = null;
    paintEstado("Analisando…");
  }

  function onCard(card) {
    if (!card || card.tipo === "nenhum") return;
    const turnId = card.turnId ?? currentTurnId;
    if (turnId < currentTurnId) return; // card de turno já encerrado
    if (turnId > currentTurnId) {
      currentTurnId = turnId;
      atual = null;
    }

    if (atual && atual.turnId === turnId && atual.card.tipo === card.tipo) {
      const merged = {
        ...atual.card,
        ...card,
        frase: card.frase || atual.card.frase,
        porque: card.porque || atual.card.porque,
      };
      atual = { card: merged, turnId };
      paint(merged);
      return;
    }
    if (atual && atual.turnId === turnId) {
      const novo = GRUPO[card.tipo] ?? 0;
      const velho = GRUPO[atual.card.tipo] ?? 0;
      if (novo <= velho) return;
    }
    atual = { card, turnId };
    paint(card);
    api.show();
  }

  const api = {
    show() {
      host.style.display = "";
      requestAnimationFrame(() => wrap.classList.add("visible"));
    },
    hide(userClosed) {
      wrap.classList.remove("visible");
      host.style.display = "none";
      if (userClosed) chrome.storage.local.set({ overlayMode: "sidepanel" });
    },
    onCard,
  };
  window.__unitedCopilotOverlay = api;

  const ETAPA_LABEL = {
    rapport: "RAPPORT",
    di: "DECISÃO IMEDIATA",
    spin: "SPIN",
    apresentacao: "APRESENTAÇÃO",
    gatilho: "GATILHO",
    fechamento: "FECHAMENTO",
  };
  function setEtapa(etapa) {
    const el = $("etapa");
    if (el && ETAPA_LABEL[etapa]) el.textContent = ETAPA_LABEL[etapa];
  }
  chrome.storage?.local?.get(["etapaAtual"]).then(({ etapaAtual }) => setEtapa(etapaAtual || "rapport")).catch(() => {});

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "COPILOT_CARD") {
      api.onCard(msg.card);
      if (msg.card?.etapa) setEtapa(msg.card.etapa);
    }
    if (msg?.type === "COPILOT_TURN_START" && msg.turnId === 1) { currentTurnId = 0; atual = null; }
    if (msg?.type === "COPILOT_TRANSCRIPT" && msg.final) novoTurno(msg.turnId ?? 0);
    if (msg?.type === "COPILOT_DECISION") {
      const turnId = msg.turnId ?? msg.decision?.turnId ?? currentTurnId;
      const semAcao = !msg.decision?.tipo || msg.decision.tipo === "nenhum";
      if (turnId >= currentTurnId && semAcao && (!atual || atual.turnId <= turnId)) {
        currentTurnId = Math.max(currentTurnId, turnId);
        atual = null;
        paintEstado("Sem intervenção agora.");
      }
    }
    if (msg?.type === "COPILOT_ETAPA") setEtapa(msg.etapa);
    if (msg?.type === "COPILOT_OVERLAY_HIDE") api.hide();
    if (msg?.type === "COPILOT_OVERLAY_SHOW") api.show();
  });


  api.show();
})();
