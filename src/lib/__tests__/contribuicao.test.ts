import { describe, expect, it } from "vitest";

import {
  acumularPerfil,
  classificarDorAtual,
  dificuldadeCliente,
  ehPergunta,
  escolherContribuicao,
  perguntasConsecutivas,
  registrarIntervencao,
  valorDaIntervencao,
} from "../contribuicao";
import { aplicarMapaLocal, MEMORIA_VAZIA, decisaoDaMemoria, type Memoria } from "../memoria";

const call = (...falas: string[]): Memoria => {
  let m: Memoria = { ...MEMORIA_VAZIA, motivacoes: { ...MEMORIA_VAZIA.motivacoes } };
  for (const f of falas) m = aplicarMapaLocal(m, f).memoria;
  return m;
};

describe("V3.0 — camada de contribuição", () => {
  it("cliente que não entendeu recebe reformulação, nunca a mesma pergunta", () => {
    const m = call("Como assim? Não entendi tua pergunta.");
    const d = decisaoDaMemoria(m, { ultimaFala: "Como assim? Não entendi tua pergunta." });
    expect(d.nextAction).toBe("reformular_perspectiva");
    expect(d.contribuicao).toBe(true);
  });

  it("dor negada vira leitura/hipótese em vez de caçar dor", () => {
    const m = call(
      "Quero crescer na carreira e ganhar em dólar.",
      "No meu trabalho atual o inglês não faz falta nenhuma.",
    );
    expect(m.dorAtual).toBe("negada");
    const d = decisaoDaMemoria(m);
    expect(["validar_hipotese", "reformular_perspectiva"]).toContain(d.nextAction);
    expect(d.nextAction).not.toBe("aprofundar_dor");
  });

  it("negações repetidas aumentam a dificuldade do cliente", () => {
    const m = call(
      "Não é impeditivo de eu fazer nada no dia.",
      "O inglês pra mim não é uma barreira.",
    );
    expect(m.perfilCliente.negacoesDeDor).toBeGreaterThanOrEqual(2);
    expect(dificuldadeCliente(m.perfilCliente)).not.toBe("baixa");
  });

  it("duas perguntas seguidas forçam contribuição no lugar de nova pergunta", () => {
    const m = call("Inglês é importante profissionalmente.");
    const d = decisaoDaMemoria(m, { perguntasSeguidas: 2 });
    expect(["resumir", "conectar_pontos", "dar_exemplo", "contextualizar"]).toContain(d.nextAction);
  });

  it("resposta vaga pede exemplos concretos antes de perguntar", () => {
    const c = escolherContribuicao({ sinais: { respostaVaga: true } });
    expect(c?.nextAction).toBe("dar_exemplo");
  });

  it("histórico de intervenções conta perguntas consecutivas", () => {
    let lista = registrarIntervencao([], "O que você quer conquistar?");
    lista = registrarIntervencao(lista, "E hoje o que te trava?");
    expect(perguntasConsecutivas(lista)).toBe(2);
    lista = registrarIntervencao(lista, "Então o inglês é sobre o próximo passo.");
    expect(perguntasConsecutivas(lista)).toBe(0);
    expect(ehPergunta("Então é isso.")).toBe(false);
  });

  it("pergunta genérica após duas perguntas não passa na heurística de valor", () => {
    const ruim = valorDaIntervencao("O que você quer conquistar?", {
      ultimaFalaCliente: "acho que crescimento profissional",
      perguntasSeguidas: 2,
    });
    expect(ruim.aprovada).toBe(false);
    const bom = valorDaIntervencao(
      "Então não é aprender por aprender: você vê o inglês aumentando teu teto de crescimento profissional.",
      { ultimaFalaCliente: "acho que crescimento profissional", perguntasSeguidas: 2 },
    );
    expect(bom.aprovada).toBe(true);
  });

  it("dor confirmada depois de negada volta a valer", () => {
    expect(classificarDorAtual("negada", "Na verdade travei numa reunião com o cliente americano")).toBe(
      "confirmada",
    );
    const { perfil } = acumularPerfil(undefined, "como assim?");
    expect(perfil.perguntasNaoEntendidas).toBe(1);
  });
});
