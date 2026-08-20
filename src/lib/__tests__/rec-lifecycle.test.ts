import { describe, it, expect } from "vitest";
// módulo JS da extensão (tipado em rec-lifecycle.d.ts)
import {
  initialCtx,
  reduceCard,
  reduceTimeout,
  reduceNovoTurno,
  finalizarSemFrase,
  GENERATING_TIMEOUT_MS,
} from "../../../extension/rec-lifecycle.js";

const preliminar = (turnId: number, tipo = "spin_problema") => ({
  tipo,
  rotulo: "DESCUBRA O PROBLEMA",
  nivel: "atencao",
  orientacao: "Objetivo claro. Descubra o que hoje trava.",
  fonte: "regra",
  turnId,
});

const finalIA = (turnId: number, seq = 1, tipo = "spin_implicacao") => ({
  tipo,
  rotulo: "APROFUNDE A IMPLICAÇÃO",
  nivel: "atencao",
  orientacao: "Explore a consequência concreta.",
  frase: "O que você deixou de conquistar por causa disso?",
  porque: "Falta impacto concreto no mapa.",
  fonte: "ia",
  recommendationSequence: seq,
  sourceTurnId: turnId,
  turnId,
});

describe("ciclo de vida da recomendação", () => {
  it("completa o card preliminar mesmo quando a IA reclassifica o tipo", () => {
    let ctx = initialCtx();
    ctx = reduceCard(ctx, preliminar(12), 12, 1000).ctx;
    const id = ctx.state.rec.id;
    expect(ctx.state.rec.status).toBe("generating");

    const r = reduceCard(ctx, finalIA(12), 12, 2000);
    expect(r.changed).toBe(true);
    expect(r.log.applied).toBe(true);
    expect(r.ctx.state.rec.id).toBe(id);
    expect(r.ctx.state.rec.status).toBe("complete");
    expect(r.ctx.state.rec.frase).toContain("deixou de conquistar");
    expect(r.ctx.state.rec.completedAt).toBe(2000);
  });

  it("30 ciclos consecutivos sempre terminam em complete", () => {
    let ctx = initialCtx();
    for (let turn = 1; turn <= 30; turn++) {
      ctx = reduceNovoTurno(ctx, turn, "cliente falou uma frase longa de verdade aqui", turn * 10000).ctx;
      ctx = reduceCard(ctx, preliminar(turn), turn, turn * 10000 + 500).ctx;
      expect(ctx.state.rec.status).toBe("generating");
      ctx = reduceCard(ctx, finalIA(turn, turn), turn, turn * 10000 + 2500).ctx;
      expect(ctx.state.rec.status).toBe("complete");
      expect(ctx.state.rec.frase).toBeTruthy();
    }
  });

  it("IA sem ação encerra o estado de geração", () => {
    let ctx = initialCtx();
    ctx = reduceCard(ctx, preliminar(3), 3, 0).ctx;
    const r = finalizarSemFrase(ctx, 3, 1500);
    expect(r.ctx.state.rec.status).toBe("final_sem_frase");
    expect(r.ctx.state.rec.orientacao).toBeTruthy();
  });

  it("timeout nunca deixa o card aguardando frase para sempre", () => {
    let ctx = initialCtx();
    ctx = reduceCard(ctx, preliminar(4), 4, 0).ctx;
    expect(reduceTimeout(ctx, 1000).changed).toBe(false);
    const r = reduceTimeout(ctx, GENERATING_TIMEOUT_MS + 1);
    expect(r.changed).toBe(true);
    expect(r.ctx.state.rec.status).toBe("failed");
    expect(r.ctx.state.rec.porque).toContain("Não consegui concluir a frase");
  });

  it("fragmento curto durante a geração não destrói a recomendação", () => {
    let ctx = initialCtx();
    ctx = reduceNovoTurno(ctx, 10, "texto longo do cliente explicando o objetivo", 0).ctx;
    ctx = reduceCard(ctx, preliminar(10), 10, 100).ctx;
    const r = reduceNovoTurno(ctx, 11, "sim", 500);
    expect(r.changed).toBe(false);
    expect(r.log.discardReason).toBe("fragmento_curto_durante_geracao");
    expect(r.ctx.state.rec.status).toBe("generating");
    const fim = reduceCard(r.ctx, finalIA(10), 10, 900);
    expect(fim.ctx.state.rec.status).toBe("complete");
  });

  it("fala real de novo turno invalida deterministicamente o turno anterior", () => {
    let ctx = initialCtx();
    ctx = reduceNovoTurno(ctx, 10, "frase longa do cliente com conteúdo real", 0).ctx;
    ctx = reduceCard(ctx, preliminar(10), 10, 100).ctx;
    ctx = reduceNovoTurno(ctx, 11, "na verdade o meu problema maior é outro totalmente diferente", 500).ctx;
    expect(ctx.state.kind).toBe("analisando");
    const atrasada = reduceCard(ctx, finalIA(10), 10, 1200);
    expect(atrasada.changed).toBe(false);
    expect(atrasada.log.discardReason).toBe("turno_obsoleto");
    expect(atrasada.log.applied).toBe(false);
  });

  it("sequência antiga da IA é descartada", () => {
    let ctx = initialCtx();
    ctx = reduceCard(ctx, preliminar(7), 7, 0).ctx;
    ctx = reduceCard(ctx, finalIA(7, 5), 7, 100).ctx;
    const r = reduceCard(ctx, finalIA(7, 2), 7, 200);
    expect(r.changed).toBe(false);
    expect(r.log.discardReason).toBe("sequencia_antiga");
  });
});
