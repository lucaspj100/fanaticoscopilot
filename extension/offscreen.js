/**
 * United Copilot — pipeline de áudio (offscreen document).
 *
 * Aba do Zoom Web -> tabCapture -> PCM 16 kHz mono -> VAD por energia
 * -> transcrição PARCIAL enquanto o cliente ainda fala (pré-classificação)
 * -> no fim da fala: card imediato (camada 1) + frase refinada pela IA (camada 2).
 */

const TARGET_RATE = 16000;
const SILENCE_MS = 380; // silêncio que fecha um turno de fala (mais curto = alerta mais cedo)
const MIN_SPEECH_MS = 600; // fala mínima para valer a pena transcrever
const MAX_TURN_MS = 9000; // corta turnos muito longos para não estourar latência
const RMS_THRESHOLD = 0.008;
const PARTIAL_EVERY_MS = 1100; // envia parcial enquanto a pessoa fala

let audioCtx = null;
let stream = null;
let processor = null;
let source = null;
let endpoint = "";
let running = false;

let buffer = [];
let speaking = false;
let lastVoiceAt = 0;
let speechStartedAt = 0;
let lastPartialAt = 0;
let partialInFlight = false;
let preAlertTipo = null; // situação já alertada pela parcial deste turno
let preAlertAt = null;
/** Cada fala completa reconhecida recebe um turnId incremental.
 *  O card pertence a um TURNO, nunca a uma janela de tempo. */
let turnSeq = 0;
let currentTurnId = 0;
const turns = []; // histórico curto enviado à IA

/* ---------- etapa manual + memória viva da call ---------- */

const MEMORIA_VAZIA = {
  etapaAtual: "rapport",
  objetivo: null,
  problema: null,
  implicacao: null,
  necessidade: null,
  criterioCompra: [],
  pontosQueGostou: [],
  objecoes: [],
  sinaisCompra: [],
  informacoesImportantes: [],
  ultimaInteracao: null,
};

let etapaManual = "rapport"; // fonte da verdade — definida pelo vendedor
let memoria = { ...MEMORIA_VAZIA };
let memoriaAt = null;
let memoriaInFlight = false;

function resetSessao() {
  turns.length = 0;
  memoria = { ...MEMORIA_VAZIA, etapaAtual: etapaManual };
  memoriaAt = null;
  memoriaInFlight = false;
  preAlertTipo = null;
  preAlertAt = null;
  turnSeq = 0;
  currentTurnId = 0;
  emitMemoria([]);
}

function emitMemoria(alterados) {
  chrome.runtime
    .sendMessage({ type: "COPILOT_MEMORY", memoria, alterados, at: memoriaAt, etapa: etapaManual })
    .catch(() => {});
}

/** Atualiza a memória em paralelo — nunca bloqueia o card principal. */
async function atualizarMemoria(text) {
  if (memoriaInFlight) return;
  memoriaInFlight = true;
  try {
    const data = await apiFetch("/api/public/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoria, text, etapa: etapaManual }),
    });
    if (data?.memoria) {
      memoria = { ...data.memoria, etapaAtual: etapaManual };
      memoriaAt = Date.now();
      emitMemoria(data.alterados || []);
    }
  } catch {
    /* memória é best-effort */
  } finally {
    memoriaInFlight = false;
  }
}

function log(status, extra) {
  chrome.runtime.sendMessage({ type: "COPILOT_STATUS", status, ...extra }).catch(() => {});
}

function push(card, turnId) {
  chrome.runtime
    .sendMessage({ type: "COPILOT_CARD", turnId, card: { ...card, etapa: etapaManual, turnId } })
    .catch(() => {});
}


/* ---------- camada 1: detecção instantânea por padrões ---------- */

const RULES = [
  ["fechou", [/\b(vamos fechar|bora fechar|quero (come[çc]ar|fechar|me matricular)|fechado|t[ôo] dentro|me matricula)\b/i, /\b(sim,? (vamos|quero|pode))\b/i]],
  ["intencao_compra", [/como (eu )?(fa[çc]o|posso) (para|pra) (come[çc]ar|contratar|assinar)/i, /\b(manda o link|onde (eu )?assino|qual o pr[óo]ximo passo)\b/i]],
  ["pensar", [/preciso pensar/i, /vou pensar/i, /pensar (a respeito|com calma|melhor)/i, /depois eu (te )?(retorno|aviso|falo)/i]],
  ["financeiro", [/\b(caro|pre[çc]o|valor|invest|or[çc]ament|dinheiro|grana|desconto|parcel|condi[çc])\w*/i, /n[ãa]o tenho (esse|como|dinheiro|verba)/i]],
  ["segunda_opiniao", [/(minha|meu) (esposa|marido|s[óo]ci[ao]|companheir[ao]|chefe|gestor)/i, /preciso (consultar|alinhar|conversar com)/i, /n[ãa]o decido sozinh/i]],
  ["tempo", [/n[ãa]o (tenho|teria|vou ter) tempo/i, /\b(corrid[oa]|sem tempo|agenda cheia|mais pra frente|ano que vem)\w*/i, /agora n[ãa]o [ée] (o|um bom) momento/i]],
  ["metodologia", [/como (funciona|que funciona|seria)/i, /qual (a|é a) (metodologia|m[ée]todo|din[âa]mica)/i, /\b(quanto tempo dura|garantia|funciona mesmo)\w*/i]],
  ["interesse", [/\b(gostei|interessante|faz sentido|adorei|curti)\b/i, /era isso que eu (precisava|queria)/i]],
  ["aprofunde_objetivo", [/\b(ganhar|receber|faturar|sal[áa]rio) em (d[óo]lar|euro|moeda)/i, /\b(trabalhar|morar|viajar) (fora|no exterior|nos eua)/i, /\bquero (ganhar|conquistar|chegar|alcan[çc]ar)\b/i]],
  ["falta_problema", [/\b(progredir|crescer|evoluir|avan[çc]ar|subir) (na|de|no) (carreira|cargo|n[íi]vel|empresa)/i, /\b(quest[ãa]o|motivo|lado) profissional\b/i, /\b(melhorar|crescer|evoluir) profissionalmente\b/i, /\b(promo[çc][ãa]o|pr[óo]ximo n[íi]vel|mudar de [áa]rea)\b/i]],
  ["aprofunde", [/\b(pra|para) (minha|a minha) (carreira|profiss[ãa]o|vida)\b/i, /\b(quero|preciso) (aprender|falar|melhorar) (o )?ingl[êe]s\b/i]],
];

const FALLBACKS = {
  fechou: { rotulo: "FECHOU", nivel: "positivo", orientacao: "Pare de argumentar e avance para a matrícula.", etapa: "fechamento" },
  intencao_compra: { rotulo: "SINAL DE COMPRA", nivel: "positivo", orientacao: "Pare de apresentar. Peça a decisão.", etapa: "fechamento" },
  pensar: { rotulo: "PRECISA PENSAR", nivel: "alerta", orientacao: "Descubra a trava real antes de responder." },
  financeiro: { rotulo: "FINANCEIRO", nivel: "alerta", orientacao: "Isole antes de negociar. Sem desconto.", etapa: "fechamento" },
  segunda_opiniao: { rotulo: "SEGUNDA OPINIÃO", nivel: "aviso", orientacao: "Descubra o papel real dessa pessoa na decisão." },
  tempo: { rotulo: "TEMPO", nivel: "aviso", orientacao: "Entenda se é agenda real ou medo de não dar conta." },
  metodologia: { rotulo: "METODOLOGIA", nivel: "atencao", orientacao: "Entenda a expectativa antes de defender o método." },
  interesse: { rotulo: "INTERESSE", nivel: "positivo", orientacao: "Aprofunde com as palavras dele." },
  aprofunde_objetivo: { rotulo: "APROFUNDE O OBJETIVO", nivel: "atencao", orientacao: "Transforme o objetivo em algo concreto.", etapa: "spin" },
  falta_problema: { rotulo: "FALTA PROBLEMA", nivel: "atencao", orientacao: "Descubra o que hoje impede esse avanço.", etapa: "spin" },
  aprofunde: { rotulo: "APROFUNDE", nivel: "atencao", orientacao: "A resposta ainda está superficial." },
};

function detect(text) {
  for (const [tipo, patterns] of RULES) {
    for (const p of patterns) if (p.test(text)) return { tipo, ...FALLBACKS[tipo] };
  }
  return null;
}

/* ---------- WAV ---------- */

function encodeWav(chunks, sampleRate) {
  let length = 0;
  for (const c of chunks) length += c.length;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, "data"); view.setUint32(40, length * 2, true);
  let off = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, c[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

function downsample(input, fromRate) {
  if (fromRate === TARGET_RATE) return new Float32Array(input);
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

/* ---------- camada 1 antecipada: parcial enquanto o cliente fala ---------- */

async function sendPartial(chunks, turnId) {
  partialInFlight = true;
  try {
    const blob = encodeWav(chunks, TARGET_RATE);
    if (blob.size < 6000) return;
    const form = new FormData();
    form.append("file", blob, "recording.wav");
    const data = await apiFetch("/api/public/transcribe", { method: "POST", body: form });
    const text = (data.text || "").trim();
    // A parcial só vale para o turno que a originou.
    if (!text || !speaking || turnId !== currentTurnId) return;

    const quick = detect(text);
    if (quick && quick.tipo !== preAlertTipo) {
      preAlertTipo = quick.tipo;
      preAlertAt = performance.now();
      // Camada 1: tipo + orientação apenas. A frase vem depois, da IA.
      push({ ...quick, fonte: "regra", parcial: true, ms: 0 }, turnId);
      chrome.runtime
        .sendMessage({ type: "COPILOT_TRANSCRIPT", text, ms: 0, parcial: true, turnId })
        .catch(() => {});
    }
  } catch {
    /* parcial é best-effort: nunca quebra o turno */
  } finally {
    partialInFlight = false;
  }
}

/* ---------- pipeline do turno completo ---------- */

async function processTurn(chunks, speechEndAt, vadDetectedAt, turnId) {
  // t = tempo medido a partir do FIM REAL da fala do cliente
  const t = (ts) => Math.round((ts ?? performance.now()) - speechEndAt);

  const alertadoAntes = preAlertTipo;
  const preAlertaMs = preAlertAt != null ? Math.round(preAlertAt - speechEndAt) : null;
  preAlertTipo = null;
  preAlertAt = null;

  const timing = {
    vad: Math.round(vadDetectedAt - speechEndAt),
    prep: 0,
    upload: 0,
    stt: 0,
    classificacao: 0,
    ia: 0,
    primeiroAlerta: preAlertaMs != null ? Math.min(0, preAlertaMs) : null,
    total: null,
  };
  const emit = () => chrome.runtime.sendMessage({ type: "COPILOT_TIMING", timing: { ...timing } }).catch(() => {});

  const prepStart = performance.now();
  const blob = encodeWav(chunks, TARGET_RATE);
  if (blob.size < 4096) return;
  timing.prep = Math.round(performance.now() - prepStart);

  log("transcrevendo");

  let text = "";
  const sttStart = performance.now();
  try {
    const form = new FormData();
    form.append("file", blob, "recording.wav");
    const data = await apiFetch("/api/public/transcribe", { method: "POST", body: form });
    text = (data.text || "").trim();
    const roundTrip = Math.round(performance.now() - sttStart);
    timing.stt = Math.min(roundTrip, data.sttMs ?? roundTrip);
    timing.upload = Math.max(0, roundTrip - timing.stt);
  } catch (e) {
    log("erro", { error: `Transcrição: ${e.message}` });
    return;
  }

  if (!text || text.length < 4) { log("ouvindo"); emit(); return; }

  // Transcrição COMPLETA: encerra o turno anterior imediatamente na UI.
  chrome.runtime.sendMessage({ type: "COPILOT_TRANSCRIPT", text, ms: t(), turnId, final: true }).catch(() => {});

  // Camada 1 — card imediato (regra local), se ainda não apareceu na parcial
  const classStart = performance.now();
  const quick = detect(text);
  timing.classificacao = Math.round(performance.now() - classStart);
  if (quick && quick.tipo !== alertadoAntes) {
    if (timing.primeiroAlerta == null) timing.primeiroAlerta = t();
    push({ ...quick, fonte: "regra", ms: t() }, turnId);
  } else if (quick && alertadoAntes === quick.tipo) {
    // o card da parcial deste mesmo turno continua válido — reemite com o turnId final
    push({ ...quick, fonte: "regra", ms: t() }, turnId);
  }
  emit();

  turns.push({ speaker: "cliente", text });
  while (turns.length > 4) turns.shift();

  // Memória viva: roda EM PARALELO, não atrasa o card.
  atualizarMemoria(text);

  // Camada 2 — a IA gera SOMENTE a melhor frase e atualiza o mesmo card
  if (!quick && text.split(/\s+/).length < 4) {
    chrome.runtime.sendMessage({ type: "COPILOT_DECISION", turnId, decision: { decisao: "NO_TRIGGER_DETECTED", motivo: "fala curta demais", text, etapa: etapaManual, turnId } }).catch(() => {});
    log("ouvindo");
    return;
  }

  const iaStart = performance.now();
  try {
    const card = await apiFetch("/api/public/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turns,
        tipo: quick?.tipo,
        etapa: etapaManual,
        etapaManual,
        memoria,
      }),
    });

    timing.ia = Math.round(performance.now() - iaStart);
    chrome.runtime
      .sendMessage({
        type: "COPILOT_DECISION",
        turnId,
        decision: {
          decisao: card.decisao || (card.tipo === "nenhum" ? "NO_TRIGGER_DETECTED" : "REGRA_LOCAL"),
          tipo: card.tipo,
          etapa: etapaManual,
          orientacao: card.orientacao,
          frase: card.frase,
          confianca: card.confianca,
          aviso: card.aviso,
          etapaManual,
          memoriaAt,
          turnId,
          debug: card.debug,
        },

      })
      .catch(() => {});
    if (card.tipo && card.tipo !== "nenhum") {
      timing.total = t();
      if (timing.primeiroAlerta == null) timing.primeiroAlerta = timing.total;
      push({ ...card, ms: timing.total }, turnId);
    }
    emit();
  } catch (e) {
    log("erro", { error: `IA: ${e.message}` });
  }
  log("ouvindo");
}


// ---- Diagnóstico de rede ----
function netReport(info) {
  chrome.runtime.sendMessage({ type: "COPILOT_NET", net: info }).catch(() => {});
}

async function apiFetch(path, init) {
  const url = `${endpoint}${path}`;
  const method = init.method || "POST";
  const started = performance.now();
  try {
    const res = await fetch(url, init);
    const ms = Math.round(performance.now() - started);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    netReport({ url, method, status: res.status, ok: res.ok, ms, error: res.ok ? null : (body?.error || `HTTP ${res.status}`) });
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body ?? {};
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    const isNetwork = e instanceof TypeError || /Failed to fetch|NetworkError/i.test(e.message);
    if (isNetwork) {
      netReport({ url, method, status: null, ok: false, ms, error: e.message, kind: "rede/CORS" });
      throw new Error(`Rede/CORS: ${url} inacessível (${e.message}). Confira host_permissions e a URL do servidor.`);
    }
    throw e;
  }
}

function flush(speechEndAt) {
  if (!buffer.length) return;
  const chunks = buffer;
  buffer = [];
  processTurn(chunks, speechEndAt ?? performance.now(), performance.now(), currentTurnId);
}


async function start(streamId, ep) {
  endpoint = String(ep || "").replace(/\/+$/, "");
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });

  audioCtx = new AudioContext();
  source = audioCtx.createMediaStreamSource(stream);
  // Devolve o áudio para os alto-falantes — sem isso a aba fica muda.
  source.connect(audioCtx.destination);

  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!running) return;
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const now = performance.now();

    if (rms > RMS_THRESHOLD) {
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        lastPartialAt = now;
        preAlertTipo = null;
        preAlertAt = null;
        // nova fala = novo turno
        currentTurnId = ++turnSeq;
        chrome.runtime.sendMessage({ type: "COPILOT_TURN_START", turnId: currentTurnId }).catch(() => {});
        log("falando");
      }
      lastVoiceAt = now;
      buffer.push(downsample(input, audioCtx.sampleRate));
    } else if (speaking) {
      buffer.push(downsample(input, audioCtx.sampleRate));
      if (now - lastVoiceAt > SILENCE_MS) {
        speaking = false;
        // fim real da fala = último frame com voz
        if (lastVoiceAt - speechStartedAt >= MIN_SPEECH_MS) flush(lastVoiceAt);
        else buffer = [];
      }
    }

    // Streaming: manda o que já foi falado, sem esperar o fim da fala.
    if (speaking && !partialInFlight && now - lastPartialAt > PARTIAL_EVERY_MS && now - speechStartedAt > 900) {
      lastPartialAt = now;
      sendPartial(buffer.slice(), currentTurnId);
    }

    if (speaking && now - speechStartedAt > MAX_TURN_MS) {
      speaking = false;
      flush(now);
    }

  };

  source.connect(processor);
  processor.connect(audioCtx.destination);
  running = true;
  log("ouvindo");
}

function stop() {
  running = false;
  speaking = false;
  buffer = [];
  preAlertTipo = null;
  partialInFlight = false;
  try { processor?.disconnect(); source?.disconnect(); } catch {}
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close().catch(() => {});
  audioCtx = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OFFSCREEN_START") {
    // Nova sessão de call: zera memória, histórico e cards.
    etapaManual = msg.etapa || "rapport";
    resetSessao();
    start(msg.streamId, msg.endpoint).catch((e) => log("erro", { error: e.message }));
  }
  if (msg?.type === "OFFSCREEN_STOP") stop();
  if (msg?.type === "COPILOT_ETAPA" && msg.etapa) {
    etapaManual = msg.etapa;
    memoria.etapaAtual = etapaManual;
  }

});
