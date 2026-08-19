/**
 * United Copilot — pipeline de áudio (offscreen document).
 *
 * Aba do Zoom Web -> tabCapture -> PCM 16 kHz mono -> VAD por energia
 * -> WAV completo por turno de fala -> /api/public/transcribe
 * -> regra local (card instantâneo) -> /api/public/coach (refino da IA)
 */

const TARGET_RATE = 16000;
const SILENCE_MS = 550; // silêncio que fecha um turno de fala
const MIN_SPEECH_MS = 700; // fala mínima para valer a pena transcrever
const MAX_TURN_MS = 9000; // corta turnos muito longos para não estourar latência
const RMS_THRESHOLD = 0.008;

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
const turns = []; // histórico curto enviado à IA

function log(status, extra) {
  chrome.runtime.sendMessage({ type: "COPILOT_STATUS", status, ...extra }).catch(() => {});
}

function push(card) {
  chrome.runtime.sendMessage({ type: "COPILOT_CARD", card }).catch(() => {});
}

/* ---------- camada 1: detecção instantânea por padrões ---------- */

const RULES = [
  ["financeiro", [/\b(caro|pre[çc]|valor|invest|or[çc]ament|dinheiro|grana|desconto|parcel|condi[çc])\w*/i, /n[ãa]o tenho (esse|como|dinheiro|verba)/i]],
  ["tempo", [/n[ãa]o (tenho|teria) tempo/i, /\b(corrid[oa]|sem tempo|agenda cheia|mais pra frente|ano que vem)\w*/i, /agora n[ãa]o [ée] (o|um bom) momento/i]],
  ["pensar", [/preciso pensar/i, /vou pensar/i, /pensar (a respeito|com calma|melhor)/i, /depois eu (te )?(retorno|aviso|falo)/i]],
  ["segunda_opiniao", [/(minha|meu) (esposa|marido|s[óo]ci[ao]|companheir[ao]|chefe|gestor)/i, /preciso (consultar|alinhar|conversar com)/i, /n[ãa]o decido sozinh/i]],
  ["metodologia", [/como (funciona|que funciona|seria)/i, /qual (a|é a) (metodologia|m[ée]todo|din[âa]mica)/i, /\b(quanto tempo dura|garantia|funciona mesmo)\w*/i]],
  ["interesse", [/\b(gostei|interessante|faz sentido|adorei|curti)\b/i, /era isso que eu (precisava|queria)/i]],
  ["intencao_compra", [/como (eu )?(fa[çc]o|posso) (para|pra) (come[çc]ar|contratar)/i, /\b(quero come[çc]ar|vamos fechar|onde (eu )?assino|manda o link)\b/i]],
  ["fechamento", [/pr[óo]ximo passo/i, /fech(ado|amos)\b/i]],
];

const FALLBACKS = {
  financeiro: { rotulo: "Objeção financeira", nivel: "alerta", orientacao: "Isole antes de oferecer condição.", frase: "Se o investimento não fosse uma questão, você começaria hoje?" },
  tempo: { rotulo: "Objeção de tempo", nivel: "alerta", orientacao: "Tempo é prioridade. Descubra o que vem antes.", frase: "O que hoje está na frente disso na sua lista de prioridades?" },
  pensar: { rotulo: "Adiamento de decisão", nivel: "alerta", orientacao: "Descubra o que ainda impede a decisão.", frase: "Claro. O que especificamente você ainda precisa avaliar antes de decidir?" },
  segunda_opiniao: { rotulo: "Terceiro decisor", nivel: "alerta", orientacao: "Descubra o papel real do terceiro.", frase: "Se ela disser sim, você começa? O que ela precisaria ouvir?" },
  metodologia: { rotulo: "Dúvida de metodologia", nivel: "atencao", orientacao: "Responda curto e volte ao diagnóstico.", frase: "Te explico em um minuto — e por que isso é importante pra você?" },
  interesse: { rotulo: "Sinal de interesse", nivel: "positivo", orientacao: "Aprofunde e amarre com as palavras dele.", frase: "O que exatamente nisso mais fez sentido pra sua situação?" },
  intencao_compra: { rotulo: "Intenção de compra", nivel: "positivo", orientacao: "Pare de vender. Avance para o próximo passo.", frase: "Perfeito. Vamos garantir sua vaga agora — te passo os detalhes." },
  fechamento: { rotulo: "Momento de fechar", nivel: "positivo", orientacao: "Convite direto, sem rodeio.", frase: "Faz sentido a gente começar hoje?" },
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

/* ---------- pipeline ---------- */

async function processTurn(chunks, speechEndAt, vadDetectedAt) {
  // t = tempo medido a partir do FIM REAL da fala do cliente
  const t = (ts) => Math.round((ts ?? performance.now()) - speechEndAt);

  const timing = {
    vad: Math.round(vadDetectedAt - speechEndAt),
    prep: 0,
    upload: 0,
    stt: 0,
    classificacao: 0,
    ia: 0,
    primeiroAlerta: null,
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
    const res = await fetch(`${endpoint}/api/public/transcribe`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    text = (data.text || "").trim();
    const roundTrip = Math.round(performance.now() - sttStart);
    timing.stt = Math.min(roundTrip, data.sttMs ?? roundTrip);
    timing.upload = Math.max(0, roundTrip - timing.stt);
  } catch (e) {
    log("erro", { error: `Transcrição: ${e.message}` });
    return;
  }

  if (!text || text.length < 4) { log("ouvindo"); emit(); return; }

  chrome.runtime.sendMessage({ type: "COPILOT_TRANSCRIPT", text, ms: t() }).catch(() => {});

  // Camada 1 — card imediato (regra local)
  const classStart = performance.now();
  const quick = detect(text);
  timing.classificacao = Math.round(performance.now() - classStart);
  if (quick) {
    timing.primeiroAlerta = t();
    push({ ...quick, fonte: "regra", ms: timing.primeiroAlerta });
  }
  emit();

  turns.push({ speaker: "cliente", text });
  while (turns.length > 4) turns.shift();

  // Camada 2 — refino pela IA (só quando há gatilho ou fala relevante)
  if (!quick && text.split(/\s+/).length < 6) { log("ouvindo"); return; }

  const iaStart = performance.now();
  try {
    const res = await fetch(`${endpoint}/api/public/coach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns }),
    });
    const card = await res.json();
    timing.ia = Math.round(performance.now() - iaStart);
    if (res.ok && card.tipo && card.tipo !== "nenhum") {
      timing.total = t();
      if (timing.primeiroAlerta == null) timing.primeiroAlerta = timing.total;
      push({ ...card, ms: timing.total });
    }
    emit();
  } catch (e) {
    log("erro", { error: `IA: ${e.message}` });
  }
  log("ouvindo");
}

function flush(speechEndAt) {
  if (!buffer.length) return;
  const chunks = buffer;
  buffer = [];
  processTurn(chunks, speechEndAt ?? performance.now(), performance.now());
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
      if (!speaking) { speaking = true; speechStartedAt = now; log("falando"); }
      lastVoiceAt = now;
      buffer.push(downsample(input, audioCtx.sampleRate));
    } else if (speaking) {
      buffer.push(downsample(input, audioCtx.sampleRate));
      if (now - lastVoiceAt > SILENCE_MS) {
        speaking = false;
        if (now - speechStartedAt >= MIN_SPEECH_MS) flush();
        else buffer = [];
      }
    }

    if (speaking && now - speechStartedAt > MAX_TURN_MS) {
      speaking = false;
      flush();
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
  try { processor?.disconnect(); source?.disconnect(); } catch {}
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close().catch(() => {});
  audioCtx = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OFFSCREEN_START") {
    start(msg.streamId, msg.endpoint).catch((e) => log("erro", { error: e.message }));
  }
  if (msg?.type === "OFFSCREEN_STOP") stop();
});
