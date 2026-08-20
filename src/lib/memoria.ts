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

const LISTAS = [
  "criterioCompra",
  "pontosQueGostou",
  "objecoes",
  "sinaisCompra",
  "informacoesImportantes",
  "diCriteriosParaDecidir",
] as const;

const STRINGS = [
  "etapaAtual",
  "objetivo",
  "problema",
  "implicacao",
  "necessidade",
  "ultimaInteracao",
  "diMotivoResistencia",
] as const;


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

/** Normaliza qualquer objeto vindo do cliente/IA para o formato da memória. */
export function normalizarMemoria(input: unknown): Memoria {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...MEMORIA_VAZIA } as Memoria;
  for (const k of STRINGS) out[k] = txt(o[k]);
  for (const k of LISTAS) out[k] = arr(o[k]);
  out.diStatus = diStatus(o["diStatus"]) ?? "nao_apresentada";
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
  };
  const alterados: string[] = [];

  for (const k of STRINGS) {
    if (k === "etapaAtual") continue; // etapa é sempre do vendedor
    const v = txt(p[k]);
    if (v && v !== memoria[k]) {
      memoria[k] = v;
      alterados.push(k);
    }
  }
  for (const k of LISTAS) {
    for (const item of arr(p[k])) {
      const dup = memoria[k].some((x) => x.toLowerCase() === item.toLowerCase());
      if (!dup) {
        memoria[k] = [...memoria[k], item].slice(-6);
        alterados.push(k);
      }
    }
  }

  // D.I.: o estado avança, nunca retrocede sozinho (exceto para "estabelecida").
  const novoDi = diStatus(p["diStatus"]);
  if (novoDi && novoDi !== memoria.diStatus) {
    if (novoDi === "estabelecida" || DI_ORDEM[novoDi] > DI_ORDEM[memoria.diStatus]) {
      memoria.diStatus = novoDi;
      alterados.push("diStatus");
    }
  }
  return { memoria, alterados };
}


/** Campos preenchidos — usado no diagnóstico. */
export function camposPreenchidos(m: Memoria): string[] {
  return Object.entries(m)
    .filter(([k, v]) => (k === "diStatus" ? v !== "nao_apresentada" : Array.isArray(v) ? v.length > 0 : !!v))
    .map(([k]) => k);
}

/** Bloco de texto curto enviado ao modelo (nunca a call inteira). */
export function memoriaParaPrompt(m: Memoria): string {
  const linhas: string[] = [];
  const add = (label: string, v: string | string[] | null) => {
    const s = Array.isArray(v) ? v.join("; ") : v;
    if (s) linhas.push(`${label}: ${s}`);
  };
  add("Objetivo", m.objetivo);
  add("Problema", m.problema);
  add("Implicação", m.implicacao);
  add("Necessidade", m.necessidade);
  add("Critério de compra", m.criterioCompra);
  add("Gostou de", m.pontosQueGostou);
  add("Objeções anteriores", m.objecoes);
  add("Sinais de compra", m.sinaisCompra);
  add("Outras informações", m.informacoesImportantes);
  add("D.I. — estado", m.diStatus);
  add("D.I. — motivo da resistência", m.diMotivoResistencia);
  add("D.I. — critérios para decidir", m.diCriteriosParaDecidir);
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

Campos possíveis:
objetivo (string), problema (string), implicacao (string), necessidade (string),
criterioCompra (array), pontosQueGostou (array), objecoes (array), sinaisCompra (array),
informacoesImportantes (array),
diStatus (string), diMotivoResistencia (string), diCriteriosParaDecidir (array)

ESTADO DA D.I. (Regra do Jogo — o cliente se compromete a dar um posicionamento AO FINAL, não a comprar agora):
- diStatus só pode ser: nao_apresentada | apresentada | resistencia | criterios_identificados | resistencia_persistente | estabelecida
- "resistencia": o cliente diz que não dará posicionamento / não decide hoje.
- "criterios_identificados": ele lista o que precisa validar antes de se posicionar (método, horário, valores, comparar escolas...).
  Registre esses pontos em diCriteriosParaDecidir (não só em criterioCompra).
- "resistencia_persistente": mesmo com os critérios amarrados, ele mantém que não se posiciona.
- "estabelecida": ele aceita dar um sim/não ao final.
- diMotivoResistencia: o motivo real, nas palavras dele (ex.: "quer comparar antes de escolher").


Responda SOMENTE JSON válido, sem markdown. Exemplo:
{"objetivo":"conseguir promoção","problema":"inglês trava entrevistas"}
`.trim();
