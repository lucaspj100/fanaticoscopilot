/**
 * MAPA VIVO DO CLIENTE (V2.6)
 *
 * O copiloto deixa de raciocinar apenas com "fala atual + etapa" e passa a
 * raciocinar com TUDO que já foi descoberto na call.
 *
 * Cada ponto importante da conversa é um SLOT com três estados possíveis:
 *   nao_explorado | parcial | respondido
 *
 * A informação NÃO precisa ter vindo de uma pergunta: se o cliente falou
 * espontaneamente, o slot é preenchido do mesmo jeito.
 */

export type SlotEstado = "nao_explorado" | "parcial" | "respondido";

export type Slot = { estado: SlotEstado; valor: string | null };

export const SLOT_KEYS = [
  "objetivo",
  "motivacao",
  "problema",
  "impacto",
  "oportunidade_perdida",
  "urgencia",
  "experiencia_anterior",
  "motivo_interrupcao",
  "disponibilidade",
  "barreira_tempo",
  "percepcao_metodologia",
  "interesse",
  "decisor",
  "financeiro",
  "objecoes",
  "sinais_compra",
  "sinais_resistencia",
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];

export type Mapa = Record<SlotKey, Slot>;

const ORDEM: Record<SlotEstado, number> = { nao_explorado: 0, parcial: 1, respondido: 2 };

type SlotMeta = {
  rotulo: string;
  /** Prioridade de exploração — menor = mais importante descobrir antes. */
  prioridade: number;
  /** Evidência na fala do CLIENTE que preenche o slot (respondido). */
  respondido?: RegExp[];
  /** Evidência mais fraca — abre o assunto sem fechá-lo. */
  parcial?: RegExp[];
  /** Padrões que indicam que a FRASE sugerida tenta descobrir esse slot. */
  alvo?: RegExp[];
};

export const SLOTS: Record<SlotKey, SlotMeta> = {
  objetivo: {
    rotulo: "OBJETIVO",
    prioridade: 1,
    respondido: [
      /\b(quero|queria|pretendo|meu objetivo [ée]|to querendo|t[ôo] querendo|penso em)\b[^.!?]{4,}/i,
      /\b(promo[çc][ãa]o|crescer na (empresa|carreira)|morar (fora|no exterior)|viajar|ganhar em d[óo]lar|vaga internacional|intercambio|interc[âa]mbio|mudar de [áa]rea)\b/i,
    ],
    alvo: [
      /(objetivo|motiva[çc][ãa]o|por que|porque|pra que|para que|o que te (levou|fez)|qual.*(sonho|meta))/i,
    ],
  },
  motivacao: {
    rotulo: "MOTIVAÇÃO",
    prioridade: 2,
    respondido: [
      /\b(porque|por causa|j[áa] que|preciso (disso )?(pra|para))\b[^.!?]{6,}/i,
      /\b(decidi|resolvi) (olhar|ver|procurar|estudar|fazer)\b/i,
    ],
    alvo: [/(qual (é|e) (a )?sua (principal )?motiva[çc][ãa]o|por que (voc[êe] )?(quer|decidiu|resolveu))/i],
  },
  problema: {
    rotulo: "PROBLEMA",
    prioridade: 3,
    respondido: [
      /\b(travo|travei|trava|n[ãa]o consigo (falar|conversar|responder)|entendo mas n[ãa]o falo|me perco|fico perdid[oa]|gaguejo|bloqueio|inseguran[çc]a|fico insegur[oa]|passo vergonha|passei vergonha)\b/i,
      /\b(meu ingl[êe]s (é|e|t[áa]) (b[áa]sico|fraco|ruim|travado))\b/i,
    ],
    parcial: [/\b(preciso (melhorar|do ingl[êe]s)|quero aprender ingl[êe]s)\b/i],
    alvo: [/(o que.*(trava|dificulta|atrapalha)|qual.*(dificuldade|problema)|onde.*(trava|te limita))/i],
  },
  impacto: {
    rotulo: "IMPACTO",
    prioridade: 4,
    respondido: [
      /\b(evito|evitei|deixo de|deixei de|n[ãa]o participo|fiquei de fora|me tiraram|sa[íi] da reuni[ãa]o|n[ãa]o fui|me atrapalha (no|na) (trabalho|reuni[ãa]o|empresa))\b/i,
    ],
    alvo: [/(impacta|impacto|o que isso (te )?(custa|causa)|como isso (te )?atrapalha|consequ[êe]ncia)/i],
  },
  oportunidade_perdida: {
    rotulo: "OPORTUNIDADE PERDIDA",
    prioridade: 5,
    respondido: [
      /\b(perdi|j[áa] perdi|deixei passar|nem tentei|n[ãa]o me candidatei|n[ãa]o consegui a vaga|perdi (a|uma) (vaga|promo[çc][ãa]o|oportunidade|chance))\b/i,
      /\b(apareceu uma vaga)\b[^.!?]*\b(n[ãa]o|nem)\b/i,
    ],
    alvo: [/(perdeu|perdido).*(oportunidade|vaga|chance)|(j[áa] deixou de|deixou passar)/i],
  },
  urgencia: {
    rotulo: "URGÊNCIA",
    prioridade: 6,
    respondido: [
      /\b(at[ée] (o|a) (final|fim|pr[óo]xim[oa])|nesse semestre|neste semestre|em (dois|tr[êe]s|seis) meses|ano que vem|com urg[êe]ncia|o quanto antes|preciso pra j[áa]|processo (de|da) promo[çc][ãa]o)\b/i,
    ],
    alvo: [/(prazo|at[ée] quando|qu[ãa]o urgente|quando (voc[êe] )?(precisa|pretende))/i],
  },
  experiencia_anterior: {
    rotulo: "EXPERIÊNCIA ANTERIOR",
    prioridade: 7,
    respondido: [
      /\b(j[áa] (fiz|estudei|tentei|fui)|fiz (ingl[êe]s|curso|aula)|estudei (ingl[êe]s|numa escola)|fui (da|do) (wizard|ccaa|cultura|fisk|cna|kumon))\b/i,
      /\b(nunca (fiz|estudei) (ingl[êe]s|curso))\b/i,
    ],
    alvo: [/(j[áa] (fez|estudou|tentou)|alguma escola|curso antes|experi[êe]ncia (anterior|com curso))/i],
  },
  motivo_interrupcao: {
    rotulo: "MOTIVO DA INTERRUPÇÃO",
    prioridade: 8,
    respondido: [
      /\b(parei porque|tive que parar porque|desisti porque|larguei porque)\b[^.!?]{4,}/i,
      /\b(hor[áa]rio (mudava|n[ãa]o batia|incompat[íi]vel)|n[ãa]o (dava|consegui) (tempo|acompanhar)|engravidei|mudei de (cidade|emprego)|ficou caro)\b/i,
    ],
    parcial: [/\b(tive que parar|parei|desisti|larguei|n[ãa]o continuei)\b/i],
    alvo: [/(o que.*(fez|te levou a) parar|por que.*(parou|desistiu|n[ãa]o continuou))/i],
  },
  disponibilidade: {
    rotulo: "DISPONIBILIDADE",
    prioridade: 9,
    respondido: [
      /\b(tenho|consigo|posso)\b[^.!?]{0,20}\b(\d+|uma|duas|tr[êe]s)\b[^.!?]{0,12}\b(vezes|dias|horas|x por semana)\b/i,
      /\b(de (manh[ãa]|tarde|noite)|ap[óo]s o trabalho|final de semana|s[óo] [àa] noite)\b/i,
    ],
    alvo: [/(quantos dias|quantas vezes|disponibilidade|que hor[áa]rio|quanto tempo por semana)/i],
  },
  barreira_tempo: {
    rotulo: "BARREIRA DE TEMPO",
    prioridade: 10,
    respondido: [
      /\b(n[ãa]o tenho tempo|minha agenda [ée] (corrida|apertada)|meu hor[áa]rio (muda|varia)|viajo muito|fa[çc]o plant[ãa]o|escala)\b/i,
    ],
    alvo: [/(falta de tempo|sua rotina permite|conseguiria encaixar)/i],
  },
  percepcao_metodologia: {
    rotulo: "PERCEPÇÃO SOBRE METODOLOGIA",
    prioridade: 11,
    respondido: [
      /\b(m[ée]todo|metodologia|gram[áa]tica demais|s[óo] teoria|queria mais conversa[çc][ãa]o|aula (com nativo|particular|em grupo))\b/i,
    ],
    alvo: [/(metodologia|como voc[êe] gosta de (estudar|aprender)|o que espera do m[ée]todo)/i],
  },
  interesse: {
    rotulo: "INTERESSE",
    prioridade: 12,
    respondido: [
      /\b(gostei|achei (bom|[óo]timo|interessante)|faz sentido|[ée] isso mesmo|era isso que eu (queria|procurava)|adorei)\b/i,
    ],
    alvo: [/(o que (mais )?fez sentido|o que voc[êe] achou|gostou)/i],
  },
  decisor: {
    rotulo: "DECISÃO",
    prioridade: 13,
    respondido: [
      /\b(minha (esposa|mulher|m[ãa]e|filha)|meu (marido|esposo|pai|s[óo]cio|chefe)|meus pais|a gente decide junto|preciso (falar|conversar) com)\b/i,
      /\b(a decis[ãa]o [ée] (s[óo] )?minha|decido sozinh[oa]|quem decide sou eu)\b/i,
    ],
    alvo: [/(precisa (consultar|falar com|conversar com) alguém|mais alguém (na|participa da) decis[ãa]o|quem decide)/i],
  },
  financeiro: {
    rotulo: "FINANCEIRO",
    prioridade: 14,
    respondido: [
      /\b(est[áa] caro|t[áa] caro|acima do que|n[ãa]o tenho esse valor|n[ãa]o cabe no (meu )?or[çc]amento|fora do or[çc]amento|d[áa] desconto|consigo pagar at[ée])\b/i,
      /\b(posso investir at[ée]|meu or[çc]amento [ée])\b/i,
    ],
    parcial: [/\b(quanto (custa|fica|é)|qual o (valor|investimento))\b/i],
    alvo: [/(quanto voc[êe] (pode|poderia) investir|or[çc]amento|valor que caberia)/i],
  },
  objecoes: {
    rotulo: "OBJEÇÕES",
    prioridade: 15,
    respondido: [/\b(preciso pensar|vou pensar|n[ãa]o sei se|t[ôo] em d[úu]vida|receio|medo de n[ãa]o)\b/i],
    alvo: [/(alguma d[úu]vida|o que (te )?impediria|algum ponto que impede)/i],
  },
  sinais_compra: {
    rotulo: "SINAIS DE COMPRA",
    prioridade: 16,
    respondido: [
      /\b(quando (eu )?(come[çc]o|posso come[çc]ar)|como fa[çc]o (pra|para) (come[çc]ar|contratar)|manda o link|onde assino|quero fechar|vamos fechar)\b/i,
    ],
  },
  sinais_resistencia: {
    rotulo: "SINAIS DE RESISTÊNCIA",
    prioridade: 17,
    respondido: [
      /\b(n[ãa]o vou decidir hoje|n[ãa]o dou posicionamento|quero (ver|comparar) outras|s[óo] t[ôo] pesquisando|s[óo] estou pesquisando)\b/i,
    ],
  },
};

export const MAPA_VAZIO: Mapa = Object.fromEntries(
  SLOT_KEYS.map((k) => [k, { estado: "nao_explorado", valor: null } as Slot]),
) as Mapa;

export const novoMapa = (): Mapa =>
  Object.fromEntries(SLOT_KEYS.map((k) => [k, { estado: "nao_explorado", valor: null }])) as Mapa;

const texto = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.toLowerCase() !== "null" ? s.slice(0, 120) : null;
};

const estadoVal = (v: unknown): SlotEstado | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "nao_explorado" || s === "parcial" || s === "respondido" ? (s as SlotEstado) : null;
};

/** Normaliza qualquer objeto (vindo do cliente ou da IA) para um mapa válido. */
export function normalizarMapa(input: unknown): Mapa {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = novoMapa();
  for (const k of SLOT_KEYS) {
    const raw = o[k];
    if (!raw) continue;
    if (typeof raw === "string") {
      out[k] = { estado: "respondido", valor: texto(raw) };
      continue;
    }
    if (typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      const estado = estadoVal(r["estado"]);
      const valor = texto(r["valor"]);
      out[k] = { estado: estado ?? (valor ? "respondido" : "nao_explorado"), valor };
    }
  }
  return out;
}

/**
 * Descoberta LOCAL e instantânea (sem IA): qualquer informação espontânea
 * do cliente já entra no mapa antes mesmo da chamada de memória responder.
 */
export function inferirMapa(text: string): Partial<Record<SlotKey, Slot>> {
  const t = (text || "").trim();
  if (!t) return {};
  const out: Partial<Record<SlotKey, Slot>> = {};
  for (const k of SLOT_KEYS) {
    const meta = SLOTS[k];
    const trecho = (meta.respondido ?? []).map((re) => t.match(re)?.[0]).find(Boolean);
    if (trecho) {
      out[k] = { estado: "respondido", valor: t.slice(0, 120) };
      continue;
    }
    const parcial = (meta.parcial ?? []).some((re) => re.test(t));
    if (parcial) out[k] = { estado: "parcial", valor: t.slice(0, 120) };
  }
  // "Já fiz inglês, mas tive que parar" → experiência respondida, motivo parcial.
  if (out.motivo_interrupcao?.estado === "respondido" && !out.experiencia_anterior) {
    out.experiencia_anterior = { estado: "respondido", valor: t.slice(0, 120) };
  }
  return out;
}

/** Aplica um patch no mapa. O estado NUNCA retrocede. */
export function aplicarPatchMapa(
  atual: Mapa,
  patch: unknown,
): { mapa: Mapa; alterados: SlotKey[] } {
  const p = normalizarPatch(patch);
  const mapa: Mapa = { ...atual };
  const alterados: SlotKey[] = [];
  for (const k of SLOT_KEYS) {
    const novo = p[k];
    if (!novo) continue;
    const antigo = atual[k] ?? { estado: "nao_explorado", valor: null };
    const estado: SlotEstado = ORDEM[novo.estado] > ORDEM[antigo.estado] ? novo.estado : antigo.estado;
    const valor = antigo.valor && ORDEM[novo.estado] <= ORDEM[antigo.estado] ? antigo.valor : (novo.valor ?? antigo.valor);
    if (estado !== antigo.estado || valor !== antigo.valor) {
      mapa[k] = { estado, valor };
      alterados.push(k);
    }
  }
  return { mapa, alterados };
}

function normalizarPatch(patch: unknown): Partial<Record<SlotKey, Slot>> {
  if (!patch || typeof patch !== "object") return {};
  const o = patch as Record<string, unknown>;
  const out: Partial<Record<SlotKey, Slot>> = {};
  for (const k of SLOT_KEYS) {
    const raw = o[k];
    if (raw == null) continue;
    if (typeof raw === "string") {
      out[k] = { estado: "respondido", valor: texto(raw) };
      continue;
    }
    if (typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      const estado = estadoVal(r["estado"]);
      const valor = texto(r["valor"]);
      if (!estado && !valor) continue;
      out[k] = { estado: estado ?? "respondido", valor };
    }
  }
  return out;
}

/** Slots ainda não respondidos, em ordem de prioridade comercial. */
export function lacunas(mapa: Mapa): SlotKey[] {
  return SLOT_KEYS.filter((k) => (mapa[k]?.estado ?? "nao_explorado") !== "respondido").sort(
    (a, b) => SLOTS[a].prioridade - SLOTS[b].prioridade,
  );
}

/** Slots já descobertos (parcial ou respondido). */
export function descobertos(mapa: Mapa): SlotKey[] {
  return SLOT_KEYS.filter((k) => (mapa[k]?.estado ?? "nao_explorado") !== "nao_explorado");
}

/**
 * Trava anti-repetição: a frase sugerida tenta descobrir algo que o cliente
 * JÁ respondeu (por significado, não por texto igual)?
 */
export function fraseRepetida(mapa: Mapa, frase: string): SlotKey | null {
  const f = (frase || "").trim();
  if (!f || !f.includes("?")) return null;
  for (const k of SLOT_KEYS) {
    if ((mapa[k]?.estado ?? "nao_explorado") !== "respondido") continue;
    if ((SLOTS[k].alvo ?? []).some((re) => re.test(f))) return k;
  }
  return null;
}

/** Bloco textual do mapa enviado ao motor de decisão. */
export function mapaParaPrompt(mapa: Mapa): string {
  const linhas: string[] = [];
  for (const k of SLOT_KEYS) {
    const s = mapa[k];
    if (!s || s.estado === "nao_explorado") continue;
    const marca = s.estado === "parcial" ? " (parcial)" : "";
    linhas.push(`${SLOTS[k].rotulo}${marca}: ${s.valor ?? "sim"}`);
  }
  const faltando = lacunas(mapa)
    .slice(0, 6)
    .map((k) => SLOTS[k].rotulo.toLowerCase());
  if (faltando.length) linhas.push(`AINDA NÃO EXPLORADO: ${faltando.join(", ")}`);
  return linhas.join("\n");
}

/** Instrução para a IA extrair slots do mapa a partir da fala do cliente. */
export const MAPA_SYSTEM_EXTRA = `

MAPA VIVO DO CLIENTE (obrigatório):
Além dos campos acima, devolva um objeto "mapa" apenas com os slots que ganharam informação NOVA nesta fala.
Cada slot é {"estado":"parcial|respondido","valor":"até 8 palavras nas palavras do cliente"}.
Slots possíveis: ${SLOT_KEYS.join(", ")}.
Regras:
- "respondido" = a informação está clara, mesmo que o cliente tenha falado espontaneamente, sem ninguém perguntar.
- "parcial" = o assunto foi aberto mas falta o essencial (ex.: "já fiz inglês antes" → experiencia_anterior respondido, motivo_interrupcao parcial).
- Uma única fala pode preencher vários slots ("travo falando e por isso evito reuniões" → problema + impacto).
- Nunca invente. Se nada novo, devolva "mapa": {}.
`.trim();
