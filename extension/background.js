chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capturar e processar o áudio da aba da reunião.",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "COPILOT_START") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error("Nenhuma aba ativa encontrada.");
        await ensureOffscreen();
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        await chrome.runtime.sendMessage({
          type: "OFFSCREEN_START",
          streamId,
          endpoint: msg.endpoint,
        });
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
