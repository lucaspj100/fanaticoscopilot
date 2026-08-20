import { describe, expect, it } from "vitest";

import { aplicarMapaLocal, MEMORIA_VAZIA, avaliacaoSpin, decisaoDaMemoria, type Memoria } from "../memoria";
import { detectarCriterios, ganchosApresentacao } from "../rotas";

/** Roda uma sequência de falas do cliente pela descoberta local (sem IA). */
const call = (...falas: string[]): Memoria => {
  let m: Memoria = { ...MEMORIA_VAZIA, motivacoes: { ...MEMORIA_VAZIA.motivacoes } };
  for (const f of falas) m = aplicarMapaLocal(m, f).memoria;
  return m;
};

describe("V2.8 — motivação dominante e rotas de descoberta", () => {
  it("PERFIL 1 (Tatiana) — perda concreta vira rota de dor passada e continua aprofundando", () => {
    const m = call(
      "Perdi uma promoção de gerente porque não consegui falar na entrevista em inglês.",
    );
    const d = decisaoDaMemoria(m);
    expect(m.rota).toBe("dor_passada");
    expect(d.nextAction).toBe("aprofundar_dor");
    expect(avaliacaoSpin(m).suficiente).toBe(false);
    expect(d.informacaoQueQuerDescobrir).toBeTruthy();
  });

  it("PERFIL 2 (Bruna) — empresa internacionalizando aponta risco futuro", () => {
    const m = call(
      "Hoje só temos um cliente de fora, mas a empresa está expandindo e isso vai aumentar.",
    );
    const d = decisaoDaMemoria(m);
    expect(m.rota).toBe("risco_futuro");
    expect(d.nextAction).toBe("aprofundar_risco");
  });

  it("PERFIL 3 (Rodrigo) — ambição não vira caça à dor; depois busca o timing", () => {
    const m = call("Quero crescer na carreira e chegar a um cargo internacional.");
    const d = decisaoDaMemoria(m);
    expect(m.rota).toBe("ambicao_crescimento");
    expect(["expandir_ambicao", "explorar_timing"]).toContain(d.nextAction);
    expect(d.nextAction).not.toBe("aprofundar_dor");
  });

  it("PERFIL 4 (Franklin) — frustração anterior + janela de oportunidade coexistem", () => {
    const m = call(
      "Já comecei dois cursos e parei porque viajava muito.",
      "Agora vou ficar três anos na mesma obra e minha rotina estabilizou.",
    );
    const rotas = d(m);
    expect(rotas).toContain("frustracao_anterior");
    expect(rotas).toContain("janela_oportunidade");
    expect(["explorar_historico", "explorar_timing"]).toContain(decisaoDaMemoria(m).nextAction);
  });

  it("PERFIL 5 (Vini) — ambição jovem: expandir futuro e depois critério de compra", () => {
    const m = call(
      "Trabalho com tecnologia, quero ganhar em dólar e tirar certificação.",
      "Preciso de horário flexível e conversação de verdade.",
    );
    expect(m.rota).toBe("ambicao_crescimento");
    expect(m.criteriosCompra).toEqual(expect.arrayContaining(["flexibilidade", "conversacao"]));
    expect(decisaoDaMemoria(m).nextAction).not.toBe("aprofundar_dor");
  });

  it("minimização da dor troca a rota em vez de insistir na perda", () => {
    const m = call(
      "Travo nas reuniões com o cliente americano.",
      "Mas sinceramente não ligo tanto, é o momento de começar porque terminei a pós.",
    );
    const d2 = decisaoDaMemoria(m);
    expect(d2.nextAction).not.toBe("aprofundar_dor");
  });

  it("critérios e ganchos de apresentação saem da fala do cliente", () => {
    expect(detectarCriterios("preciso de acompanhamento e aula ao vivo")).toEqual(
      expect.arrayContaining(["acompanhamento", "aulas_ao_vivo"]),
    );
    const m = call("Fico dependente da minha gerente nas reuniões com clientes de fora.");
    const ganchos = ganchosApresentacao(m.mapa, m.criteriosCompra);
    expect(ganchos.length).toBeGreaterThan(0);
  });
});

/** Rotas com peso comercial na memória. */
function d(m: Memoria): string[] {
  return Object.entries(m.motivacoes)
    .filter(([, v]) => v >= 1)
    .map(([k]) => k);
}
