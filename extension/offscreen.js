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
  diStatus: "nao_apresentada",
  diMotivoResistencia: null,
  diCriteriosParaDecidir: [],
  spinStatus: "nao_iniciado",
  spinObjetivo: null,
  spinProblema: null,
  spinImplicacoes: [],
  spinNecessidade: null,
  spinPerguntasJaExploradas: [],
  // Mapa vivo do cliente (V2.6) — preenchido pelo /api/public/memory.
  mapa: {},
};

let etapaManual = "rapport"; // fonte da verdade — definida pelo vendedor
const novaMemoria = () => JSON.parse(JSON.stringify(MEMORIA_VAZIA));
let memoria = novaMemoria();
let memoriaAt = null;
let memoriaInFlight = false;
let sugestoesAnteriores = []; // últimas frases sugeridas — evita repetir pergunta

function resetSessao() {
  turns.length = 0;
  memoria = { ...novaMemoria(), etapaAtual: etapaManual };
  memoriaAt = null;
  memoriaInFlight = false;
  sugestoesAnteriores = [];
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

/** Fila de memória: nenhuma fala é perdida se outra atualização estiver em voo. */
const memoriaFila = [];

/** Atualiza a memória em paralelo — nunca bloqueia o card principal. */
async function atualizarMemoria(text) {
  if (!text) return;
  memoriaFila.push(text);
  if (memoriaInFlight) return;
  memoriaInFlight = true;
  try {
    while (memoriaFila.length) {
      const proximo = memoriaFila.shift();
      try {
        const data = await apiFetch("/api/public/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memoria, text: proximo, etapa: etapaManual }),
        });
        if (data?.memoria) {
          memoria = { ...data.memoria, etapaAtual: etapaManual };
          memoriaAt = Date.now();
          if (typeof tel === "object") {
            tel.memoryUpdates++;
            tel.lastMemoryAt = memoriaAt;
          }
          emitMemoria(data.alterados || []);
        }
      } catch {
        /* memória é best-effort */
      }
    }
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
  ["financeiro", [/\b(muito |bem |t[áa] |est[áa] |ficou |achei )?caro\b/i, /\b(salgado|pesad[oa]|fora da minha realidade)\b/i, /n[ãa]o (tenho|teria|consigo) (esse |o )?(valor|dinheiro|verba|condi[çc][ãa]o|grana)/i, /fora do (meu )?(or[çc]amento|budget|alcance)/i, /\b(desconto|abatimento|melhorar o valor)\b/i, /(valor|pre[çc]o|mensalidade|investimento)\b[^.]{0,40}\b(alto|elevado|acima|puxad[oa]|caro)\b/i]],
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

/* Etapa D.I.: o objetivo é a Regra do Jogo. Assunto citado não sequestra a orientação. */
const DI_RULES = [
  ["di_pede_apresentacao", [/(me )?(apresent|mostr|explic)\w*\s+(como funciona|a proposta|o curso|voc[êe]s)/i, /\bquero (conhecer|entender) (voc[êe]s|a proposta|o curso)\b/i, /\bj[áa] (te )?(falei|disse|respondi)\b/i, /\bcomo eu (te )?(disse|falei)\b/i]],
  ["di_resistencia", [/n[ãa]o vou (dar|te dar) (nenhum )?(posicionamento|resposta|retorno)/i, /n[ãa]o (vou|consigo) decidir (hoje|agora|na hora)/i, /n[ãa]o tomo decis[ãa]o (na hora|assim|hoje|agora)/i, /n[ãa]o (fecho|assino|decido) (nada )?(na primeira|hoje|agora|no impulso)/i]],
  ["di_comparacao", [/\b(outras|outra) (escolas?|op[çc][õo]es|cursos?)\b/i, /\b(comparar|compara[çc][ãa]o|comparativo|pesquisar|or[çc]ar)\b/i, /colocar (tudo )?no papel/i]],
  ["di_criterios", [/\b(preciso|quero|gostaria de) (entender|saber|verificar|ver|analisar|conhecer)\b/i, /\b(depende|vai depender) (de|do|da)\b/i]],
  ["di_estabelecida", [/\b(te dou|dou) (um|o) (retorno|posicionamento|sim ou n[ãa]o)\b/i]],
];

const DI_FALLBACKS = {
  di_resistencia: { rotulo: "RESISTÊNCIA À D.I.", nivel: "alerta", orientacao: "Descubra por que ele não se posiciona no final.", etapa: "di" },
  di_criterios: { rotulo: "CRITÉRIOS DA DECISÃO", nivel: "atencao", orientacao: "Amarre esses pontos ao posicionamento final.", etapa: "di" },
  di_comparacao: { rotulo: "COMPARAÇÃO", nivel: "aviso", orientacao: "Teste a consequência disso para a decisão.", etapa: "di" },
  di_pede_apresentacao: { rotulo: "PEDE A APRESENTAÇÃO", nivel: "positivo", orientacao: "Pare de investigar. Alinhe a D.I. e avance.", etapa: "di" },
  di_estabelecida: { rotulo: "D.I. ESTABELECIDA", nivel: "positivo", orientacao: "Confirme em uma frase e siga a call.", etapa: "di" },
};

/* Etapa SPIN: progressão objetivo -> problema -> implicação -> necessidade. */
const SPIN_RULES = [
  ["spin_confirmacao", [/\b(perdi|deixei de|abri m[ãa]o|fiquei de fora|n[ãa]o consegui) \w+/i, /\b(me custou|atrasou minha|travou minha)\b/i]],
  ["spin_implicacao", [/\b(travo|trava|congelo|gaguejo|me perco|n[ãa]o consigo (falar|responder|acompanhar))\b/i, /\b(entendo|leio) mas n[ãa]o (falo|consigo falar)/i, /\bmeu ingl[êe]s [ée] (b[áa]sico|fraco|ruim|travado)\b/i]],
  ["spin_problema", [/\b(ganhar|receber|faturar|sal[áa]rio) em (d[óo]lar|euro|moeda)/i, /\b(trabalhar|morar|viajar) (fora|no exterior|nos eua)/i, /\b(promo[çc][ãa]o|pr[óo]ximo n[íi]vel|mudar de [áa]rea|crescer na carreira)\b/i, /\bquero (ganhar|conquistar|chegar|alcan[çc]ar|assumir)\b/i]],
  ["spin_objetivo", [/\b(quero|preciso) (aprender|falar|melhorar|destravar) (o )?ingl[êe]s\b/i, /\b(sempre quis|sempre tive vontade)\b/i, /\b(pra|para) (minha|a minha) (carreira|profiss[ãa]o|vida)\b/i]],
];

const SPIN_FALLBACKS = {
  spin_objetivo: { rotulo: "DESCUBRA O OBJETIVO", nivel: "atencao", orientacao: "Descubra o que ele quer conquistar com o inglês.", etapa: "spin" },
  spin_problema: { rotulo: "DESCUBRA O PROBLEMA", nivel: "atencao", orientacao: "Objetivo claro. Descubra o que hoje trava.", etapa: "spin" },
  spin_implicacao: { rotulo: "APROFUNDE A IMPLICAÇÃO", nivel: "atencao", orientacao: "Explore a consequência concreta desse problema.", etapa: "spin" },
  spin_confirmacao: { rotulo: "CONFIRME A NECESSIDADE", nivel: "atencao", orientacao: "Confirme com as palavras dele antes de avançar.", etapa: "spin" },
  spin_suficiente: { rotulo: "SPIN SUFICIENTE", nivel: "positivo", orientacao: "Você já tem material suficiente. Avance.", etapa: "spin" },
};

const OBJECOES_REAIS = new Set(["financeiro", "pensar", "segunda_opiniao", "tempo"]);

/** Minimização da dor: o cliente diminui o problema — nunca encerrar o SPIN aqui. */
const MINIMIZACAO_RE = /\b(n[ãa]o ligo (tanto|muito)|n[ãa]o me (incomoda|atrapalha) (tanto|muito)|pra mim (é|e) tranquilo|n[ãa]o (é|e) t[ãa]o importante|n[ãa]o tenho (tanta )?pressa|sem pressa|n[ãa]o chega a ser um problema|n[ãa]o faz tanta diferen[çc]a|tanto faz)\b/i;

/**
 * V2.7 — SPIN suficiente exige MATERIAL COMERCIAL, não campos preenchidos:
 * problema + impacto concreto + necessidade percebida (ou urgência/gatilho + intenção).
 */
function spinSuficiente(m) {
  const mapa = (m && m.mapa) || {};
  const alto = (k) => mapa[k] && mapa[k].estado === "respondido" && (mapa[k].profundidade || "baixa") !== "baixa";
  if (mapa.minimizacao && mapa.minimizacao.estado === "respondido" && !alto("impacto")) return false;
  const problema = alto("problema") || !!(m.spinProblema || m.problema);
  const impacto = alto("impacto") || alto("oportunidade_perdida");
  const necessidade = alto("necessidade") || !!(m.spinNecessidade || m.necessidade);
  const urgencia = alto("urgencia") || alto("gatilho_agora");
  const intencao = alto("sinais_compra") || alto("gatilho_agora");
  return (problema && impacto && necessidade) || (problema && urgencia && intencao);
}


const CRITICOS_SEMPRE = new Set(["fechou", "intencao_compra"]);

function matchRules(text, rules, fallbacks) {
  for (const [tipo, patterns] of rules) {
    for (const p of patterns) if (p.test(text)) return { tipo, ...fallbacks[tipo] };
  }
  return null;
}

function detect(text, etapa) {
  if (etapa === "di") {
    const critico = matchRules(text, RULES, FALLBACKS);
    if (critico && CRITICOS_SEMPRE.has(critico.tipo)) return critico;
    return matchRules(text, DI_RULES, DI_FALLBACKS);
  }
  if (etapa === "spin") {
    const critico = matchRules(text, RULES, FALLBACKS);
    if (critico && (CRITICOS_SEMPRE.has(critico.tipo) || OBJECOES_REAIS.has(critico.tipo))) return critico;
    // Cliente minimizou a dor: nunca encerrar o SPIN — aprofundar a implicação.
    if (MINIMIZACAO_RE.test(text)) {
      return {
        tipo: "spin_implicacao",
        ...SPIN_FALLBACKS.spin_implicacao,
        orientacao: "Ele minimizou. Peça um exemplo concreto e recente.",
      };
    }
    const sinal = matchRules(text, SPIN_RULES, SPIN_FALLBACKS);
    if (sinal && spinSuficiente(memoria) && sinal.tipo !== "spin_suficiente") {
      return { tipo: "spin_suficiente", ...SPIN_FALLBACKS.spin_suficiente };
    }
    return sinal;
  }

  return matchRules(text, RULES, FALLBACKS);
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

/* ============================================================
   V2.9 — TELEMETRIA DO PIPELINE DE ÁUDIO
   MIC/AUDIO SOURCE -> CHUNK -> VAD -> FIM DE FALA -> PREP -> UPLOAD
   -> STT -> TRANSCRIPT_FINAL -> MEMORY -> COACH
   ============================================================ */

const tel = {
  audioChunksReceived: 0,
  lastAudioChunkAt: null,
  vadSpeechStartCount: 0,
  vadSpeechEndCount: 0,
  sttRequestsStarted: 0,
  sttRequestsCompleted: 0,
  sttRequestsFailed: 0,
  transcriptFinalCount: 0,
  lastTranscriptAt: null,
  lastCoachDecisionAt: null,
  memoryUpdates: 0,
  lastMemoryAt: null,
  recoveries: 0,
  lastRecoveryAt: null,
  lastRecoveryError: null,
  startedAt: null,
};

function resetTelemetria() {
  Object.assign(tel, {
    audioChunksReceived: 0,
    lastAudioChunkAt: null,
    vadSpeechStartCount: 0,
    vadSpeechEndCount: 0,
    sttRequestsStarted: 0,
    sttRequestsCompleted: 0,
    sttRequestsFailed: 0,
    transcriptFinalCount: 0,
    lastTranscriptAt: null,
    lastCoachDecisionAt: null,
    memoryUpdates: 0,
    lastMemoryAt: null,
    recoveries: 0,
    lastRecoveryAt: null,
    lastRecoveryError: null,
    startedAt: Date.now(),
  });
}

function trackInfo() {
  const track = stream?.getAudioTracks?.()[0] || null;
  if (!track) return { present: false, readyState: null, muted: null, enabled: null };
  return { present: true, readyState: track.readyState, muted: track.muted, enabled: track.enabled };
}

function pipelineHealth(extra) {
  const now = Date.now();
  const sttPending = Math.max(0, tel.sttRequestsStarted - tel.sttRequestsCompleted - tel.sttRequestsFailed);
  return {
    at: now,
    running,
    audio: {
      ...tel,
      sttPending,
      msSinceChunk: tel.lastAudioChunkAt ? now - tel.lastAudioChunkAt : null,
      msSinceTranscript: tel.lastTranscriptAt ? now - tel.lastTranscriptAt : null,
      msSinceDecision: tel.lastCoachDecisionAt ? now - tel.lastCoachDecisionAt : null,
    },
    audioContext: audioCtx ? audioCtx.state : null,
    track: trackInfo(),
    turnos: {
      currentTurnId,
      nextExpectedTurnId: nextExpected,
      lastCommittedTurnId: lastCommitted,
      pendentes: pendingTurns.size,
    },
    ...(extra || {}),
  };
}

function emitHealth(extra) {
  chrome.runtime.sendMessage({ type: "COPILOT_HEALTH", health: pipelineHealth(extra) }).catch(() => {});
}

/* ============================================================
   COMMIT ORDENADO DOS TURNOS
   O STT pode terminar fora de ordem (turn 3 antes do turn 2).
   A memória e o coach SEMPRE avançam em ordem cronológica.
   ============================================================ */

const pendingTurns = new Map(); // turnId -> resultado do STT
const skippedTurns = new Set(); // turnos que nunca produzirão resultado
let nextExpected = 1;
let lastCommitted = 0;
let recSeq = 0;

function resetFila() {
  pendingTurns.clear();
  skippedTurns.clear();
  nextExpected = 1;
  lastCommitted = 0;
  recSeq = 0;
}

function skipTurn(turnId) {
  if (turnId < nextExpected) return;
  skippedTurns.add(turnId);
  drainTurns();
}

function pushTurnResult(result) {
  if (result.turnId < nextExpected) return; // duplicata de turno já commitado
  pendingTurns.set(result.turnId, result);
  drainTurns();
}

function drainTurns() {
  for (;;) {
    if (skippedTurns.has(nextExpected)) {
      skippedTurns.delete(nextExpected);
      nextExpected++;
      continue;
    }
    const hit = pendingTurns.get(nextExpected);
    if (!hit) break;
    pendingTurns.delete(nextExpected);
    lastCommitted = nextExpected;
    nextExpected++;
    commitTurn(hit);
  }
}

/** Destrava a fila quando um turno anterior nunca chegou (STT perdido). */
function forceDrain() {
  const ids = [...pendingTurns.keys()].sort((a, b) => a - b);
  if (!ids.length) return;
  for (let id = nextExpected; id < ids[0]; id++) skippedTurns.add(id);
  drainTurns();
}

/* ---------- falas curtas contextuais ---------- */

const RESPOSTA_CURTA_RE =
  /^(sim|n[ãa]o|isso|exato|exatamente|com certeza|certeza|claro|virou|[ée]|[ée] isso|muito|bastante|hoje sim|agora sim|total|totalmente|pode ser|talvez|acho que sim|acho que n[ãa]o|uhum|aham|perfeito|verdade|demais|sempre|nunca|[ée] uma necessidade|necessidade|obviamente|sem d[úu]vida)$/i;

/** Fala curta NUNCA é descartada pela memória quando responde ao contexto anterior. */
function avaliarFalaCurta(text, contextoAnterior) {
  const limpo = (text || "").trim();
  const palavras = limpo ? limpo.split(/\s+/).length : 0;
  const curta = palavras < 4;
  if (!curta) return { curta: false, contextual: false, textoParaMemoria: limpo };
  const ctx = (contextoAnterior || "").trim();
  const contextual = !!ctx;
  return {
    curta: true,
    contextual,
    respostaDireta: RESPOSTA_CURTA_RE.test(limpo.replace(/[.,!?]+$/, "")),
    textoParaMemoria: contextual ? `${ctx} → (cliente) ${limpo}` : limpo,
  };
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

    const quick = detect(text, etapaManual);
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

/* ---------- STT do turno completo (pode terminar fora de ordem) ---------- */

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

  const prepStart = performance.now();
  const blob = encodeWav(chunks, TARGET_RATE);
  if (blob.size < 4096) {
    skipTurn(turnId);
    return;
  }
  timing.prep = Math.round(performance.now() - prepStart);

  log("transcrevendo");

  let text = "";
  const sttStart = performance.now();
  tel.sttRequestsStarted++;
  try {
    const form = new FormData();
    form.append("file", blob, "recording.wav");
    const data = await apiFetch("/api/public/transcribe", { method: "POST", body: form });
    text = (data.text || "").trim();
    const roundTrip = Math.round(performance.now() - sttStart);
    timing.stt = Math.min(roundTrip, data.sttMs ?? roundTrip);
    timing.upload = Math.max(0, roundTrip - timing.stt);
    tel.sttRequestsCompleted++;
  } catch (e) {
    tel.sttRequestsFailed++;
    log("erro", { error: `Transcrição: ${e.message}` });
    skipTurn(turnId); // não trava a fila do próximo turno
    emitHealth({ ultimoErro: `stt: ${e.message}` });
    return;
  }

  if (!text || text.length < 2) {
    skipTurn(turnId);
    log("ouvindo");
    return;
  }

  // Entra na fila de commit: só avança quando os turnos anteriores foram commitados.
  pushTurnResult({ turnId, text, timing, alertadoAntes, speechEndAt, t });
}

/* ---------- commit do turno: transcript_final -> memória -> coach ---------- */

function commitTurn({ turnId, text, timing, alertadoAntes, t }) {
  tel.transcriptFinalCount++;
  tel.lastTranscriptAt = Date.now();

  const contextoAnterior = turns.length ? turns[turns.length - 1].text : null;
  const curta = avaliarFalaCurta(text, contextoAnterior);

  // Transcrição COMPLETA: encerra o turno anterior imediatamente na UI.
  chrome.runtime
    .sendMessage({ type: "COPILOT_TRANSCRIPT", text, ms: t(), turnId, final: true })
    .catch(() => {});

  // Camada 1 — card imediato (regra local), se ainda não apareceu na parcial
  const classStart = performance.now();
  const quick = detect(text, etapaManual);
  timing.classificacao = Math.round(performance.now() - classStart);
  const emit = () =>
    chrome.runtime.sendMessage({ type: "COPILOT_TIMING", turnId, timing: { ...timing } }).catch(() => {});
  if (quick) {
    if (timing.primeiroAlerta == null && quick.tipo !== alertadoAntes) timing.primeiroAlerta = t();
    push({ ...quick, fonte: "regra", ms: t() }, turnId);
  }
  emit();

  turns.push({ speaker: "cliente", text });
  while (turns.length > 6) turns.shift();

  // Memória viva SEMPRE roda — inclusive em fala curta contextual.
  atualizarMemoria(curta.curta && curta.contextual ? curta.textoParaMemoria : text);

  // Fala curta sem contexto anterior e sem sinal local: não vale chamar a IA.
  if (!quick && curta.curta && !curta.contextual) {
    chrome.runtime
      .sendMessage({
        type: "COPILOT_DECISION",
        turnId,
        decision: {
          decisao: "NO_TRIGGER_DETECTED",
          motivo: "fala curta sem contexto anterior",
          text,
          etapa: etapaManual,
          turnId,
        },
      })
      .catch(() => {});
    log("ouvindo");
    return;
  }

  callCoach({ turnId, text, quick, timing, t, curta });
}

async function callCoach({ turnId, text, quick, timing, t, curta }) {
  const iaStart = performance.now();
  const sequence = ++recSeq;
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
        falaCurtaContextual: curta?.curta && curta?.contextual ? curta.textoParaMemoria : null,
        sugestoesAnteriores: [...sugestoesAnteriores],
      }),
    });

    timing.ia = Math.round(performance.now() - iaStart);
    tel.lastCoachDecisionAt = Date.now();
    chrome.runtime
      .sendMessage({
        type: "COPILOT_DECISION",
        turnId,
        sourceTurnId: turnId,
        recommendationSequence: sequence,
        createdAt: Date.now(),
        decision: {
          decisao: card.decisao || (card.tipo === "nenhum" ? "NO_TRIGGER_DETECTED" : "REGRA_LOCAL"),
          tipo: card.tipo,
          etapa: etapaManual,
          orientacao: card.orientacao,
          frase: card.frase,
          porque: card.porque,
          acao: card.acao,
          lacunas: card.lacunas,
          confianca: card.confianca,
          aviso: card.aviso,
          etapaManual,
          memoriaAt,
          turnId,
          sourceTurnId: turnId,
          recommendationSequence: sequence,
          turnsEnviados: turns.map((x) => ({ speaker: x.speaker, text: x.text })),
          memoriaSnapshot: memoria,
          debug: card.debug,
        },
      })
      .catch(() => {});
    if (card.spinStatus) memoria.spinStatus = card.spinStatus;
    if (!Array.isArray(memoria.spinPerguntasJaExploradas)) memoria.spinPerguntasJaExploradas = [];
    if (card.eixo) {
      const eixo = String(card.eixo).toLowerCase();
      if (!memoria.spinPerguntasJaExploradas.some((x) => x.toLowerCase() === eixo)) {
        memoria.spinPerguntasJaExploradas.push(eixo);
        while (memoria.spinPerguntasJaExploradas.length > 6) memoria.spinPerguntasJaExploradas.shift();
      }
    }
    if (card.diStatus) {
      memoria.diStatus = card.diStatus;
      chrome.runtime
        .sendMessage({ type: "COPILOT_MEMORY", memoria, alterados: ["diStatus"], at: Date.now(), etapa: etapaManual })
        .catch(() => {});
    }
    if (card.frase) {
      sugestoesAnteriores.push(card.frase);
      while (sugestoesAnteriores.length > 3) sugestoesAnteriores.shift();
    }
    if (card.tipo && card.tipo !== "nenhum") {
      timing.total = t();
      if (timing.primeiroAlerta == null) timing.primeiroAlerta = timing.total;
      push({ ...card, ms: timing.total, sourceTurnId: turnId, recommendationSequence: sequence }, turnId);
    }
    chrome.runtime.sendMessage({ type: "COPILOT_TIMING", turnId, timing: { ...timing } }).catch(() => {});
  } catch (e) {
    log("erro", { error: `IA: ${e.message}` });
  }
  log("ouvindo");
  void text;
}


// ---- Diagnóstico de rede ----
function netReport(info) {
  chrome.runtime.sendMessage({ type: "COPILOT_NET", net: info }).catch(() => {});
}

const FETCH_TIMEOUT_MS = 20000; // nenhuma requisição pode travar o pipeline para sempre

async function apiFetch(path, init) {
  const url = `${endpoint}${path}`;
  const method = init.method || "POST";
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const ms = Math.round(performance.now() - started);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    netReport({ url, method, status: res.status, ok: res.ok, ms, error: res.ok ? null : (body?.error || `HTTP ${res.status}`) });
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body ?? {};
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    if (e?.name === "AbortError") {
      netReport({ url, method, status: null, ok: false, ms, error: "timeout", kind: "timeout" });
      throw new Error(`Timeout de ${FETCH_TIMEOUT_MS} ms em ${path}`);
    }
    const isNetwork = e instanceof TypeError || /Failed to fetch|NetworkError/i.test(e.message);
    if (isNetwork) {
      netReport({ url, method, status: null, ok: false, ms, error: e.message, kind: "rede/CORS" });
      throw new Error(`Rede/CORS: ${url} inacessível (${e.message}). Confira host_permissions e a URL do servidor.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function flush(speechEndAt) {
  if (!buffer.length) return;
  const chunks = buffer;
  buffer = [];
  processTurn(chunks, speechEndAt ?? performance.now(), performance.now(), currentTurnId);
}


/* ============================================================
   WATCHDOG DA CAPTURA
   O botão em "Parar" NUNCA é prova de que o pipeline está vivo.
   ============================================================ */

const CHUNK_DEAD_MS = 5000; // sem nenhum callback de áudio = captura morta
const TRANSCRIPT_STALE_MS = 90000; // áudio fluindo, mas sem transcript_final
const RECOVER_COOLDOWN_MS = 15000;

let watchdogTimer = null;
let recoveringAt = 0;

async function recuperarCaptura(motivo) {
  const now = Date.now();
  if (recoveringAt && now - recoveringAt < RECOVER_COOLDOWN_MS) return;
  recoveringAt = now;
  tel.recoveries++;
  tel.lastRecoveryAt = now;
  emitHealth({ recuperando: motivo });
  log("recuperando", { motivo });
  try {
    const res = await chrome.runtime.sendMessage({ type: "COPILOT_RECAPTURE" });
    if (!res?.ok || !res.streamId) throw new Error(res?.error || "sem streamId");
    teardownAudio();
    // MEMÓRIA COMERCIAL PRESERVADA — só o pipeline de áudio é reconstruído.
    await start(res.streamId, endpoint, { preservarSessao: true });
    tel.lastRecoveryError = null;
    emitHealth({ recuperado: motivo });
  } catch (e) {
    tel.lastRecoveryError = e?.message || String(e);
    log("erro", { error: `Captura interrompida e não foi possível recuperar: ${tel.lastRecoveryError}` });
    emitHealth({ falhaRecuperacao: tel.lastRecoveryError });
  }
}

function watchdogTick() {
  if (!running) return;
  const now = Date.now();

  // AudioContext suspenso mata o onaudioprocess silenciosamente.
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

  const track = stream?.getAudioTracks?.()[0] || null;
  const trackMorta = !track || track.readyState !== "live";
  const semChunk = tel.lastAudioChunkAt != null && now - tel.lastAudioChunkAt > CHUNK_DEAD_MS;
  const nuncaRecebeuChunk = tel.lastAudioChunkAt == null && tel.startedAt && now - tel.startedAt > CHUNK_DEAD_MS;

  if (trackMorta || semChunk || nuncaRecebeuChunk) {
    recuperarCaptura(trackMorta ? "track encerrada" : "sem chunks de áudio");
    return;
  }

  // Áudio fluindo, VAD detectando falas, mas nada vira transcript_final.
  const refTranscript = tel.lastTranscriptAt || tel.startedAt;
  if (tel.vadSpeechEndCount > tel.transcriptFinalCount && now - refTranscript > TRANSCRIPT_STALE_MS) {
    forceDrain(); // fila travada por um turno que nunca chegou
    emitHealth({ alerta: "áudio fluindo sem transcript_final" });
  }

  emitHealth();
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(watchdogTick, 2000);
}

function stopWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

function teardownAudio() {
  try { processor?.disconnect(); source?.disconnect(); } catch {}
  if (processor) processor.onaudioprocess = null;
  stream?.getTracks().forEach((tr) => tr.stop());
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  processor = null;
  source = null;
  stream = null;
  speaking = false;
  buffer = [];
  partialInFlight = false;
}

async function start(streamId, ep, { preservarSessao = false } = {}) {
  endpoint = String(ep || endpoint || "").replace(/\/+$/, "");
  if (!preservarSessao) {
    resetTelemetria();
    resetFila();
  } else {
    tel.startedAt = Date.now();
    tel.lastAudioChunkAt = null;
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });

  const track = stream.getAudioTracks()[0];
  if (track) {
    track.addEventListener("ended", () => {
      emitHealth({ evento: "track ended" });
      if (running) recuperarCaptura("track ended");
    });
    track.addEventListener("mute", () => emitHealth({ evento: "track mute" }));
    track.addEventListener("unmute", () => emitHealth({ evento: "track unmute" }));
  }

  audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  source = audioCtx.createMediaStreamSource(stream);
  // Devolve o áudio para os alto-falantes — sem isso a aba fica muda.
  source.connect(audioCtx.destination);

  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!running) return;
    tel.audioChunksReceived++;
    tel.lastAudioChunkAt = Date.now();
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
        tel.vadSpeechStartCount++;
        chrome.runtime.sendMessage({ type: "COPILOT_TURN_START", turnId: currentTurnId }).catch(() => {});
        log("falando");
      }
      lastVoiceAt = now;
      buffer.push(downsample(input, audioCtx.sampleRate));
    } else if (speaking) {
      buffer.push(downsample(input, audioCtx.sampleRate));
      if (now - lastVoiceAt > SILENCE_MS) {
        speaking = false;
        tel.vadSpeechEndCount++;
        // fim real da fala = último frame com voz
        if (lastVoiceAt - speechStartedAt >= MIN_SPEECH_MS) flush(lastVoiceAt);
        else { buffer = []; skipTurn(currentTurnId); }
      }
    }

    // Streaming: manda o que já foi falado, sem esperar o fim da fala.
    if (speaking && !partialInFlight && now - lastPartialAt > PARTIAL_EVERY_MS && now - speechStartedAt > 900) {
      lastPartialAt = now;
      sendPartial(buffer.slice(), currentTurnId);
    }

    if (speaking && now - speechStartedAt > MAX_TURN_MS) {
      speaking = false;
      tel.vadSpeechEndCount++;
      flush(now);
    }

  };

  source.connect(processor);
  processor.connect(audioCtx.destination);
  running = true;
  startWatchdog();
  emitHealth({ evento: preservarSessao ? "captura recuperada" : "captura iniciada" });
  log("ouvindo");
}

function stop() {
  running = false;
  stopWatchdog();
  preAlertTipo = null;
  teardownAudio();
  emitHealth({ evento: "captura parada" });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OFFSCREEN_START") {
    // Nova sessão de call: zera memória, histórico e cards.
    etapaManual = msg.etapa || "rapport";
    resetSessao();
    resetFila();
    resetTelemetria();
    start(msg.streamId, msg.endpoint).catch((e) => log("erro", { error: e.message }));
  }
  if (msg?.type === "OFFSCREEN_STOP") stop();
  if (msg?.type === "COPILOT_HEALTH_REQUEST") emitHealth();
  if (msg?.type === "COPILOT_ETAPA" && msg.etapa) {
    etapaManual = msg.etapa;
    memoria.etapaAtual = etapaManual;
  }

});
