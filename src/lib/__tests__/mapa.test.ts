import { describe, expect, it } from "vitest";

import { aplicarPatchMapa, fraseRepetida, inferirMapa, lacunas, novoMapa } from "../mapa";
import { MEMORIA_VAZIA, aplicarMapaLocal } from "../memoria";

const mapaDe = (...falas: string[]) => {
  let mapa = novoMapa();
  for (const f of falas) mapa = aplicarPatchMapa(mapa, inferirMapa(f)).mapa;
  return mapa;
};

describe("mapa vivo — memória da conversa", () => {
  it("cenário 1: motivação respondida nunca é perguntada de novo", () => {
    const mapa = mapaDe("Quero tentar uma promoção dentro da empresa.");
    expect(mapa.objetivo.estado).toBe("respondido");
    expect(fraseRepetida(mapa, "Qual é sua principal motivação para aprender inglês?")).not.toBeNull();
  });

  it("cenário 2: informação espontânea registra oportunidade perdida", () => {
    const mapa = mapaDe("Mês passado apareceu uma vaga internacional, mas eu nem tentei porque exigia inglês.");
    expect(mapa.oportunidade_perdida.estado).toBe("respondido");
    expect(fraseRepetida(mapa, "Isso já te fez perder alguma oportunidade?")).toBe("oportunidade_perdida");
  });

  it("cenário 3: resposta parcial permite aprofundar, não repetir", () => {
    const mapa = mapaDe("Já fiz inglês antes, mas tive que parar.");
    expect(mapa.experiencia_anterior.estado).toBe("respondido");
    expect(mapa.motivo_interrupcao.estado).toBe("parcial");
    expect(fraseRepetida(mapa, "Você já estudou inglês antes em alguma escola?")).toBe("experiencia_anterior");
    expect(fraseRepetida(mapa, "E o que acabou fazendo você parar naquela época?")).toBeNull();
  });

  it("cenário 4: uma fala cobre problema e implicação", () => {
    const mapa = mapaDe("Eu travo falando e por causa disso evito reuniões internacionais.");
    expect(mapa.problema.estado).toBe("respondido");
    expect(mapa.impacto.estado).toBe("respondido");
    expect(lacunas(mapa)).not.toContain("problema");
    expect(lacunas(mapa)).not.toContain("impacto");
  });

  it("cenário 5: resposta antecipada sobre decisão fica registrada", () => {
    const mapa = mapaDe("Preciso conversar com meu marido antes de fechar qualquer coisa.");
    expect(mapa.decisor.estado).toBe("respondido");
    expect(fraseRepetida(mapa, "Você precisa consultar alguém antes de decidir?")).toBe("decisor");
  });

  it("estado nunca retrocede e o mapa entra na memória", () => {
    const respondido = aplicarPatchMapa(novoMapa(), {
      problema: { estado: "respondido", valor: "trava em reunião" },
    }).mapa;
    const depois = aplicarPatchMapa(respondido, { problema: { estado: "parcial", valor: "inglês" } }).mapa;
    expect(depois.problema.estado).toBe("respondido");
    expect(depois.problema.valor).toBe("trava em reunião");

    const { memoria } = aplicarMapaLocal(MEMORIA_VAZIA, "Já perdi uma vaga porque não tinha inglês.");
    expect(memoria.mapa.oportunidade_perdida.estado).toBe("respondido");
  });

  it("frase que não é pergunta nunca é bloqueada", () => {
    const mapa = mapaDe("Quero uma promoção.");
    expect(fraseRepetida(mapa, "Então o inglês é o que falta pra essa promoção acontecer.")).toBeNull();
  });
});
