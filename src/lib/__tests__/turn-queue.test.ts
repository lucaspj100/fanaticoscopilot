import { describe, it, expect } from "vitest";
import { TurnCommitQueue, avaliarFalaCurta, isStale } from "../turn-queue";

describe("commit ordenado de turnos", () => {
  it("commita em ordem mesmo quando o STT termina fora de ordem", () => {
    const q = new TurnCommitQueue();
    expect(q.push({ turnId: 2, text: "b" })).toEqual([]); // segura o 2
    const saida = q.push({ turnId: 1, text: "a" });
    expect(saida.map((t) => t.turnId)).toEqual([1, 2]);
    expect(q.lastCommitted).toBe(2);
  });

  it("turn 6 termina antes do 5: memória avança 5 → 6", () => {
    const q = new TurnCommitQueue();
    for (let i = 1; i <= 4; i++) q.push({ turnId: i, text: `t${i}` });
    expect(q.push({ turnId: 6, text: "seis" })).toEqual([]);
    const saida = q.push({ turnId: 5, text: "cinco" });
    expect(saida.map((t) => t.text)).toEqual(["cinco", "seis"]);
  });

  it("skip libera a fila quando um turno nunca chega", () => {
    const q = new TurnCommitQueue();
    q.skip(1);
    expect(q.push({ turnId: 2, text: "b" }).map((t) => t.turnId)).toEqual([2]);
  });

  it("forceDrain destrava a fila após timeout de STT", () => {
    const q = new TurnCommitQueue();
    q.push({ turnId: 3, text: "c" });
    expect(q.pendingCount).toBe(1);
    expect(q.forceDrain().map((t) => t.turnId)).toEqual([3]);
    expect(q.pendingCount).toBe(0);
  });

  it("mantém a sequência longa de uma call inteira", () => {
    const q = new TurnCommitQueue();
    const vistos: number[] = [];
    const ordem = [1, 3, 2, 4, 6, 5, 7, 9, 8, 10];
    for (const id of ordem) for (const t of q.push({ turnId: id, text: `t${id}` })) vistos.push(t.turnId);
    expect(vistos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("falas curtas contextuais", () => {
  it("'Virou.' após pergunta de necessidade não é descartada", () => {
    const r = avaliarFalaCurta("Virou.", "Então isso hoje já virou uma necessidade?");
    expect(r.curta).toBe(true);
    expect(r.contextual).toBe(true);
    expect(r.textoParaMemoria).toContain("necessidade");
    expect(r.textoParaMemoria).toContain("Virou");
  });

  it("'É uma necessidade.' vira material de memória", () => {
    const r = avaliarFalaCurta("É uma necessidade.", "Isso é um desejo ou uma necessidade?");
    expect(r.contextual).toBe(true);
  });

  it("fala curta sem contexto anterior não é contextual", () => {
    expect(avaliarFalaCurta("Muito.", null).contextual).toBe(false);
  });

  it("fala longa não é tratada como curta", () => {
    const r = avaliarFalaCurta("Eu perdi uma promoção por não falar inglês", "e aí?");
    expect(r.curta).toBe(false);
  });
});

describe("recomendações obsoletas", () => {
  it("descarta resposta atrasada do turn 5 quando o 6 já foi commitado", () => {
    expect(isStale({ sourceTurnId: 5, recommendationSequence: 1, createdAt: 1 }, null, 6)).toBe(true);
  });

  it("aceita a recomendação do turno corrente", () => {
    expect(isStale({ sourceTurnId: 6, recommendationSequence: 2, createdAt: 2 }, null, 6)).toBe(false);
  });

  it("descarta sequência menor no mesmo turno", () => {
    const atual = { sourceTurnId: 6, recommendationSequence: 3 };
    expect(isStale({ sourceTurnId: 6, recommendationSequence: 2, createdAt: 1 }, atual, 6)).toBe(true);
  });
});

describe("call longa (simulação de 20 minutos)", () => {
  it("nunca para de commitar turnos com silêncios, falas curtas e STT fora de ordem", () => {
    const q = new TurnCommitQueue();
    const commitados: number[] = [];
    const emVoo: { id: number; fim: number }[] = [];
    let relogio = 0;
    let id = 0;

    // ~20 min de call: uma fala a cada ~8s, latência de STT variável (fora de ordem)
    while (relogio < 20 * 60 * 1000) {
      id++;
      relogio += 4000 + (id % 7) * 1500; // pausas curtas e longas
      const curta = id % 5 === 0;
      const latencia = curta ? 400 : 900 + ((id * 733) % 2500); // respostas fora de ordem
      emVoo.push({ id, fim: relogio + latencia });
      emVoo
        .filter((r) => r.fim <= relogio)
        .sort((a, b) => a.fim - b.fim)
        .forEach((r) => {
          emVoo.splice(emVoo.indexOf(r), 1);
          for (const t of q.push({ turnId: r.id, text: `fala ${r.id}` })) commitados.push(t.turnId);
        });
    }
    emVoo
      .sort((a, b) => a.fim - b.fim)
      .forEach((r) => {
        for (const t of q.push({ turnId: r.id, text: `fala ${r.id}` })) commitados.push(t.turnId);
      });

    expect(commitados.length).toBe(id);
    expect(commitados).toEqual([...commitados].sort((a, b) => a - b));
    expect(commitados[0]).toBe(1);
    expect(commitados.at(-1)).toBe(id);
    expect(id).toBeGreaterThan(100);
  });
});
