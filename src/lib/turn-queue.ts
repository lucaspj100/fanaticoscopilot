/**
 * United Copilot — V2.9: continuidade da captura.
 *
 * Lógica pura (testável) para:
 *  1. commit ORDENADO dos turnos (STT pode terminar fora de ordem);
 *  2. falas curtas contextuais (nunca descartadas pela memória);
 *  3. descarte de recomendações obsoletas (resposta atrasada de turno antigo).
 *
 * O mesmo comportamento está espelhado em extension/offscreen.js e
 * extension/background.js (a extensão é JS puro, sem bundler).
 */

export type TurnResult = { turnId: number; text: string; [k: string]: unknown };

/** Fila de commit: garante que a memória sempre avance em ordem cronológica. */
export class TurnCommitQueue {
  private pending = new Map<number, TurnResult>();
  private next = 1;
  private committed = 0;
  /** turnos que nunca vão chegar (STT falhou / fala curta descartada) */
  private skipped = new Set<number>();

  get nextExpected() {
    return this.next;
  }
  get lastCommitted() {
    return this.committed;
  }
  get pendingCount() {
    return this.pending.size;
  }

  reset() {
    this.pending.clear();
    this.skipped.clear();
    this.next = 1;
    this.committed = 0;
  }

  /** Marca um turnId que nunca produzirá resultado, liberando a fila. */
  skip(turnId: number) {
    if (turnId < this.next) return;
    this.skipped.add(turnId);
  }

  /** Registra o resultado do STT e devolve os turnos prontos, em ordem. */
  push(result: TurnResult): TurnResult[] {
    if (result.turnId < this.next) return []; // já commitado: ignora duplicata
    this.pending.set(result.turnId, result);
    return this.drain();
  }

  /**
   * Libera o que está travado esperando um turno que nunca chegou.
   * Usado pelo watchdog depois de um timeout de STT.
   */
  forceDrain(): TurnResult[] {
    const ids = [...this.pending.keys()].sort((a, b) => a - b);
    if (!ids.length) return [];
    for (let id = this.next; id < ids[0]!; id++) this.skipped.add(id);
    return this.drain();
  }

  private drain(): TurnResult[] {
    const out: TurnResult[] = [];
    for (;;) {
      if (this.skipped.has(this.next)) {
        this.skipped.delete(this.next);
        this.next++;
        continue;
      }
      const hit = this.pending.get(this.next);
      if (!hit) break;
      this.pending.delete(this.next);
      this.committed = this.next;
      this.next++;
      out.push(hit);
    }
    return out;
  }
}

const RESPOSTA_CURTA =
  /^(sim|n[ãa]o|isso|exato|exatamente|com certeza|certeza|claro|virou|[ée]|[ée] isso|muito|bastante|hoje sim|agora sim|total|totalmente|com toda certeza|pode ser|talvez|acho que sim|acho que n[ãa]o|uhum|aham|perfeito|verdade|demais|sempre|nunca|[ée] uma necessidade|necessidade|obviamente|sem d[úu]vida)[.!]?$/i;

export type FalaCurta = {
  /** curta demais para virar card sozinha */
  curta: boolean;
  /** responde/completa a interação anterior → tem valor semântico */
  contextual: boolean;
  /** texto enriquecido com o contexto imediatamente anterior */
  textoParaMemoria: string;
};

/**
 * Uma fala curta NUNCA é ignorada pela memória quando responde à interação
 * anterior. Ela pode não gerar card, mas é concatenada semanticamente.
 */
export function avaliarFalaCurta(text: string, contextoAnterior?: string | null): FalaCurta {
  const limpo = (text || "").trim();
  const palavras = limpo ? limpo.split(/\s+/).length : 0;
  const curta = palavras < 4;
  if (!curta) return { curta: false, contextual: false, textoParaMemoria: limpo };

  const ctx = (contextoAnterior || "").trim();
  const contextual = !!ctx && (RESPOSTA_CURTA.test(limpo.replace(/[.,!?]+$/, "")) || palavras > 0);
  return {
    curta: true,
    contextual,
    textoParaMemoria: contextual ? `${ctx} → (cliente) ${limpo}` : limpo,
  };
}

export type Recomendacao = { sourceTurnId: number; recommendationSequence: number; createdAt: number };

/** Uma resposta atrasada de um turno antigo nunca sobrescreve o estado atual. */
export function isStale(
  incoming: Recomendacao,
  atual: { sourceTurnId: number; recommendationSequence: number } | null,
  latestCommittedTurnId: number,
): boolean {
  if (incoming.sourceTurnId < latestCommittedTurnId) return true;
  if (!atual) return false;
  if (incoming.sourceTurnId < atual.sourceTurnId) return true;
  if (incoming.sourceTurnId === atual.sourceTurnId && incoming.recommendationSequence < atual.recommendationSequence)
    return true;
  return false;
}
