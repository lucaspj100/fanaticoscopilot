/**
 * United Copilot — service worker.
 *
 * Fluxo de autorização (MV3):
 * o clique no ÍCONE da extensão é a ação explícita que concede activeTab
 * para a aba do Zoom. Guardamos essa aba como "armada" e abrimos o Side Panel.
 * O botão Iniciar do painel usa essa autorização para chamar tabCapture.
 */

// Precisamos receber o onClicked para ganhar activeTab, então o painel
// é aberto manualmente dentro do handler (também é um gesto do usuário).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

/** tabId -> timestamp em que o activeTab foi concedido */
const armed = new Map();

function arm(tabId) {
  armed.set(tabId, Date.now());
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  arm(tab.id);
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch {
      /* ignora */
    }
  }
  chrome.runtime.sendMessage({ type: "COPILOT_ARMED", tabId: tab.id, url: tab.url }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  armed.delete(tabId);
  if (overlayTabId === tabId) overlayTabId = null;
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // navegação revoga o activeTab concedido
  if (info.url) armed.delete(tabId);
});

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capturar e processar o áudio da aba da reunião.",
  });
}

function getMediaStreamId(targetTabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
        const err = chrome.runtime.lastError;
        if (err || !streamId) reject(new Error(err?.message || "streamId vazio"));
        else resolve(streamId);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** aba onde o overlay compacto está injetado */
let overlayTabId = null;

async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] });
    overlayTabId = tabId;
    // overlay nasce já com a recomendação ativa (nunca com cache antigo)
    chrome.tabs.sendMessage(tabId, { type: "COPILOT_ACTIVE_REC", state }).catch(() => {});
  } catch (e) {
    const err = chrome.runtime.lastError?.message || e?.message || String(e);
    if (/permission|access|cannot access|host/i.test(err)) {
      throw new Error("Abra uma reunião no Zoom Web para usar o modo compacto.");
    }
    throw e;
  }
}

function toOverlay(msg) {
  if (overlayTabId == null) return;
  chrome.tabs.sendMessage(overlayTabId, msg).catch(() => {});
}

async function pickTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/* ============================================================
   FONTE ÚNICA DA VERDADE: activeRecommendation
   O offscreen (IA/regras) publica eventos; o background decide qual é a
   recomendação ativa e propaga o MESMO estado para sidepanel e overlay.
   ============================================================ */

const GRUPO = {
  fechou: 5, intencao_compra: 5, pedido_decisao: 5,
  financeiro: 4, pensar: 4, segunda_opiniao: 4, tempo: 4, nao_negocie: 4, isolar_financeiro: 4,
  di_resistencia: 4, di_comparacao: 4, di_criterios: 4, di_pede_apresentacao: 4, di_estabelecida: 3,
  metodologia: 3, criterio_compra: 3, validar_solucao: 3, quatro_fatores: 3,
  spin_objetivo: 2, spin_problema: 2, spin_implicacao: 2, spin_confirmacao: 2, spin_suficiente: 2,
  aprofunde: 2, aprofunde_objetivo: 2, falta_problema: 2, falta_implicacao: 2, interesse: 2,
  personalize: 1, di_ausente: 1, rapport_longo: 1,
};

const STORE_KEY = "activeRecommendation";

/** kind: idle | analisando | silencio | card */
let state = { kind: "idle", texto: "Aguardando a fala do cliente…", rec: null, sequence: 0, turnId: 0 };
let seq = 0;
/** último turno efetivamente commitado na conversa (transcript_final em ordem) */
let latestCommittedTurnId = 0;
let hydrated = false;

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const s = await chrome.storage.local.get([STORE_KEY]);
    if (s[STORE_KEY]?.sequence >= (state.sequence || 0) && s[STORE_KEY].kind) {
      state = s[STORE_KEY];
      seq = state.sequence || 0;
    }
  } catch {
    /* sem estado anterior */
  }
}
hydrate();

function broadcast() {
  const payload = { type: "COPILOT_ACTIVE_REC", state };
  chrome.storage.local.set({ [STORE_KEY]: state }).catch(() => {});
  chrome.runtime.sendMessage(payload).catch(() => {});
  toOverlay(payload);
}

function setEstado(kind, texto, turnId) {
  state = {
    kind,
    texto,
    rec: null,
    sequence: ++seq,
    turnId: Math.max(state.turnId || 0, turnId ?? state.turnId ?? 0),
  };
  broadcast();
}

function resetRecomendacao() {
  seq = 0;
  latestCommittedTurnId = 0;
  state = { kind: "idle", texto: "Aguardando a fala do cliente…", rec: null, sequence: 0, turnId: 0 };
  broadcast();
}

/** Aplica um card novo respeitando turno, prioridade e ordem de chegada. */
function applyCard(card, turnIdRaw) {
  if (!card || card.tipo === "nenhum") return;
  const turnId = card.turnId ?? card.sourceTurnId ?? turnIdRaw ?? state.turnId ?? 0;
  // Resposta atrasada de um turno já superado: descarta (race condition).
  if (turnId < (state.turnId || 0)) return;
  if (turnId < latestCommittedTurnId) return;
  if (
    state.kind === "card" &&
    state.rec &&
    state.rec.turnId === turnId &&
    card.recommendationSequence != null &&
    state.rec.recommendationSequence != null &&
    card.recommendationSequence < state.rec.recommendationSequence
  ) {
    return;
  }

  const atual = state.kind === "card" && state.turnId === turnId ? state.rec : null;

  let merged = card;
  if (atual && atual.tipo === card.tipo) {
    // Mesmo turno + mesma situação: completa o card (a IA só traz a frase).
    merged = {
      ...atual,
      ...card,
      frase: card.frase || atual.frase,
      porque: card.porque || atual.porque,
      orientacao: card.orientacao || atual.orientacao,
    };
  } else if (atual) {
    const novo = GRUPO[card.tipo] ?? 0;
    const velho = GRUPO[atual.tipo] ?? 0;
    if (novo <= velho) return; // dentro do mesmo turno só troca por algo mais importante
  }

  state = {
    kind: "card",
    texto: "",
    turnId,
    sequence: ++seq,
    rec: {
      ...merged,
      id: atual && atual.tipo === card.tipo ? atual.id : `rec_${turnId}_${seq}`,
      turnId,
      sourceTurnId: turnId,
      recommendationSequence: merged.recommendationSequence ?? seq,
      createdAt: Date.now(),
      sequence: seq,
      ts: Date.now(),
    },
  };
  broadcast();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_ACTIVE_RECOMMENDATION") {
    (async () => {
      await hydrate();
      sendResponse({ ok: true, state });
    })();
    return true;
  }

  // Eventos crus continuam disponíveis para o diagnóstico do sidepanel.
  if (msg?.type === "COPILOT_CARD") applyCard(msg.card, msg.turnId);

  if (msg?.type === "COPILOT_TURN_START" && msg.turnId === 1) resetRecomendacao();

  if (msg?.type === "COPILOT_TRANSCRIPT" && msg.final) {
    const turnId = msg.turnId ?? 0;
    latestCommittedTurnId = Math.max(latestCommittedTurnId, turnId);
    if (turnId > (state.turnId || 0)) setEstado("analisando", "Analisando…", turnId);
  }

  if (msg?.type === "COPILOT_DECISION") {
    const turnId = msg.sourceTurnId ?? msg.turnId ?? msg.decision?.turnId ?? state.turnId ?? 0;
    // Resposta atrasada de um turno já superado nunca vira estado ativo.
    if (turnId < latestCommittedTurnId) return false;
    const semAcao = !msg.decision?.tipo || msg.decision.tipo === "nenhum";
    if (semAcao && turnId >= (state.turnId || 0) && state.kind !== "card") {
      setEstado("silencio", "Sem intervenção agora.", turnId);
    }
    toOverlay(msg);
  }

  // etapa manual: sidepanel -> overlay (do overlay já chega direto nas páginas da extensão)
  if (msg?.type === "COPILOT_ETAPA" && msg.from !== "overlay") toOverlay(msg);



  if (msg?.type === "COPILOT_OVERLAY_MODE") {
    (async () => {
      try {
        const tab = await pickTargetTab();
        if (!tab?.id) throw new Error("Nenhuma aba ativa encontrada.");
        if (msg.enabled) {
          if (!armed.has(tab.id)) {
            throw new Error(
              "Autorização pendente: clique no ÍCONE do United Copilot na barra do Chrome com a aba da call em foco.",
            );
          }
          await injectOverlay(tab.id);
          chrome.tabs.sendMessage(tab.id, { type: "COPILOT_OVERLAY_SHOW" }).catch(() => {});
        } else if (overlayTabId != null) {
          chrome.tabs.sendMessage(overlayTabId, { type: "COPILOT_OVERLAY_HIDE" }).catch(() => {});
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Watchdog do offscreen: a captura morreu no meio da call — reacquirir o stream.
  if (msg?.type === "COPILOT_RECAPTURE") {
    (async () => {
      try {
        const tab = await pickTargetTab();
        if (!tab?.id) throw new Error("Nenhuma aba ativa encontrada.");
        const streamId = await getMediaStreamId(tab.id);
        sendResponse({ ok: true, streamId, tabId: tab.id });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "COPILOT_HEALTH") toOverlay(msg);

  if (msg?.type === "COPILOT_QUERY_STATE") {
    (async () => {
      const tab = await pickTargetTab();
      sendResponse({
        ok: true,
        tabId: tab?.id ?? null,
        tabTitle: tab?.title || "",
        url: tab?.url || "",
        armed: tab?.id != null && armed.has(tab.id),
      });
    })();
    return true;
  }

  if (msg?.type === "COPILOT_START") {
    (async () => {
      try {
        const tab = await pickTargetTab();
        if (!tab?.id) throw new Error("Nenhuma aba ativa encontrada.");

        const url = tab.url || "";
        if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
          throw new Error("Páginas internas do Chrome não podem ser capturadas. Abra a aba do Zoom.");
        }

        if (!armed.has(tab.id)) {
          throw new Error(
            "Autorização pendente: clique no ÍCONE do United Copilot na barra do Chrome com a aba do Zoom aberta e tente Iniciar novamente.",
          );
        }

        await ensureOffscreen();

        let streamId;
        try {
          streamId = await getMediaStreamId(tab.id);
        } catch (e) {
          throw new Error(
            `chrome.tabCapture falhou: ${e.message}. Clique no ícone da extensão na barra do Chrome (com a aba do Zoom em foco) e tente novamente.`,
          );
        }

        await chrome.runtime.sendMessage({
          type: "OFFSCREEN_START",
          streamId,
          endpoint: msg.endpoint,
          etapa: msg.etapa || "rapport",
        });

        const { overlayMode } = await chrome.storage.local.get(["overlayMode"]);
        if (overlayMode === "compacto" || overlayMode === "ambos") {
          try {
            await injectOverlay(tab.id);
          } catch {
            /* overlay é opcional */
          }
        }

        sendResponse({ ok: true, tabTitle: tab.title || "aba ativa" });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "COPILOT_STOP") {
    (async () => {
      try {
        await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
      } catch {
        /* offscreen já encerrado */
      }
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});
