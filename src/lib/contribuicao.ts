/**
 * V3.0 — CAMADA DE CONTRIBUIÇÃO
 *
 * O copiloto deixa de ser um extrator de informação e passa a pensar junto
 * com o cliente. Antes de sugerir outra pergunta, ele avalia:
 *
 *   "Eu preciso mesmo perguntar agora, ou consigo primeiro devolver valor?"
 *
 * Este módulo:
 *  1. lê sinais da fala do cliente (não entendeu, negou a dor, resposta vaga);
 *  2. acumula o perfil de dificuldade do cliente ao longo da call;
 *  3. escolhe uma CONTRIBUIÇÃO (contextualizar, exemplo, hipótese, analogia,
 *     contraste, reformulação, conexão, resumo, silêncio) quando perguntar
 *     seria pior do que ajudar o cliente a pensar;
 *  4. mede o VALOR da intervenção antes de deixá-la virar card.
 */

import { type Mapa, novoMapa } from "./mapa";

/* ------------------------------------------------------------------
 * SINAIS DA FALA DO CLIENTE
 * ------------------------------------------------------------------ */

/** "como assim?", "não entendi", "não sei responder isso" */
export const NAO_ENTENDEU =
  /\b(como assim|n[ãa]o entendi|n[ãa]o entendo|o que (voc[êe]|tu) (quer dizer|quis dizer)|n[ãa]o sei (te )?responder|n[ãa]o sei o que (voc[êe]|tu) quer|pode (repetir|explicar)|em que sentido|que tipo de (coisa|resposta))\b/i;

/** Negação explícita de dor atual — o cliente diz que o inglês não pesa hoje. */
export const NEGACAO_DOR =
  /\b(n[ãa]o (faz falta|me faz falta|atrapalha|impede|trava|prejudica|limita|interfere)|nunca perdi|n[ãa]o perdi (nada|nenhuma|vaga|oportunidade)|n[ãa]o [ée] (um )?(impeditivo|barreira|problema|empecilho)|n[ãa]o tem impacto|sem impacto|consigo trabalhar (normalmente|sem)|no meu trabalho (atual )?n[ãa]o|n[ãa]o preciso de ingl[êe]s (hoje|no meu))\b/i;

/** Resposta genérica que não move a conversa ("é importante", "acho que sim"). */
export const RESPOSTA_VAGA =
  /^(sim|n[ãa]o|talvez|acho que sim|acho que n[ãa]o|[ée] isso|mais ou menos|pode ser|sei l[áa]|tanto faz|[ée] importante|imagino que sim|acho que [ée] isso)[.!]?$/i;

/** Ele recusa o enquadramento proposto pelo vendedor. */
export const RESISTENCIA_ENQUADRAMENTO =
  /\b(n[ãa]o [ée] (bem )?(isso|assim)|discordo|n[ãa]o concordo|na verdade n[ãa]o|nada a ver|n[ãa]o vejo (assim|dessa forma)|prefiro n[ãa]o)\b/i;

export type SinaisFala = {
  naoEntendeu: boolean;
  negouDor: boolean;
  respostaVaga: boolean;
  resistiuEnquadramento: boolean;
};

export function detectarSinaisFala(text: string): SinaisFala {
  const t = (text || "").trim();
  return {
    naoEntendeu: !!t && NAO_ENTENDEU.test(t),
    negouDor: !!t && NEGACAO_DOR.test(t),
    respostaVaga: !!t && (RESPOSTA_VAGA.test(t) || t.split(/\s+/).length <= 3),
    resistiuEnquadramento: !!t && RESISTENCIA_ENQUADRAMENTO.test(t),
  };
}

/* ------------------------------------------------------------------
 * PERFIL DO CLIENTE DIFÍCIL
 * ------------------------------------------------------------------ */

export type PerfilCliente = {
  respostasVagas: number;
  perguntasNaoEntendidas: number;
  negacoesDeDor: number;
  resistenciaAEnquadramento: number;
};

export const PERFIL_ZERO: PerfilCliente = {
  respostasVagas: 0,
  perguntasNaoEntendidas: 0,
  negacoesDeDor: 0,
  resistenciaAEnquadramento: 0,
};

export const novoPerfil = (): PerfilCliente => ({ ...PERFIL_ZERO });

export function normalizarPerfil(v: unknown): PerfilCliente {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = novoPerfil();
  for (const k of Object.keys(out) as Array<keyof PerfilCliente>) {
    const n = Number(o[k]);
    if (Number.isFinite(n) && n > 0) out[k] = Math.min(20, Math.round(n));
  }
  return out;
}

export function acumularPerfil(atual: PerfilCliente | undefined, text: string): {
  perfil: PerfilCliente;
  sinais: SinaisFala;
} {
  const perfil = { ...novoPerfil(), ...(atual ?? {}) };
  const sinais = detectarSinaisFala(text);
  if (sinais.naoEntendeu) perfil.perguntasNaoEntendidas += 1;
  if (sinais.negouDor) perfil.negacoesDeDor += 1;
  if (sinais.respostaVaga) perfil.respostasVagas += 1;
  if (sinais.resistiuEnquadramento) perfil.resistenciaAEnquadramento += 1;
  return { perfil, sinais };
}

export type Dificuldade = "baixa" | "media" | "alta";

/**
 * Cliente difícil NÃO recebe mais perguntas: recebe perguntas melhores,
 * com mais contexto, exemplos e hipóteses.
 */
export function dificuldadeCliente(p: PerfilCliente | undefined): Dificuldade {
  const perfil = { ...novoPerfil(), ...(p ?? {}) };
  const score =
    perfil.perguntasNaoEntendidas * 2 +
    perfil.negacoesDeDor * 1.5 +
    perfil.resistenciaAEnquadramento * 1.5 +
    perfil.respostasVagas * 0.75;
  return score >= 5 ? "alta" : score >= 2 ? "media" : "baixa";
}

/* ------------------------------------------------------------------
 * DOR ATUAL — pode ser explicitamente NEGADA pelo cliente
 * ------------------------------------------------------------------ */

export type DorAtual = "desconhecida" | "negada" | "confirmada";

const DOR_CONFIRMADA =
  /\b(perdi|deixei de|travo|travei|fico (boiando|perdid[oa]|travad[oa])|n[ãa]o consegui (falar|entender|responder)|passei vergonha|me atrapalha|me trava|dependo d)\b/i;

/** Uma negação explícita derruba a dor atual; um exemplo concreto a reabre. */
export function classificarDorAtual(atual: DorAtual | undefined, text: string): DorAtual {
  const t = (text || "").trim();
  if (!t) return atual ?? "desconhecida";
  if (DOR_CONFIRMADA.test(t)) return "confirmada";
  if (NEGACAO_DOR.test(t)) return "negada";
  return atual ?? "desconhecida";
}

/* ------------------------------------------------------------------
 * RITMO — proporção entre pergunta e contribuição
 * ------------------------------------------------------------------ */

export type TipoIntervencao = "pergunta" | "contribuicao";

export const ehPergunta = (frase: string): boolean => /\?\s*$/.test((frase || "").trim());

export const tipoDaIntervencao = (frase: string): TipoIntervencao =>
  ehPergunta(frase) ? "pergunta" : "contribuicao";

/** Últimas intervenções sugeridas, da mais antiga para a mais recente. */
export function registrarIntervencao(lista: TipoIntervencao[] | undefined, frase: string): TipoIntervencao[] {
  return [...(lista ?? []), tipoDaIntervencao(frase)].slice(-6);
}

export function perguntasConsecutivas(lista: TipoIntervencao[] | undefined): number {
  let n = 0;
  for (const t of [...(lista ?? [])].reverse()) {
    if (t !== "pergunta") break;
    n += 1;
  }
  return n;
}

/** Depois de 2 perguntas seguidas, a próxima intervenção não deve ser pergunta seca. */
export const deveContribuir = (perguntasSeguidas: number, dif: Dificuldade): boolean =>
  perguntasSeguidas >= 2 || dif === "alta";

/* ------------------------------------------------------------------
 * ESCOLHA DA CONTRIBUIÇÃO
 * ------------------------------------------------------------------ */

export type AcaoContribuicao =
  | "contextualizar"
  | "trazer_analogia"
  | "dar_exemplo"
  | "reformular_perspectiva"
  | "conectar_pontos"
  | "fazer_hipotese"
  | "validar_hipotese"
  | "resumir"
  | "ficar_em_silencio";

export type Contribuicao = {
  nextAction: AcaoContribuicao;
  alvo: string;
  exemplo: string;
  motivo: string;
};

const val = (m: Mapa, k: keyof Mapa): string | null => {
  const s = m[k];
  return s && s.estado !== "nao_explorado" && s.valor ? s.valor : null;
};

/**
 * Decide qual contribuição faz mais sentido AGORA. Retorna null quando
 * perguntar continua sendo a melhor ação.
 */
export function escolherContribuicao(params: {
  mapa?: Mapa | undefined;
  perfil?: PerfilCliente | undefined;
  sinais?: Partial<SinaisFala> | undefined;
  dorAtual?: DorAtual | undefined;
  perguntasSeguidas?: number | undefined;
  rota?: string | null | undefined;
  clienteEngajado?: boolean | undefined;
}): Contribuicao | null {
  const mapa = params.mapa ?? novoMapa();
  const sinais = params.sinais ?? {};
  const dif = dificuldadeCliente(params.perfil);
  const perguntasSeguidas = params.perguntasSeguidas ?? 0;
  const objetivo = val(mapa, "objetivo") ?? val(mapa, "motivacao");

  // 1) A formulação anterior falhou: assuma a responsabilidade e reformule com exemplos.
  if (sinais.naoEntendeu) {
    return {
      nextAction: "reformular_perspectiva",
      alvo: "reformular de forma concreta, com exemplos, a pergunta que não foi entendida",
      exemplo:
        "Deixa eu colocar de outra forma. Reunião, vaga, certificação, cliente de fora — tem alguma dessas em que o inglês faria diferença?",
      motivo: "o cliente não entendeu a pergunta anterior — a culpa é da formulação, não dele",
    };
  }

  // 2) Dor atual negada: pare de caçar dor e devolva uma leitura.
  if (params.dorAtual === "negada" || (params.perfil?.negacoesDeDor ?? 0) >= 2) {
    if (objetivo) {
      return {
        nextAction: "validar_hipotese",
        alvo: "validar que o inglês é ferramenta de ambição, não remédio para dor atual",
        exemplo:
          "Então talvez eu esteja procurando uma dor que não existe. O inglês parece ser sobre ampliar teu alcance. Faz sentido?",
        motivo: "ele negou impacto atual — reposicione para ambição em vez de insistir na dor",
      };
    }
    return {
      nextAction: "reformular_perspectiva",
      alvo: "reposicionar a conversa do problema de hoje para o que ele quer acessar depois",
      exemplo:
        "Faz sentido. Hoje o inglês não resolve nada do teu cargo atual. Ele parece ligado ao próximo passo.",
      motivo: "dor atual negada — mudar a leitura vale mais do que outra pergunta",
    };
  }

  // 3) Ele resistiu ao enquadramento: admita a mudança de leitura.
  if (sinais.resistiuEnquadramento) {
    return {
      nextAction: "reformular_perspectiva",
      alvo: "admitir a leitura errada e devolver o entendimento certo",
      exemplo: "Entendi, então eu estava olhando pelo lado errado. Isso muda a leitura aqui.",
      motivo: "ele recusou o enquadramento — adaptar gera mais rapport do que insistir",
    };
  }

  // 4) Resposta abstrata/vaga: tangibilize com exemplos antes de perguntar.
  if (sinais.respostaVaga || dif === "alta") {
    return {
      nextAction: "dar_exemplo",
      alvo: "tangibilizar com 2 ou 3 exemplos concretos antes de perguntar",
      exemplo:
        "Quando você fala em crescer, pode ser promoção, vaga internacional, ganhar em dólar. Qual desses pesa mais?",
      motivo: "resposta abstrata: exemplos concretos facilitam a próxima resposta",
    };
  }

  // 5) Perguntas demais seguidas: devolva o que já entendeu.
  if (perguntasSeguidas >= 2) {
    const problema = val(mapa, "problema");
    if (objetivo && problema) {
      return {
        nextAction: "conectar_pontos",
        alvo: "conectar o que ele quer com o que hoje o separa disso",
        exemplo: "Você quer chegar mais longe e hoje o idioma é justamente o que segura esse passo.",
        motivo: "várias perguntas seguidas — conectar os pontos vale mais que outra pergunta",
      };
    }
    return {
      nextAction: "resumir",
      alvo: "devolver em uma frase o que já ficou claro até aqui",
      exemplo: "Até aqui, o que você me trouxe é muito mais ambição do que problema atual.",
      motivo: "perguntas seguidas demais — resuma e deixe ele reagir",
    };
  }

  // 6) Cliente engajado logo após uma boa reflexão: silêncio é intervenção.
  if (params.clienteEngajado && perguntasSeguidas === 0 && dif !== "baixa") {
    return {
      nextAction: "ficar_em_silencio",
      alvo: "nada — deixe o cliente completar o raciocínio",
      exemplo: "",
      motivo: "ele está desenvolvendo sozinho: interromper agora custa mais do que ganha",
    };
  }

  // 7) Cliente técnico com capacidade reconhecida: contraste capacidade x alcance.
  if (dif === "media" && objetivo && !val(mapa, "impacto")) {
    return {
      nextAction: "contextualizar",
      alvo: "contrastar capacidade técnica atual com o alcance que o idioma abriria",
      exemplo:
        "A limitação não parece ser técnica. Você já entrega. O inglês entraria pra aumentar o alcance disso.",
      motivo: "contextualizar antes de perguntar reduz a sensação de interrogatório",
    };
  }

  return null;
}

/* ------------------------------------------------------------------
 * HEURÍSTICA: VALOR DA INTERVENÇÃO
 * ------------------------------------------------------------------ */

export type ValorIntervencao = {
  pontos: number;
  aprovada: boolean;
  criterios: Record<string, boolean>;
};

/**
 * Uma frase só vira card se demonstrar escuta, adicionar clareza, ajudar o
 * cliente a pensar, conectar pontos, evitar repetição e facilitar a resposta.
 */
export function valorDaIntervencao(
  frase: string,
  ctx: {
    ultimaFalaCliente?: string | undefined;
    sugestoesAnteriores?: string[] | undefined;
    perguntasSeguidas?: number | undefined;
    dificuldade?: Dificuldade | undefined;
  } = {},
): ValorIntervencao {
  const f = (frase || "").trim();
  const palavrasCliente = (ctx.ultimaFalaCliente || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((p) => p.length >= 5);
  const baixo = f.toLowerCase();

  const criterios: Record<string, boolean> = {
    demonstraEscuta: palavrasCliente.some((p) => baixo.includes(p)),
    adicionaClareza: !ehPergunta(f) || /por exemplo|como|tipo|;|,/.test(f),
    ajudaAPensar: !ehPergunta(f) || f.split(/\s+/).length >= 10,
    conectaPontos: /ent[ãa]o|parece|ou seja|na verdade|al[ée]m/i.test(f),
    evitaRepeticao: !(ctx.sugestoesAnteriores ?? []).some(
      (s) => s.trim().toLowerCase() === baixo,
    ),
    facilitaResposta: !ehPergunta(f) || /ou|,|por exemplo/.test(f),
    respeitaRitmo: !(ehPergunta(f) && (ctx.perguntasSeguidas ?? 0) >= 2),
  };
  const pontos = Object.values(criterios).filter(Boolean).length;
  const minimo = ctx.dificuldade === "alta" ? 5 : 4;
  return { pontos, aprovada: !!f && !!criterios["evitaRepeticao"] && pontos >= minimo, criterios };
}

/* ------------------------------------------------------------------
 * BLOCO DE PROMPT
 * ------------------------------------------------------------------ */

export function contribuicaoParaPrompt(params: {
  perfil?: PerfilCliente | undefined;
  dorAtual?: DorAtual | undefined;
  perguntasSeguidas?: number | undefined;
  contribuicao?: Contribuicao | null | undefined;
}): string {
  const perfil = { ...novoPerfil(), ...(params.perfil ?? {}) };
  const dif = dificuldadeCliente(perfil);
  const linhas: string[] = [];
  linhas.push(`PERFIL DO CLIENTE: dificuldade ${dif} (vagas: ${perfil.respostasVagas}, não entendeu: ${perfil.perguntasNaoEntendidas}, negou dor: ${perfil.negacoesDeDor}, resistiu: ${perfil.resistenciaAEnquadramento})`);
  linhas.push(`DOR ATUAL: ${params.dorAtual ?? "desconhecida"}`);
  linhas.push(`PERGUNTAS CONSECUTIVAS JÁ SUGERIDAS: ${params.perguntasSeguidas ?? 0}`);
  if (params.contribuicao) {
    linhas.push(
      `INTERVENÇÃO RECOMENDADA (não é pergunta): ${params.contribuicao.nextAction} — ${params.contribuicao.motivo}`,
    );
    linhas.push(`OBJETIVO DA FALA: ${params.contribuicao.alvo}`);
    if (params.contribuicao.exemplo)
      linhas.push(`REFERÊNCIA (não copie literalmente): ${params.contribuicao.exemplo}`);
  }
  if (dif !== "baixa")
    linhas.push(
      "CLIENTE DIFÍCIL: menos perguntas abstratas, mais contexto, exemplos concretos e hipóteses para ele validar.",
    );
  return linhas.join("\n");
}
