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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // espelha os cards no overlay compacto (modo teleprompter)
  if (msg?.type === "COPILOT_CARD") toOverlay(msg);
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
