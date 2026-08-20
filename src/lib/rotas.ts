/**
 * V2.8 — MOTIVAÇÃO DOMINANTE E ROTAS DE DESCOBERTA
 *
 * Um bom vendedor não conduz todos os clientes pelo mesmo caminho de SPIN.
 * Ele entende o que move aquela pessoa, escolhe a rota de descoberta certa,
 * aprofunda o ponto certo e só encerra quando tem material para personalizar.
 *
 * Este módulo:
 *  1. pontua as motivações dominantes a partir da fala do cliente;
 *  2. escolhe a rota de descoberta (podendo mudar durante a call);
 *  3. entrega o próximo passo da escada daquela rota;
 *  4. decide a PRÓXIMA AÇÃO comercial segundo a hierarquia de decisão.
 */

import {
  type Mapa,
  type Profundidade,
  type SlotKey,
  novoMapa,
  profundidadeDe,
} from "./mapa";

export const MOTIVACOES = [
  "dor_passada",
  "risco_futuro",
  "ambicao_crescimento",
  "janela_oportunidade",
  "frustracao_anterior",
] as const;

export type Motivacao = (typeof MOTIVACOES)[number];

export type Motivacoes = Record<Motivacao, number>;

export type Intensidade = "baixa" | "media" | "alta";

export const MOTIVACOES_ZERO: Motivacoes = {
  dor_passada: 0,
  risco_futuro: 0,
  ambicao_crescimento: 0,
  janela_oportunidade: 0,
  frustracao_anterior: 0,
};

export const novoMotivacoes = (): Motivacoes => ({ ...MOTIVACOES_ZERO });

/** Evidências na fala do CLIENTE que apontam cada motor. */
const PADROES: Record<Motivacao, RegExp[]> = {
  dor_passada: [
    /\b(perdi|j[áa] perdi|deixei de|deixei passar|nem tentei|n[ãa]o me candidatei)\b[^.!?]{0,60}/i,
    /\b(perdi (a|uma) (vaga|promo[çc][ãa]o|oportunidade|chance|cliente)|n[ãa]o consegui a vaga|fiquei de fora|me tiraram|n[ãa]o pude (ir|viajar|participar))\b/i,
    /\b(passei vergonha|passei constrangimento|fiquei constrangid[oa]|travei na reuni[ãa]o|fiquei boiando|n[ãa]o entendi nada na (call|reuni[ãa]o))\b/i,
    /\b(dependo (d[aoe]|da minha|do meu)|fico dependente|preciso (que alguém|de alguém) (traduza|fale por mim))\b/i,
    /\b(perdi dinheiro|deixei de ganhar|me custou)\b/i,
  ],
  risco_futuro: [
    /\b(vai (aumentar|crescer|virar|exigir|passar a)|tende a|come[çc]ando a exigir|v[ãa]o (exigir|cobrar|come[çc]ar))\b/i,
    /\b(empresa (est[áa] )?(internacionaliz|expandindo|abrindo)|matriz (l[áa] )?fora|clientes (de fora|estrangeiros|internacionais)|projetos internacionais)\b/i,
    /\b(daqui a (um|dois|tr[êe]s) anos|no futuro|em breve|pr[óo]xim[oa] (promo[çc][ãa]o|cargo)|novas responsabilidades|mudan[çc]a na empresa)\b/i,
  ],
  ambicao_crescimento: [
    /\b(quero (crescer|evoluir|subir|chegar|me diferenciar)|crescer na (empresa|carreira)|pr[óo]ximo n[íi]vel|outro patamar)\b/i,
    /\b(morar (fora|no exterior)|trabalhar fora|ganhar em d[óo]lar|carreira internacional|vaga internacional|interc[âa]mbio|intercambio|viajar)\b/i,
    /\b(quero ganhar mais|aumentar (meu )?sal[áa]rio|certifica[çc][ãa]o|liberdade|abrir portas|novas oportunidades)\b/i,
  ],
  janela_oportunidade: [
    /\b(mudei de (emprego|cargo|[áa]rea)|terminei (a )?(faculdade|p[óo]s|gradua[çc][ãa]o|mestrado)|acabei de terminar|novo ciclo)\b/i,
    /\b(agora (eu )?(tenho|consigo) (mais )?tempo|minha rotina (estabilizou|acalmou|melhorou)|vou ficar (\w+ )?(anos|meses) (na mesma|aqui|nessa))\b/i,
    /\b(melhorou (financeiramente|meu financeiro)|consegui me organizar|filhos cresceram|terminei (o|aquele) projeto|surgiu uma bolsa)\b/i,
    /\b([ée] (o|esse) momento|t[áa] na hora|agora d[áa] (pra|para))\b/i,
  ],
  frustracao_anterior: [
    /\b(j[áa] (fiz|comecei|tentei)|fiz (um|dois|tr[êe]s|v[áa]rios) cursos?|come[çc]ei (e|mas) (parei|larguei)|tentei (v[áa]rias vezes|de novo))\b/i,
    /\b(parei|desisti|larguei|abandonei|n[ãa]o continuei|n[ãa]o consegui manter|n[ãa]o evolu[íi])\b/i,
    /\b(m[ée]todo (ruim|n[ãa]o funcionou)|s[óo] gram[áa]tica|hor[áa]rio (n[ãa]o batia|incompat[íi]vel)|turma (grande|ruim)|pouca pr[áa]tica|fiquei frustrad[oa])\b/i,
  ],
};

/** Peso de cada motor na fala atual (0 quando não há evidência). */
export function pontuarFala(text: string): Partial<Motivacoes> {
  const t = (text || "").trim();
  if (!t) return {};
  const prof = profundidadeDe(t);
  const bonus: Record<Profundidade, number> = { baixa: 0, media: 0.5, alta: 1 };
  const out: Partial<Motivacoes> = {};
  for (const m of MOTIVACOES) {
    const hits = PADROES[m].filter((re) => re.test(t)).length;
    if (hits) out[m] = Math.min(3, hits + bonus[prof]);
  }
  return out;
}

/** Acumula na conversa inteira. O motor pode mudar de dominante ao longo da call. */
export function acumularMotivacoes(atual: Motivacoes | undefined, text: string): {
  motivacoes: Motivacoes;
  naFala: Motivacao[];
} {
  const base: Motivacoes = { ...novoMotivacoes(), ...(atual ?? {}) };
  const fala = pontuarFala(text);
  const naFala: Motivacao[] = [];
  for (const m of MOTIVACOES) {
    const v = fala[m];
    if (!v) continue;
    base[m] = Math.min(10, Number((base[m] + v).toFixed(2)));
    naFala.push(m);
  }
  return { motivacoes: base, naFala };
}

export const intensidade = (v: number): Intensidade => (v >= 3 ? "alta" : v >= 1.2 ? "media" : "baixa");

/**
 * Rota dominante: prioriza o que o cliente ACABOU de abrir (relevância emocional
 * e continuidade), mas só quando aquilo tem peso comercial. Senão, o maior acumulado.
 */
export function rotaDominante(motivacoes: Motivacoes | undefined, naFala: Motivacao[] = []): Motivacao | null {
  const m: Motivacoes = { ...novoMotivacoes(), ...(motivacoes ?? {}) };
  const recente = naFala.filter((k) => m[k] >= 1).sort((a, b) => m[b] - m[a])[0];
  if (recente) return recente;
  const melhor = [...MOTIVACOES].sort((a, b) => m[b] - m[a])[0];
  return melhor && m[melhor] >= 1 ? melhor : null;
}

/** Rotas ativas (todas as que têm peso) — um cliente pode ter várias. */
export function rotasAtivas(motivacoes: Motivacoes | undefined): Array<{ rota: Motivacao; intensidade: Intensidade }> {
  const m: Motivacoes = { ...novoMotivacoes(), ...(motivacoes ?? {}) };
  return MOTIVACOES.filter((k) => m[k] >= 1)
    .sort((a, b) => m[b] - m[a])
    .map((rota) => ({ rota, intensidade: intensidade(m[rota]) }));
}

/* ------------------------------------------------------------------
 * ESCADAS DE APROFUNDAMENTO — uma por rota.
 * Cada degrau só é sugerido se o cliente ainda não entregou aquilo.
 * ------------------------------------------------------------------ */

export type NextAction =
  | "aprofundar_dor"
  | "aprofundar_risco"
  | "expandir_ambicao"
  | "explorar_timing"
  | "explorar_historico"
  | "confirmar"
  | "resumir"
  | "descobrir_criterio"
  | "apresentar"
  | "tratar_objecao"
  | "ficar_em_silencio";

type Degrau = {
  /** O que ainda queremos descobrir. */
  alvo: string;
  /** Exemplo de fala natural (referência, não script). */
  exemplo: string;
  /** Já temos isso no mapa? */
  pronto: (m: Mapa) => boolean;
};

const respondido = (m: Mapa, k: SlotKey) => (m[k]?.estado ?? "nao_explorado") === "respondido";
const forte = (m: Mapa, k: SlotKey) =>
  respondido(m, k) && (m[k]?.profundidade ?? "baixa") !== "baixa";
const profundo = (m: Mapa, k: SlotKey) => respondido(m, k) && (m[k]?.profundidade ?? "baixa") === "alta";

export const ROTAS: Record<
  Motivacao,
  { rotulo: string; acao: NextAction; escada: Degrau[] }
> = {
  dor_passada: {
    rotulo: "DOR CONCRETA / PERDA PASSADA",
    acao: "aprofundar_dor",
    escada: [
      {
        alvo: "o que exatamente aconteceu",
        exemplo: "O que aconteceu nessa situação?",
        pronto: (m) => respondido(m, "oportunidade_perdida") || forte(m, "problema"),
      },
      {
        alvo: "o tamanho/importância dessa perda",
        exemplo: "Essa oportunidade era boa de verdade?",
        pronto: (m) => profundo(m, "oportunidade_perdida") || profundo(m, "impacto"),
      },
      {
        alvo: "se foi mesmo o inglês que causou",
        exemplo: "E foi realmente o inglês que acabou te tirando dela?",
        pronto: (m) => forte(m, "problema") && forte(m, "impacto"),
      },
      {
        alvo: "a consequência prática disso",
        exemplo: "Depois disso, o que mudou no seu trabalho?",
        pronto: (m) => forte(m, "impacto"),
      },
      {
        alvo: "por que ele ainda não resolveu",
        exemplo: "Depois de passar por isso, o que fez você ainda não começar?",
        pronto: (m) => respondido(m, "motivo_interrupcao") || forte(m, "gatilho_agora"),
      },
    ],
  },
  risco_futuro: {
    rotulo: "RISCO FUTURO",
    acao: "aprofundar_risco",
    escada: [
      {
        alvo: "o que está mudando no ambiente dele",
        exemplo: "O que está mudando aí na empresa em relação ao inglês?",
        pronto: (m) => forte(m, "gatilho_agora") || forte(m, "problema"),
      },
      {
        alvo: "a projeção: como fica se isso virar rotina",
        exemplo: "Se isso começar a virar rotina, como fica pra você?",
        pronto: (m) => forte(m, "impacto"),
      },
      {
        alvo: "o que pode ficar na mão de outra pessoa",
        exemplo: "Que tipo de oportunidade pode acabar indo pra outra pessoa?",
        pronto: (m) => profundo(m, "impacto") || respondido(m, "oportunidade_perdida"),
      },
      {
        alvo: "o valor de resolver antes disso acontecer",
        exemplo: "Se você resolvesse isso antes, o que mudaria?",
        pronto: (m) => forte(m, "necessidade"),
      },
    ],
  },
  ambicao_crescimento: {
    rotulo: "AMBIÇÃO / CRESCIMENTO",
    acao: "expandir_ambicao",
    escada: [
      {
        alvo: "o futuro desejado, concreto",
        exemplo: "Se o inglês deixasse de ser uma limitação, onde você chegaria?",
        pronto: (m) => forte(m, "objetivo"),
      },
      {
        alvo: "o que hoje ainda o separa disso",
        exemplo: "O que hoje ainda falta pra você conseguir isso?",
        pronto: (m) => respondido(m, "problema"),
      },
      {
        alvo: "a porta que ele abriria primeiro",
        exemplo: "Se estivesse falando inglês hoje, qual porta você tentaria abrir primeiro?",
        pronto: (m) => forte(m, "necessidade") || forte(m, "impacto"),
      },
      {
        alvo: "por que agora virou prioridade",
        exemplo: "O que fez esse assunto virar prioridade justamente agora?",
        pronto: (m) => forte(m, "gatilho_agora") || forte(m, "urgencia"),
      },
    ],
  },
  janela_oportunidade: {
    rotulo: "JANELA DE OPORTUNIDADE",
    acao: "explorar_timing",
    escada: [
      {
        alvo: "o que mudou agora",
        exemplo: "O que está diferente agora em relação às outras vezes?",
        pronto: (m) => forte(m, "gatilho_agora"),
      },
      {
        alvo: "por quanto tempo essa janela existe",
        exemplo: "Essa janela mais tranquila deve durar quanto tempo?",
        pronto: (m) => respondido(m, "urgencia") || respondido(m, "disponibilidade"),
      },
      {
        alvo: "o custo de deixar a janela passar",
        exemplo: "Se você não aproveitar esse período, o que acontece depois?",
        pronto: (m) => forte(m, "impacto") || forte(m, "necessidade"),
      },
    ],
  },
  frustracao_anterior: {
    rotulo: "TENTATIVAS FRUSTRADAS",
    acao: "explorar_historico",
    escada: [
      {
        alvo: "o que fez as tentativas anteriores falharem",
        exemplo: "O que fez você parar nas outras vezes?",
        pronto: (m) => respondido(m, "motivo_interrupcao"),
      },
      {
        alvo: "se foi o curso ou a rotina",
        exemplo: "Você sentiu que foi o curso ou conseguir manter a rotina?",
        pronto: (m) => forte(m, "motivo_interrupcao") || respondido(m, "percepcao_metodologia"),
      },
      {
        alvo: "o que precisaria ser diferente agora",
        exemplo: "Se fosse começar de novo, o que teria que ser diferente dessa vez?",
        pronto: (m) => respondido(m, "criterio_compra"),
      },
    ],
  },
};

/** Próximo degrau ainda não cumprido da rota. */
export function proximoPassoRota(rota: Motivacao | null, mapa: Mapa): Degrau | null {
  if (!rota) return null;
  return ROTAS[rota].escada.find((d) => !d.pronto(mapa)) ?? null;
}

/* ------------------------------------------------------------------
 * CRITÉRIO DE COMPRA E GANCHOS DE APRESENTAÇÃO
 * ------------------------------------------------------------------ */

export const CRITERIOS = [
  "flexibilidade",
  "conversacao",
  "foco_corporativo",
  "velocidade",
  "pratica",
  "acompanhamento",
  "certificacao",
  "metodologia",
  "aulas_ao_vivo",
  "preco",
] as const;

export type Criterio = (typeof CRITERIOS)[number];

const CRITERIO_PADROES: Record<Criterio, RegExp> = {
  flexibilidade: /\b(hor[áa]rio flex[íi]vel|flexibilidade|no meu hor[áa]rio|quando eu puder|minha rotina (muda|varia)|escala|viajo muito)\b/i,
  conversacao: /\b(conversa[çc][ãa]o|falar mais|praticar (a )?fala|conversar|destravar a fala)\b/i,
  foco_corporativo: /\b(ingl[êe]s (corporativo|para neg[óo]cios|t[ée]cnico)|reuni[ãa]o|call|apresenta[çc][ãa]o|business)\b/i,
  velocidade: /\b(r[áa]pido|em (seis|6|tr[êe]s|3) meses|curto prazo|acelerar|n[ãa]o quero (levar|demorar) anos)\b/i,
  pratica: /\b(pr[áa]tica|praticar|mais pr[áa]tico|menos teoria|pouca gram[áa]tica|nativo)\b/i,
  acompanhamento: /\b(acompanhamento|algu[ée]m me cobrando|suporte|professor acompanhando|corre[çc][ãa]o)\b/i,
  certificacao: /\b(certifica[çc][ãa]o|toefl|ielts|certificado|prova de profici[êe]ncia)\b/i,
  metodologia: /\b(metodologia|m[ée]todo|como funciona a aula|did[áa]tica)\b/i,
  aulas_ao_vivo: /\b(ao vivo|aula com professor|n[ãa]o quero (v[íi]deo|gravado)|presencial|online ao vivo)\b/i,
  preco: /\b(pre[çc]o|valor|investimento|caber no bolso|mensalidade)\b/i,
};

/** Critérios de compra citados espontaneamente pelo cliente. */
export function detectarCriterios(text: string): Criterio[] {
  const t = (text || "").trim();
  if (!t) return [];
  return CRITERIOS.filter((c) => CRITERIO_PADROES[c].test(t));
}

export type Gancho = { necessidade: string; featureRelacionada: string };

const FEATURE_POR_SLOT: Partial<Record<SlotKey, string>> = {
  problema: "conversacao",
  impacto: "conversacao",
  oportunidade_perdida: "foco_corporativo",
  barreira_tempo: "horarios_flexiveis",
  disponibilidade: "horarios_flexiveis",
  motivo_interrupcao: "acompanhamento",
  percepcao_metodologia: "metodologia",
  objetivo: "plano_personalizado",
  urgencia: "velocidade",
};

const FEATURE_POR_CRITERIO: Record<Criterio, string> = {
  flexibilidade: "horarios_flexiveis",
  conversacao: "conversacao",
  foco_corporativo: "ingles_corporativo",
  velocidade: "plano_acelerado",
  pratica: "pratica_com_professor",
  acompanhamento: "acompanhamento",
  certificacao: "toefl",
  metodologia: "metodologia",
  aulas_ao_vivo: "aulas_ao_vivo",
  preco: "condicoes",
};

/** Pontos da conversa que a apresentação deve reaproveitar, nas palavras do cliente. */
export function ganchosApresentacao(mapa: Mapa, criterios: string[] = []): Gancho[] {
  const m = mapa ?? novoMapa();
  const out: Gancho[] = [];
  for (const [slot, feature] of Object.entries(FEATURE_POR_SLOT) as Array<[SlotKey, string]>) {
    const s = m[slot];
    if (!s || s.estado === "nao_explorado" || !s.valor) continue;
    if ((s.profundidade ?? "baixa") === "baixa" && slot !== "barreira_tempo") continue;
    out.push({ necessidade: s.valor, featureRelacionada: feature });
  }
  for (const c of criterios) {
    const feature = FEATURE_POR_CRITERIO[c as Criterio];
    if (feature && !out.some((g) => g.featureRelacionada === feature)) {
      out.push({ necessidade: `critério citado: ${c}`, featureRelacionada: feature });
    }
  }
  return out.slice(0, 6);
}

/* ------------------------------------------------------------------
 * HIERARQUIA DE DECISÃO — qual é a melhor intervenção AGORA
 * ------------------------------------------------------------------ */

export type Decisao = {
  rota: Motivacao | null;
  rotasAtivas: Array<{ rota: Motivacao; intensidade: Intensidade }>;
  nextAction: NextAction;
  informacaoQueQuerDescobrir: string;
  exemplo: string | null;
  motivo: string;
  profundidadeAtual: Profundidade;
};

const PILARES: Array<{ chave: string; ok: (m: Mapa) => boolean }> = [
  { chave: "o que ele quer", ok: (m) => respondido(m, "objetivo") || respondido(m, "motivacao") },
  { chave: "o que está no caminho", ok: (m) => respondido(m, "problema") },
  { chave: "por que isso importa", ok: (m) => forte(m, "impacto") || forte(m, "necessidade") || profundo(m, "oportunidade_perdida") },
  { chave: "por que agir agora", ok: (m) => forte(m, "gatilho_agora") || forte(m, "urgencia") },
  { chave: "o que a solução precisa ter", ok: (m) => respondido(m, "criterio_compra") },
];

/** Profundidade média do material comercial já coletado. */
export function profundidadeAtual(mapa: Mapa): Profundidade {
  const m = mapa ?? novoMapa();
  const chaves: SlotKey[] = ["objetivo", "problema", "impacto", "necessidade", "urgencia", "criterio_compra"];
  const valores = chaves
    .map((k) => m[k])
    .filter((s) => s && s.estado !== "nao_explorado")
    .map((s) => ({ baixa: 0, media: 1, alta: 2 })[s!.profundidade ?? "baixa"]);
  if (!valores.length) return "baixa";
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  return media >= 1.5 ? "alta" : media >= 0.8 ? "media" : "baixa";
}

/** Pilares de descoberta ainda faltando (conteúdo, não perguntas feitas). */
export function pilaresFaltando(mapa: Mapa): string[] {
  const m = mapa ?? novoMapa();
  return PILARES.filter((p) => !p.ok(m)).map((p) => p.chave);
}

/**
 * Escolhe a próxima ação comercial segundo a hierarquia:
 * 1) o que o cliente acabou de revelar → 2) o que ele quer e o que impede →
 * 3) profundidade pela rota dominante → 4) timing → 5) critério de compra → 6) avançar.
 */
export function decidirProximaAcao(params: {
  mapa: Mapa;
  motivacoes?: Motivacoes;
  naFala?: Motivacao[];
  spinSuficiente?: boolean;
  minimizou?: boolean;
  perguntasSeguidas?: number;
  objecaoAtiva?: boolean;
}): Decisao {
  const mapa = params.mapa ?? novoMapa();
  const ativas = rotasAtivas(params.motivacoes);
  let rota = rotaDominante(params.motivacoes, params.naFala ?? []);
  const prof = profundidadeAtual(mapa);
  const faltando = pilaresFaltando(mapa);

  const base = (nextAction: NextAction, alvo: string, motivo: string, exemplo: string | null = null): Decisao => ({
    rota,
    rotasAtivas: ativas,
    nextAction,
    informacaoQueQuerDescobrir: alvo,
    exemplo,
    motivo,
    profundidadeAtual: prof,
  });

  if (params.objecaoAtiva) return base("tratar_objecao", "a trava real por trás da objeção", "objeção ativa na fala do cliente");

  // Minimizou a dor: a rota emocional morreu — vá para ambição, janela ou timing.
  if (params.minimizou) {
    const alternativa = ativas.find((a) => a.rota !== "dor_passada")?.rota ?? "ambicao_crescimento";
    rota = alternativa;
    const passo = proximoPassoRota(alternativa, mapa);
    return base(
      ROTAS[alternativa].acao,
      passo?.alvo ?? "o que o levou a olhar inglês agora",
      "cliente minimizou a dor — troque de rota, não insista na perda",
      passo?.exemplo ?? "O que te fez pensar em começar justamente agora?",
    );
  }

  // Anti-interrogatório: várias perguntas seguidas → validar/resumir.
  if ((params.perguntasSeguidas ?? 0) >= 2 && !params.spinSuficiente) {
    return base("confirmar", "validar com as palavras dele o que já foi dito", "perguntas seguidas demais — confirme antes de perguntar de novo");
  }

  // Material suficiente: falta apenas o critério de compra antes de apresentar.
  if (params.spinSuficiente) {
    if (!respondido(mapa, "criterio_compra"))
      return base(
        "descobrir_criterio",
        "o que um curso precisa ter para fazer sentido pra ele",
        "há material de descoberta; falta o critério para personalizar a apresentação",
        "Dentro do que você busca, o que um curso precisa ter pra você falar: é isso?",
      );
    return base("apresentar", "nada — avance para a apresentação personalizada", "material comercial e critério de compra completos");
  }

  // Rota dominante manda no aprofundamento.
  const passo = proximoPassoRota(rota, mapa);
  if (rota && passo) {
    return base(ROTAS[rota].acao, passo.alvo, `rota ${rota}: ainda falta ${passo.alvo}`, passo.exemplo);
  }

  // Sem rota clara: siga os pilares que faltam.
  if (faltando.includes("o que ele quer"))
    return base("expandir_ambicao", "o que ele quer conquistar com o inglês", "ainda não sabemos o que move esse cliente", "O que você quer conseguir com o inglês?");
  if (faltando.includes("o que está no caminho"))
    return base("aprofundar_dor", "o que hoje trava esse objetivo", "temos objetivo, falta o que impede", "Hoje, onde o inglês mais te trava?");
  if (faltando.includes("por que isso importa"))
    return base("aprofundar_dor", "a consequência prática disso", "falta o peso comercial do problema", "E isso já te custou alguma oportunidade?");
  if (faltando.includes("por que agir agora"))
    return base("explorar_timing", "o que mudou para ele resolver agora", "falta entender o timing", "O que fez esse assunto virar prioridade agora?");
  if (faltando.includes("o que a solução precisa ter"))
    return base("descobrir_criterio", "o critério de compra dele", "falta saber o que ele espera do curso", "O que um curso precisa ter pra fazer sentido pra você?");

  return base("resumir", "confirmar o quadro com as palavras dele", "o quadro está fechado — confirme e avance");
}

/** Bloco textual enviado ao modelo com a leitura de motivação e rota. */
export function rotaParaPrompt(d: Decisao): string {
  const linhas: string[] = [];
  linhas.push(
    `MOTIVAÇÃO DOMINANTE: ${d.rota ? ROTAS[d.rota].rotulo : "ainda não identificada"}${
      d.rotasAtivas.length > 1
        ? ` (também ativas: ${d.rotasAtivas
            .filter((r) => r.rota !== d.rota)
            .map((r) => `${r.rota} ${r.intensidade}`)
            .join(", ")})`
        : ""
    }`,
  );
  linhas.push(`PROFUNDIDADE COMERCIAL ATUAL: ${d.profundidadeAtual}`);
  linhas.push(`PRÓXIMA AÇÃO: ${d.nextAction} — ${d.motivo}`);
  linhas.push(`DESCOBRIR AGORA: ${d.informacaoQueQuerDescobrir}`);
  if (d.exemplo) linhas.push(`REFERÊNCIA DE FALA (não copie literalmente): ${d.exemplo}`);
  return linhas.join("\n");
}
