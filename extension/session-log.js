/**
 * United Copilot — log estruturado da sessão (V2.3).
 *
 * Mantém, apenas em memória do sidepanel, TODO o histórico da call:
 * eventos ordenados + turnos consolidados + snapshots de memória.
 * Nada é enviado para servidor. Zera a cada INICIAR.
 */

const MEM_FIELDS = [
  "objetivo",
  "problema",
  "implicacao",
  "necessidade",
  "criterioCompra",
  "pontosQueGostou",
  "objecoes",
  "sinaisCompra",
  "informacoesImportantes",
  "diStatus",
  "diMotivoResistencia",
  "diCriteriosParaDecidir",
];

function memSnapshot(memoria) {
  const out = {};
  for (const k of MEM_FIELDS) {
    const v = memoria?.[k];
    out[k] = Array.isArray(v) ? [...v] : (v ?? null);
  }
  return out;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

const SILENCIO = new Set(["NO_TRIGGER_DETECTED", "LOW_CONFIDENCE", "NO_ACTION_NEEDED", "PROCESSO_BLOQUEADO"]);

const ETAPA_NOME = {
  rapport: "RAPPORT",
  di: "D.I.",
  spin: "PRÉ-SPEECH / SPIN",
  apresentacao: "APRESENTAÇÃO",
  gatilho: "GATILHO DE FECHAMENTO",
  fechamento: "FECHAMENTO",
};

const CopilotLog = {
  version: "1.0",
  sessionId: null,
  startedAt: null,
  endedAt: null,
  events: [],
  turns: new Map(),
  memoria: null,
  etapa: "rapport",

  start(etapa) {
    const now = new Date();
    this.sessionId = `call_${stamp(now)}_${Math.random().toString(36).slice(2, 7)}`;
    this.startedAt = now.toISOString();
    this.endedAt = null;
    this.events = [];
    this.turns = new Map();
    this.memoria = null;
    this.etapa = etapa || this.etapa;
    this.add("session_start", { etapa: this.etapa });
    return this.sessionId;
  },

  stop() {
    if (!this.sessionId) return;
    this.endedAt = new Date().toISOString();
    this.add("session_stop", { turnos: this.turns.size });
  },

  add(tipo, dados, turnId) {
    if (!this.sessionId) return;
    this.events.push({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      turnId: turnId ?? null,
      tipo,
      etapaManual: this.etapa,
      dados: dados ?? {},
    });
  },

  turn(turnId) {
    if (!this.turns.has(turnId)) {
      this.turns.set(turnId, {
        turnId,
        speaker: "cliente",
        text: null,
        etapa: this.etapa,
        timestamp: new Date().toISOString(),
        parciais: [],
        memoryBefore: memSnapshot(this.memoria),
        cardLocal: null,
        decision: null,
        cardFinal: null,
        latency: null,
      });
    }
    return this.turns.get(turnId);
  },

  setEtapa(etapa) {
    if (etapa === this.etapa) return;
    const antes = this.etapa;
    this.etapa = etapa;
    this.add("etapa_change", { de: antes, para: etapa });
  },

  transcript({ turnId, text, parcial, ms }) {
    if (!this.sessionId) return;
    const t = this.turn(turnId);
    if (parcial) {
      t.parciais.push({ text, ms });
      this.add("transcript_partial", { text, ms, speaker: "cliente" }, turnId);
    } else {
      t.text = text;
      t.etapa = this.etapa;
      t.timestamp = new Date().toISOString();
      this.add("transcript_final", { text, ms, speaker: "cliente", etapaManual: this.etapa }, turnId);
    }
  },

  card(card) {
    if (!this.sessionId || !card) return;
    const turnId = card.turnId ?? 0;
    const t = this.turn(turnId);
    const resumo = {
      tipo: card.tipo,
      rotulo: card.rotulo,
      nivel: card.nivel,
      orientacao: card.orientacao,
      frase: card.frase || null,
      fonte: card.fonte,
      ms: card.ms ?? null,
    };
    if (card.fonte === "regra") {
      t.cardLocal = resumo;
      this.add("card_local", resumo, turnId);
    } else {
      t.cardFinal = resumo;
      this.add("card_final", resumo, turnId);
    }
  },

  decision(d) {
    if (!this.sessionId || !d) return;
    const turnId = d.turnId ?? 0;
    const t = this.turn(turnId);
    const debug = d.debug || {};
    const registro = {
      decisao: d.decisao || null,
      tipo: d.tipo || "nenhum",
      etapaManual: d.etapaManual || this.etapa,
      orientacao: d.orientacao || null,
      frase: d.frase || null,
      confianca: d.confianca ?? null,
      motivo_intervencao: debug.motivo_intervencao ?? null,
      motivo_silencio: debug.motivo_silencio ?? d.motivo ?? null,
      sinal_baseado_em: debug.sinal_baseado_em ?? null,
      aviso: d.aviso ?? null,
      turnsEnviados: d.turnsEnviados ?? null,
      debug,
      memoriaUsada: memSnapshot(this.memoria),
    };
    t.decision = registro;
    this.add("coach_decision", registro, turnId);
    const semAcao = !d.tipo || d.tipo === "nenhum" || SILENCIO.has(String(d.decisao));
    if (semAcao) {
      this.add(
        "no_trigger",
        {
          decisao: d.decisao || "NO_TRIGGER_DETECTED",
          motivo: registro.motivo_silencio,
          texto: t.text,
        },
        turnId,
      );
    }
  },

  memory(memoria, alterados) {
    if (!this.sessionId) return;
    this.memoria = memoria;
    this.add("memory_update", { alterados: alterados || [], memoria: memSnapshot(memoria) });
  },

  latency(timing, turnId) {
    if (!this.sessionId) return;
    const id = turnId ?? Math.max(0, ...this.turns.keys());
    const t = this.turn(id);
    t.latency = { ...timing };
    this.add("latency", { ...timing }, id);
  },

  toJSON() {
    return {
      version: this.version,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      events: this.events,
      turns: [...this.turns.values()].sort((a, b) => a.turnId - b.turnId),
      finalMemory: memSnapshot(this.memoria),
    };
  },

  fileName() {
    const d = this.startedAt ? new Date(this.startedAt) : new Date();
    return `united-copilot-call-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
      d.getHours(),
    )}${pad(d.getMinutes())}.json`;
  },

  toText() {
    const linhas = [`CALL: ${this.sessionId || "—"}`, `INÍCIO: ${this.startedAt || "—"}`];
    if (this.endedAt) linhas.push(`FIM: ${this.endedAt}`);
    linhas.push("");

    for (const t of [...this.turns.values()].sort((a, b) => a.turnId - b.turnId)) {
      linhas.push(`TURNO ${t.turnId}`);
      linhas.push(`ETAPA: ${ETAPA_NOME[t.etapa] || t.etapa}`);
      linhas.push("CLIENTE:");
      linhas.push(`"${t.text ?? (t.parciais.at(-1)?.text ?? "(sem transcrição final)")}"`);
      linhas.push("");
      linhas.push("COPILOT:");
      const d = t.decision;
      const c = t.cardFinal || t.cardLocal;
      if (d && (!d.tipo || d.tipo === "nenhum" || SILENCIO.has(String(d.decisao)))) {
        linhas.push(d.decisao || "NO_TRIGGER_DETECTED");
        if (d.motivo_silencio) linhas.push(`MOTIVO: ${d.motivo_silencio}`);
      } else if (c || d) {
        linhas.push(`TIPO: ${(c?.tipo || d?.tipo) ?? "—"}`);
        linhas.push(`ORIENTAÇÃO: ${(c?.orientacao || d?.orientacao) ?? "—"}`);
        const frase = c?.frase || d?.frase;
        if (frase) linhas.push(`FALE: "${frase}"`);
        if (d?.confianca != null) linhas.push(`CONFIANÇA: ${d.confianca}`);
        if (d?.motivo_intervencao) linhas.push(`MOTIVO: ${d.motivo_intervencao}`);
      } else {
        linhas.push("(sem resposta registrada)");
      }
      if (t.latency) {
        const l = t.latency;
        linhas.push(`LATÊNCIA: 1º alerta ${l.primeiroAlerta ?? "—"} ms · total ${l.total ?? "—"} ms`);
      }
      linhas.push("");
    }

    linhas.push("MEMÓRIA:");
    const mem = memSnapshot(this.memoria);
    for (const k of MEM_FIELDS) {
      const v = mem[k];
      const txt = Array.isArray(v) ? v.join(" · ") : v;
      if (txt) linhas.push(`${k}: ${txt}`);
    }
    return linhas.join("\n");
  },

  download() {
    const blob = new Blob([JSON.stringify(this.toJSON(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },
};

window.CopilotLog = CopilotLog;
