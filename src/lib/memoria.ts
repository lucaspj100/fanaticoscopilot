import {
  MAPA_SYSTEM_EXTRA,
  MAPA_VAZIO,
  aplicarPatchMapa,
  inferirMapa,
  lacunas,
  mapaParaPrompt,
  normalizarMapa,
  novoMapa,
  type Mapa,
} from "./mapa";

/**
 * Memória viva da call — estado resumido e pequeno, atualizado ao longo
 * da conversa. Nunca enviamos a transcrição inteira para o modelo:
 * enviamos esta memória estruturada + os últimos turnos.
 */

export type DiStatus =
  | "nao_apresentada"
  | "apresentada"
  | "resistencia"
  | "criterios_identificados"
  | "resistencia_persistente"
  | "estabelecida";

export type SpinStatus =
  | "nao_iniciado"
  | "objetivo_identificado"
  | "problema_identificado"
  | "implicacao_identificada"
  | "necessidade_identificada"
  | "suficiente";

export type Memoria = {
  etapaAtual: string | null;
  objetivo: string | null;
  problema: string | null;
  implicacao: string | null;
  necessidade: string | null;
  criterioCompra: string[];
  pontosQueGostou: string[];
  objecoes: string[];
  sinaisCompra: string[];
  informacoesImportantes: string[];
  ultimaInteracao: string | null;
  /** Estado da negociação da Regra do Jogo / D.I. */
  diStatus: DiStatus;
  diMotivoResistencia: string | null;
  diCriteriosParaDecidir: string[];
  /** Estado do SPIN — objetivo → problema → implicação → necessidade → suficiente */
  spinStatus: SpinStatus;
  spinObjetivo: string | null;
  spinProblema: string | null;
  spinImplicacoes: string[];
  spinNecessidade: string | null;
  /** Eixos já explorados (ex.: impacto_financeiro) — nunca repetir o mesmo eixo. */
  spinPerguntasJaExploradas: string[];
  /** Mapa vivo do cliente — o que já sabemos e o que ainda falta (V2.6). */
  mapa: Mapa;
};

export const MEMORIA_VAZIA: Memoria = {
  etapaAtual: null,
  objetivo: null,
  problema: null,
  implicacao: null,
  necessidade: null,
  criterioCompra: [],
  pontosQueGostou: [],
  objecoes: [],
  sinaisCompra: [],
  informacoesImportantes: [],
  ultimaInteracao: null,
  diStatus: "nao_apresentada",
  diMotivoResistencia: null,
  diCriteriosParaDecidir: [],
  spinStatus: "nao_iniciado",
  spinObjetivo: null,
  spinProblema: null,
  spinImplicacoes: [],
  spinNecessidade: null,
  spinPerguntasJaExploradas: [],
  mapa: MAPA_VAZIO,
};


const DI_STATUS: DiStatus[] = [
  "nao_apresentada",
  "apresentada",
  "resistencia",
  "criterios_identificados",
  "resistencia_persistente",
  "estabelecida",
];

/** Progressão do estado da D.I. — nunca retrocede sozinho. */
const DI_ORDEM: Record<DiStatus, number> = {
  nao_apresentada: 0,
  apresentada: 1,
  resistencia: 2,
  criterios_identificados: 3,
  resistencia_persistente: 4,
  estabelecida: 5,
};

const SPIN_STATUS: SpinStatus[] = [
  "nao_iniciado",
  "objetivo_identificado",
  "problema_identificado",
  "implicacao_identificada",
  "necessidade_identificada",
  "suficiente",
];

const SPIN_ORDEM: Record<SpinStatus, number> = {
  nao_iniciado: 0,
  objetivo_identificado: 1,
  problema_identificado: 2,
  implicacao_identificada: 3,
  necessidade_identificada: 4,
  suficiente: 5,
};

/** Eixos de aprofundamento — cada um só pode ser explorado uma vez. */
export const SPIN_EIXOS = [
  "oportunidades_perdidas",
  "impacto_financeiro",
  "impacto_carreira",
  "rotina",
  "comunicacao",
  "urgencia",
  "confirmacao",
] as const;

const LISTAS = [
  "criterioCompra",
  "pontosQueGostou",
  "objecoes",
  "sinaisCompra",
  "informacoesImportantes",
  "diCriteriosParaDecidir",
  "spinImplicacoes",
  "spinPerguntasJaExploradas",
] as const;

const STRINGS = [
  "etapaAtual",
  "objetivo",
  "problema",
  "implicacao",
  "necessidade",
  "ultimaInteracao",
  "diMotivoResistencia",
  "spinObjetivo",
  "spinProblema",
  "spinNecessidade",
] as const;

/**
 * Campos que, uma vez preenchidos com informação boa, NÃO são sobrescritos
 * por informação menos relevante em turnos seguintes.
 */
const PROTEGIDOS = new Set<string>([
  "objetivo",
  "problema",
  "implicacao",
  "spinObjetivo",
  "spinProblema",
]);

/** "não sei", "depende", "não tenho certeza" = ausência de informação, não implicação. */
const NAO_INFORMACAO =
  /^(n[ãa]o sei|nem sei|n[ãa]o tenho certeza|n[ãa]o sei dizer|n[ãa]o fa[çc]o ideia|depende|talvez|acho que n[ãa]o sei)\b/i;

const ehImplicacaoValida = (s: string) => !NAO_INFORMACAO.test(s.trim());

const txt = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.toLowerCase() !== "null" ? s.slice(0, 160) : null;
};

const arr = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map(txt)
    .filter((s): s is string => !!s)
    .slice(0, 6);

const diStatus = (v: unknown): DiStatus | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (DI_STATUS as string[]).includes(s) ? (s as DiStatus) : null;
};

const spinStatusVal = (v: unknown): SpinStatus | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (SPIN_STATUS as string[]).includes(s) ? (s as SpinStatus) : null;
};

/**
 * SPIN suficiente = objetivo + problema + pelo menos uma implicação relevante.
 * A necessidade explícita é desejável, mas não obrigatória.
 */
export function spinSuficiente(m: Memoria): boolean {
  const objetivo = m.spinObjetivo ?? m.objetivo;
  const problema = m.spinProblema ?? m.problema;
  const implicacoes = m.spinImplicacoes.length ? m.spinImplicacoes : m.implicacao ? [m.implicacao] : [];
  return !!objetivo && !!problema && implicacoes.some(ehImplicacaoValida);
}

/** Estado do SPIN derivado dos campos — a IA nunca pode inventar um estado maior. */
export function derivarSpinStatus(m: Memoria): SpinStatus {
  if (spinSuficiente(m)) return "suficiente";
  if (m.spinNecessidade ?? m.necessidade) return "necessidade_identificada";
  if ((m.spinImplicacoes.length ? m.spinImplicacoes : m.implicacao ? [m.implicacao] : []).some(ehImplicacaoValida))
    return "implicacao_identificada";
  if (m.spinProblema ?? m.problema) return "problema_identificado";
  if (m.spinObjetivo ?? m.objetivo) return "objetivo_identificado";
  return "nao_iniciado";
}

/** Normaliza qualquer objeto vindo do cliente/IA para o formato da memória. */
export function normalizarMemoria(input: unknown): Memoria {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...MEMORIA_VAZIA } as Memoria;
  for (const k of STRINGS) out[k] = txt(o[k]);
  for (const k of LISTAS) out[k] = arr(o[k]);
  out.diStatus = diStatus(o["diStatus"]) ?? "nao_apresentada";
  out.spinStatus = spinStatusVal(o["spinStatus"]) ?? "nao_iniciado";
  out.mapa = normalizarMapa(o["mapa"]);
  return out;
}


/** Aplica um patch (só campos novos) sobre a memória atual, sem duplicar itens. */
export function aplicarPatch(atual: Memoria, patch: unknown): { memoria: Memoria; alterados: string[] } {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const memoria: Memoria = {
    ...atual,
    criterioCompra: [...atual.criterioCompra],
    pontosQueGostou: [...atual.pontosQueGostou],
    objecoes: [...atual.objecoes],
    sinaisCompra: [...atual.sinaisCompra],
    informacoesImportantes: [...atual.informacoesImportantes],
    diCriteriosParaDecidir: [...atual.diCriteriosParaDecidir],
    spinImplicacoes: [...atual.spinImplicacoes],
    spinPerguntasJaExploradas: [...atual.spinPerguntasJaExploradas],
    mapa: { ...(atual.mapa ?? novoMapa()) },
  };
  const alterados: string[] = [];

  for (const k of STRINGS) {
    if (k === "etapaAtual") continue; // etapa é sempre do vendedor
    const v = txt(p[k]);
    if (!v || v === memoria[k]) continue;
    // "não sei"/"depende" não é implicação: vira contexto, nunca sobrescreve.
    if ((k === "implicacao" || k === "spinProblema" || k === "spinObjetivo") && !ehImplicacaoValida(v)) {
      continue;
    }
    // Campo correto já preenchido não é sobrescrito por informação menos relevante.
    if (PROTEGIDOS.has(k) && memoria[k]) continue;
    memoria[k] = v;
    alterados.push(k);
  }
  for (const k of LISTAS) {
    for (const item of arr(p[k])) {
      if (k === "spinImplicacoes" && !ehImplicacaoValida(item)) continue;
      const dup = memoria[k].some((x) => x.toLowerCase() === item.toLowerCase());
      if (!dup) {
        memoria[k] = [...memoria[k], item].slice(-6);
        alterados.push(k);
      }
    }
  }

  // Espelha objetivo/problema/necessidade nos campos do SPIN quando ainda vazios.
  if (!memoria.spinObjetivo && memoria.objetivo) memoria.spinObjetivo = memoria.objetivo;
  if (!memoria.spinProblema && memoria.problema) memoria.spinProblema = memoria.problema;
  if (!memoria.spinNecessidade && memoria.necessidade) memoria.spinNecessidade = memoria.necessidade;
  if (!memoria.spinImplicacoes.length && memoria.implicacao && ehImplicacaoValida(memoria.implicacao)) {
    memoria.spinImplicacoes = [memoria.implicacao];
  }

  // D.I.: o estado avança, nunca retrocede sozinho (exceto para "estabelecida").
  const novoDi = diStatus(p["diStatus"]);
  if (novoDi && novoDi !== memoria.diStatus) {
    if (novoDi === "estabelecida" || DI_ORDEM[novoDi] > DI_ORDEM[memoria.diStatus]) {
      memoria.diStatus = novoDi;
      alterados.push("diStatus");
    }
  }

  // SPIN: o estado é DERIVADO dos campos; a IA só pode confirmar, nunca inflar.
  const novoSpin = derivarSpinStatus(memoria);

  if (novoSpin !== memoria.spinStatus && SPIN_ORDEM[novoSpin] >= SPIN_ORDEM[memoria.spinStatus]) {
    memoria.spinStatus = novoSpin;
    alterados.push("spinStatus");
  }

  // Mapa vivo: patch da IA + inferência local da própria fala do cliente.
  const p2 = p as Record<string, unknown>;
  const patchMapa = aplicarPatchMapa(memoria.mapa, p2["mapa"]);
  memoria.mapa = patchMapa.mapa;
  alterados.push(...patchMapa.alterados.map((k) => `mapa.${k}`));

  return { memoria, alterados };
}

/** Aplica na memória o que dá pra descobrir localmente, sem IA (latência zero). */
export function aplicarMapaLocal(memoria: Memoria, text: string): { memoria: Memoria; alterados: string[] } {
  const { mapa, alterados } = aplicarPatchMapa(memoria.mapa ?? novoMapa(), inferirMapa(text));
  return { memoria: { ...memoria, mapa }, alterados: alterados.map((k) => `mapa.${k}`) };
}

/** Bloco do mapa vivo enviado ao motor de decisão. */
export function mapaDaMemoria(m: Memoria): string {
  return mapaParaPrompt(m.mapa ?? novoMapa());
}

/** Lacunas reais (o que ainda falta descobrir), em ordem de prioridade. */
export function lacunasDaMemoria(m: Memoria): string[] {
  return lacunas(m.mapa ?? novoMapa());
}


/** Campos preenchidos — usado no diagnóstico. */
export function camposPreenchidos(m: Memoria): string[] {
  return Object.entries(m)
    .filter(([k, v]) =>
      k === "mapa"
        ? false
        : k === "diStatus"
        ? v !== "nao_apresentada"
        : k === "spinStatus"
          ? v !== "nao_iniciado"
          : Array.isArray(v)
            ? v.length > 0
            : !!v,
    )
    .map(([k]) => k);
}

/** Bloco de texto curto enviado ao modelo (nunca a call inteira). */
export function memoriaParaPrompt(m: Memoria): string {
  const linhas: string[] = [];
  const add = (label: string, v: string | string[] | null) => {
    const s = Array.isArray(v) ? v.join("; ") : v;
    if (s) linhas.push(`${label}: ${s}`);
  };
  add("Objetivo", m.spinObjetivo ?? m.objetivo);
  add("Problema", m.spinProblema ?? m.problema);
  add("Implicações", m.spinImplicacoes.length ? m.spinImplicacoes : m.implicacao);
  add("Necessidade", m.spinNecessidade ?? m.necessidade);
  add("Critério de compra", m.criterioCompra);
  add("Gostou de", m.pontosQueGostou);
  add("Objeções anteriores", m.objecoes);
  add("Sinais de compra", m.sinaisCompra);
  add("Outras informações", m.informacoesImportantes);
  add("D.I. — estado", m.diStatus);
  add("D.I. — motivo da resistência", m.diMotivoResistencia);
  add("D.I. — critérios para decidir", m.diCriteriosParaDecidir);
  add("SPIN — estado", m.spinStatus);
  add("SPIN — eixos já explorados", m.spinPerguntasJaExploradas);
  return linhas.join("\n");
}

export const MEMORY_SYSTEM = `
Você mantém a MEMÓRIA de uma call de vendas (pt-BR). Recebe a memória atual e a última fala do cliente.
Sua tarefa: devolver APENAS os campos que ganharam informação NOVA e útil. Nada mais.

REGRAS:
- Nunca invente. Só registre o que o cliente disse explicitamente.
- Se nada novo apareceu, devolva {}.
- Textos curtos, no máximo 8 palavras por item, nas palavras do próprio cliente.
- Não repita informação já presente na memória atual.
- Não altere etapaAtual (a etapa é definida manualmente pelo vendedor).
- NUNCA sobrescreva um campo já preenchido por uma informação mais fraca ou genérica.
- "não sei", "depende", "não tenho certeza" NÃO é implicação nem problema: no máximo informacoesImportantes.

Campos possíveis:
objetivo (string), problema (string), implicacao (string), necessidade (string),
criterioCompra (array), pontosQueGostou (array), objecoes (array), sinaisCompra (array),
informacoesImportantes (array),
diStatus (string), diMotivoResistencia (string), diCriteriosParaDecidir (array),
spinObjetivo (string), spinProblema (string), spinImplicacoes (array), spinNecessidade (string),
spinPerguntasJaExploradas (array), spinStatus (string)

DIFERENÇA OBRIGATÓRIA (SPIN):
- spinObjetivo = o que ele QUER conquistar (promoção, morar fora, ganhar em dólar).
- spinProblema = o que HOJE impede isso (trava em reunião, não entende call, perdeu vaga por inglês).
- spinImplicacoes = a CONSEQUÊNCIA concreta do problema (perdeu promoção, deixou de ganhar X, ficou de fora do projeto).
- spinNecessidade = o que ele diz precisar para resolver (conversação, prática com nativo, rotina fixa).
Objetivo nunca é problema. Problema nunca é implicação.

ESTADO DA D.I. (Regra do Jogo — o cliente se compromete a dar um posicionamento AO FINAL, não a comprar agora):
- diStatus só pode ser: nao_apresentada | apresentada | resistencia | criterios_identificados | resistencia_persistente | estabelecida
- "resistencia": o cliente diz que não dará posicionamento / não decide hoje.
- "criterios_identificados": ele lista o que precisa validar antes de se posicionar (método, horário, valores, comparar escolas...).
  Registre esses pontos em diCriteriosParaDecidir (não só em criterioCompra).
- "resistencia_persistente": mesmo com os critérios amarrados, ele mantém que não se posiciona.
- "estabelecida": ele aceita dar um sim/não ao final.
- diMotivoResistencia: o motivo real, nas palavras dele (ex.: "quer comparar antes de escolher").

ESTADO DO SPIN:
- spinStatus só pode ser: nao_iniciado | objetivo_identificado | problema_identificado | implicacao_identificada | necessidade_identificada | suficiente
- Citar preço, investimento ou valor NÃO é objeção financeira: só registre em objecoes se houver recusa clara ("está caro", "não tenho esse valor").

${MAPA_SYSTEM_EXTRA}

Responda SOMENTE JSON válido, sem markdown. Exemplo:
{"objetivo":"conseguir promoção","problema":"inglês trava entrevistas","mapa":{"objetivo":{"estado":"respondido","valor":"promoção na empresa"}}}
`.trim();

