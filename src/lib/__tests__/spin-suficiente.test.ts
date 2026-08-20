import { describe, expect, it } from "vitest";

import { aplicarPatchMapa, avaliarSpin, inferirMapa, novoMapa, profundidadeDe } from "../mapa";

const mapaDe = (...falas: string[]) => {
  let mapa = novoMapa();
  for (const f of falas) mapa = aplicarPatchMapa(mapa, inferirMapa(f)).mapa;
  return mapa;
};

describe("V2.7 — SPIN suficiente por profundidade", () => {
  it("objetivo futuro sozinho não fecha o SPIN", () => {
    const av = avaliarSpin(mapaDe("Quero morar fora um dia."));
    expect(av.suficiente).toBe(false);
    expect(av.faltando).toContain("problema relevante");
  });

  it("problema genérico sem consequência não fecha o SPIN", () => {
    const av = avaliarSpin(
      aplicarPatchMapa(novoMapa(), { problema: { estado: "respondido", valor: "não falo inglês" } }).mapa,
    );
    expect(av.suficiente).toBe(false);
  });

  it("condição A: problema + impacto concreto + necessidade percebida fecha o SPIN", () => {
    const mapa = aplicarPatchMapa(novoMapa(), {
      problema: { estado: "respondido", valor: "travo nas reuniões com o cliente americano", profundidade: "alta" },
      impacto: { estado: "respondido", valor: "fiquei de fora do projeto e perdi a promoção", profundidade: "alta" },
      necessidade: { estado: "respondido", valor: "preciso destravar pra assumir a área em 6 meses", profundidade: "alta" },
    }).mapa;
    const av = avaliarSpin(mapa);
    expect(av.suficiente).toBe(true);
    expect(av.condicao).toBe("A");
  });

  it("minimização da dor bloqueia o encerramento", () => {
    const mapa = aplicarPatchMapa(
      aplicarPatchMapa(novoMapa(), {
        problema: { estado: "respondido", valor: "travo na reunião com o chefe", profundidade: "alta" },
        impacto: { estado: "respondido", valor: "deixei de participar de calls do projeto", profundidade: "alta" },
        necessidade: { estado: "respondido", valor: "preciso resolver pra crescer na empresa", profundidade: "alta" },
      }).mapa,
      inferirMapa("Mas sinceramente não ligo tanto, não tenho pressa."),
    ).mapa;
    const av = avaliarSpin(mapa);
    expect(av.minimizou).toBe(true);
    expect(av.suficiente).toBe(false);
  });

  it("'é o momento de iniciar' fica parcial até saber o que mudou", () => {
    const mapa = mapaDe("Acho que é o momento de começar.");
    expect(mapa.gatilho_agora.estado).toBe("parcial");
    expect(avaliarSpin(mapa).suficiente).toBe(false);
  });

  it("profundidade: genérico é baixa, consequência concreta é alta", () => {
    expect(profundidadeDe("quero aprender inglês")).toBe("baixa");
    expect(profundidadeDe("perdi uma promoção de gerente porque não falei na entrevista")).toBe("alta");
  });
});
