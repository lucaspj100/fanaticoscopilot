/**
 * United Copilot — ciclo de vida da recomendação ativa (fonte única da verdade).
 *
 * Uma recomendação nasce como alerta instantâneo (status "generating") e é
 * SEMPRE finalizada: complete (frase da IA), final_sem_frase (IA decidiu não
 * sugerir frase) ou failed (timeout técnico). Nunca fica "aguardando frase".
 *
 * Módulo puro: sem chrome.*, para poder ser testado.
 */

export const GRUPO = {
  fechou: 5, intencao_compra: 5, pedido_decisao: 5,
  financeiro: 4, pensar: 4, segunda_opiniao: 4, tempo: 4, nao_negocie: 4, isolar_financeiro: 4,
  di_resistencia: 4, di_comparacao: 4, di_criterios: 4, di_pede_apresentacao: 4, di_estabelecida: 3,
  metodologia: 3, criterio_compra: 3, validar_solucao: 3, quatro_fatores: 3,
  spin_objetivo: 2, spin_problema: 2, spin_implicacao: 2, spin_confirmacao: 2, spin_suficiente: 2,
  aprofunde: 2, aprofunde_objetivo: 2, falta_problema: 2, falta_implicacao: 2, interesse: 2,
  personalize: 1, di_ausente: 1, rapport_longo: 1,
};

/** Tempo máximo que um card pode ficar aguardando a frase da IA. */
export const GENERATING_TIMEOUT_MS = 7000;

export const FALLBACK_FALHA = "Não consegui concluir a frase. Continue explorando o problema.";

export function initialState() {
  return { kind: "idle", texto: "Aguardando a fala do cliente…", rec: null, sequence: 0, turnId: 0 };
}

export function initialCtx() {
  return { state: initialState(), seq: 0, latestCommittedTurnId: 0 };
}

/** A resposta da IA sempre carrega recommendationSequence (ou já traz frase). */
export function isFinalCard(card) {
  return !!card && (card.recommendationSequence != null || card.fonte === "ia" || !!card.frase);
}

function statusDe(card, final) {
  if (!final) return "generating";
  return card.frase ? "complete" : "final_sem_frase";
}

function discard(ctx, reason, card, turnId) {
  return {
    ctx,
    changed: false,
    log: {
      event: "recommendation_final_received",
      recommendationId: card?.id ?? null,
      sourceTurnId: turnId ?? null,
      currentRecommendationId: ctx.state.rec?.id ?? null,
      applied: false,
      discardReason: reason,
    },
  };
}

/**
 * Aplica um card (preliminar ou final) ao estado central.
 * @returns {{ctx: object, changed: boolean, log: object}}
 */
export function reduceCard(ctx, card, turnIdRaw, now = Date.now()) {
  if (!card) return discard(ctx, "card_vazio", card, turnIdRaw);
  const state = ctx.state;
  const turnId = card.turnId ?? card.sourceTurnId ?? turnIdRaw ?? state.turnId ?? 0;
  const final = isFinalCard(card);

  if (turnId < (state.turnId || 0) || turnId < ctx.latestCommittedTurnId) {
    return discard(ctx, "turno_obsoleto", card, turnId);
  }

  const atual = state.kind === "card" && state.turnId === turnId ? state.rec : null;

  // IA sem ação: fecha o card preliminar do mesmo turno em vez de deixá-lo pendurado.
  if (!card.tipo || card.tipo === "nenhum") {
    if (final && atual && atual.status === "generating") {
      return finalizarSemFrase(ctx, turnId, now, "ia_sem_frase");
    }
    return discard(ctx, "tipo_nenhum", card, turnId);
  }

  if (
    atual &&
    card.recommendationSequence != null &&
    atual.recommendationSequence != null &&
    card.recommendationSequence < atual.recommendationSequence
  ) {
    return discard(ctx, "sequencia_antiga", card, turnId);
  }

  let merged = card;
  let mesmaRec = false;

  if (atual && (final || atual.tipo === card.tipo)) {
    // Final SEMPRE completa a recomendação visível do mesmo turno,
    // mesmo que a IA tenha reclassificado a situação.
    mesmaRec = true;
    merged = {
      ...atual,
      ...card,
      frase: card.frase || atual.frase,
      porque: card.porque || atual.porque,
      orientacao: card.orientacao || atual.orientacao,
      rotulo: card.rotulo || atual.rotulo,
    };
  } else if (atual) {
    const novo = GRUPO[card.tipo] ?? 0;
    const velho = GRUPO[atual.tipo] ?? 0;
    if (novo <= velho) return discard(ctx, "prioridade_menor", card, turnId);
  }

  const seq = ctx.seq + 1;
  const status = statusDe(merged, final);
  const rec = {
    ...merged,
    id: mesmaRec ? atual.id : `rec_${turnId}_${seq}`,
    turnId,
    sourceTurnId: turnId,
    recommendationSequence: merged.recommendationSequence ?? seq,
    status,
    preliminaryText: mesmaRec ? atual.preliminaryText ?? atual.orientacao : card.orientacao,
    createdAt: mesmaRec ? atual.createdAt : now,
    completedAt: final ? now : null,
    sequence: seq,
    ts: now,
  };

  return {
    ctx: {
      ...ctx,
      seq,
      state: { kind: "card", texto: "", turnId, sequence: seq, rec },
    },
    changed: true,
    log: {
      event: final ? "recommendation_final_received" : "recommendation_preliminary",
      recommendationId: rec.id,
      sourceTurnId: turnId,
      currentRecommendationId: atual?.id ?? null,
      applied: true,
      status,
      discardReason: null,
    },
  };
}

/** IA respondeu, mas sem frase para este turno: encerra o "gerando". */
export function finalizarSemFrase(ctx, turnId, now = Date.now(), motivo = "sem_acao") {
  const rec = ctx.state.rec;
  if (!(ctx.state.kind === "card" && rec && rec.turnId === turnId && rec.status === "generating")) {
    return discard(ctx, "sem_card_generating", null, turnId);
  }
  const seq = ctx.seq + 1;
  const novo = { ...rec, status: "final_sem_frase", completedAt: now, sequence: seq, motivo };
  return {
    ctx: { ...ctx, seq, state: { ...ctx.state, sequence: seq, rec: novo } },
    changed: true,
    log: {
      event: "recommendation_final_received",
      recommendationId: rec.id,
      sourceTurnId: turnId,
      currentRecommendationId: rec.id,
      applied: true,
      status: "final_sem_frase",
      discardReason: null,
    },
  };
}

/** Rede de segurança: nada pode ficar "gerando" para sempre. */
export function reduceTimeout(ctx, now = Date.now(), limite = GENERATING_TIMEOUT_MS) {
  const rec = ctx.state.rec;
  if (!(ctx.state.kind === "card" && rec && rec.status === "generating")) {
    return { ctx, changed: false, log: null };
  }
  if (now - (rec.createdAt || 0) < limite) return { ctx, changed: false, log: null };
  const seq = ctx.seq + 1;
  const novo = {
    ...rec,
    status: "failed",
    frase: rec.frase || null,
    porque: rec.porque || FALLBACK_FALHA,
    completedAt: now,
    sequence: seq,
  };
  return {
    ctx: { ...ctx, seq, state: { ...ctx.state, sequence: seq, rec: novo } },
    changed: true,
    log: {
      event: "recommendation_timeout",
      recommendationId: rec.id,
      sourceTurnId: rec.turnId,
      currentRecommendationId: rec.id,
      applied: true,
      status: "failed",
      discardReason: "timeout_ia",
    },
  };
}

/**
 * Novo turno commitado. Fragmentos curtos ("sim", "isso") não destroem uma
 * recomendação que ainda está sendo finalizada — só turnos com conteúdo real.
 */
export function reduceNovoTurno(ctx, turnId, texto = "", now = Date.now()) {
  const latest = Math.max(ctx.latestCommittedTurnId, turnId);
  let next = { ...ctx, latestCommittedTurnId: latest };
  if (turnId <= (ctx.state.turnId || 0)) return { ctx: next, changed: false, log: null };

  const rec = ctx.state.rec;
  const gerando = ctx.state.kind === "card" && rec && rec.status === "generating";
  const fragmento = contaPalavras(texto) <= 4;
  if (gerando && fragmento && now - (rec.createdAt || 0) < GENERATING_TIMEOUT_MS) {
    // mantém o card em geração; ele ainda pode ser completado
    return {
      ctx: next,
      changed: false,
      log: {
        event: "novo_turno_ignorado",
        recommendationId: rec.id,
        sourceTurnId: turnId,
        currentRecommendationId: rec.id,
        applied: false,
        discardReason: "fragmento_curto_durante_geracao",
      },
    };
  }

  const seq = next.seq + 1;
  next = {
    ...next,
    seq,
    state: { kind: "analisando", texto: "Analisando…", rec: null, sequence: seq, turnId },
  };
  return { ctx: next, changed: true, log: null };
}

function contaPalavras(t) {
  return String(t || "").trim().split(/\s+/).filter(Boolean).length;
}
