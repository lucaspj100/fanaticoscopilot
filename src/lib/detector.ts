/**
 * Camada 1 — detecção instantânea por padrões.
 *
 * Roda em milissegundos (no navegador e no servidor) e mostra um card
 * imediatamente, antes da IA responder. A IA depois refina o card.
 */

export type SignalType =
  | "financeiro"
  | "tempo"
  | "pensar"
  | "segunda_opiniao"
  | "metodologia"
  | "interesse"
  | "intencao_compra"
  | "fechamento"
  | "nenhum";

export type Signal = {
  tipo: SignalType;
  rotulo: string;
  orientacao: string;
  frase: string;
  nivel: "alerta" | "atencao" | "positivo";
};

const RULES: Array<{ tipo: SignalType; patterns: RegExp[] }> = [
  {
    tipo: "financeiro",
    patterns: [
      /\b(caro|carinho|preç|preco|valor|invest|orçament|orcament|dinheiro|grana|cabe no bolso|condiç|condic|desconto|parcel|boleto|financiament)\w*/i,
      /n[ãa]o tenho (esse|como|dinheiro|verba)/i,
      /fora do meu (or[çc]amento|budget)/i,
    ],
  },
  {
    tipo: "tempo",
    patterns: [
      /n[ãa]o (tenho|teria) tempo/i,
      /\b(corrid[oa]|atarefad|agenda cheia|sem tempo|mais pra frente|depois do|ano que vem|pr[óo]ximo m[êe]s)\w*/i,
      /agora n[ãa]o [ée] (o|um bom) momento/i,
    ],
  },
  {
    tipo: "pensar",
    patterns: [
      /preciso pensar/i,
      /vou pensar/i,
      /pensar (a respeito|com calma|melhor)/i,
      /me d[áa] um tempo/i,
      /depois eu (te )?(retorno|aviso|falo)/i,
      /analisar com calma/i,
    ],
  },
  {
    tipo: "segunda_opiniao",
    patterns: [
      /(minha|meu) (esposa|marido|s[óo]cio|s[óo]cia|companheir[ao]|namorad[ao]|chefe|gestor|pai|m[ãa]e)/i,
      /falar com (meu|minha|o|a) /i,
      /preciso (consultar|alinhar|conversar com)/i,
      /n[ãa]o decido sozinh/i,
    ],
  },
  {
    tipo: "metodologia",
    patterns: [
      /como (funciona|que funciona|é feito|seria)/i,
      /qual (a|é a) (metodologia|met[óo]do|din[âa]mica)/i,
      /\b(quantas sess|quanto tempo dura|formato|presencial|online|garantia|funciona mesmo)\w*/i,
      /j[áa] tentei (outro|outra|isso)/i,
    ],
  },
  {
    tipo: "interesse",
    patterns: [
      /\b(gostei|interessante|faz sentido|legal isso|adorei|curti|bacana)\b/i,
      /era (bem )?isso que eu (precisava|queria|procurava)/i,
    ],
  },
  {
    tipo: "intencao_compra",
    patterns: [
      /como (eu )?(fa[çc]o|posso) (para|pra) (come[çc]ar|contratar|assinar)/i,
      /\b(quero come[çc]ar|bora|vamos (nessa|fechar)|me manda|manda o link|onde (eu )?assino)\b/i,
      /quando (eu )?(consigo|posso) (come[çc]ar|entrar)/i,
    ],
  },
  {
    tipo: "fechamento",
    patterns: [/pr[óo]ximo passo/i, /o que (eu )?preciso fazer (agora|ent[ãa]o)/i, /fech(ado|amos)\b/i],
  },
];

export const FALLBACKS: Record<Exclude<SignalType, "nenhum">, Omit<Signal, "tipo">> = {
  financeiro: {
    rotulo: "Objeção financeira",
    orientacao: "Isole antes de oferecer condição.",
    frase: "Se o investimento não fosse uma questão, você começaria hoje?",
    nivel: "alerta",
  },
  tempo: {
    rotulo: "Objeção de tempo",
    orientacao: "Tempo é prioridade. Descubra o que vem antes.",
    frase: "O que hoje está na frente disso na sua lista de prioridades?",
    nivel: "alerta",
  },
  pensar: {
    rotulo: "Adiamento de decisão",
    orientacao: "Descubra o que ainda impede a decisão.",
    frase: "Claro. O que especificamente você ainda precisa avaliar antes de decidir?",
    nivel: "alerta",
  },
  segunda_opiniao: {
    rotulo: "Terceiro decisor",
    orientacao: "Descubra o papel real do terceiro.",
    frase: "Se ela disser sim, você começa? O que ela precisaria ouvir?",
    nivel: "alerta",
  },
  metodologia: {
    rotulo: "Dúvida de metodologia",
    orientacao: "Responda curto e volte ao diagnóstico.",
    frase: "Te explico em um minuto — e por que isso é importante pra você?",
    nivel: "atencao",
  },
  interesse: {
    rotulo: "Sinal de interesse",
    orientacao: "Aprofunde e amarre com as palavras dele.",
    frase: "O que exatamente nisso mais fez sentido pra sua situação?",
    nivel: "positivo",
  },
  intencao_compra: {
    rotulo: "Intenção de compra",
    orientacao: "Pare de vender. Avance para o próximo passo.",
    frase: "Perfeito. Então vamos garantir sua vaga agora — te passo os detalhes.",
    nivel: "positivo",
  },
  fechamento: {
    rotulo: "Momento de fechar",
    orientacao: "Convite direto, sem rodeio.",
    frase: "Faz sentido a gente começar hoje?",
    nivel: "positivo",
  },
};

export function detect(text: string): Signal | null {
  if (!text || text.trim().length < 3) return null;
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      if (p.test(text)) {
        const f = FALLBACKS[rule.tipo as Exclude<SignalType, "nenhum">];
        return { tipo: rule.tipo, ...f };
      }
    }
  }
  return null;
}
