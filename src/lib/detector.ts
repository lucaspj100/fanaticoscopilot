/**
 * Camada 1 — detecção instantânea por padrões (regra de latência).
 *
 * Roda em milissegundos e mostra imediatamente a situação principal, antes
 * da IA responder. A IA depois refina/troca o card do mesmo momento.
 */

export type Etapa = "rapport" | "di" | "spin" | "apresentacao" | "gatilho" | "fechamento";

export type SignalType =
  | "rapport_longo"
  | "di_ausente"
  | "di_resistencia"
  | "di_criterios"
  | "di_comparacao"
  | "di_estabelecida"
  | "di_pede_apresentacao"
  | "aprofunde"
  | "aprofunde_objetivo"
  | "falta_problema"
  | "falta_implicacao"
  | "spin_objetivo"
  | "spin_problema"
  | "spin_implicacao"
  | "spin_confirmacao"
  | "spin_suficiente"

  | "criterio_compra"
  | "personalize"
  | "quatro_fatores"
  | "validar_solucao"
  | "isolar_financeiro"
  | "financeiro"
  | "tempo"
  | "pensar"
  | "segunda_opiniao"
  | "metodologia"
  | "interesse"
  | "intencao_compra"
  | "nao_negocie"
  | "pedido_decisao"
  | "fechou"
  | "nenhum";

export type Nivel = "alerta" | "aviso" | "atencao" | "positivo";

export type Signal = {
  tipo: SignalType;
  rotulo: string;
  orientacao: string;
  frase: string;
  nivel: Nivel;
  etapa?: Etapa;
};

/** Ordem = prioridade. Só o sinal mais importante é exibido. */
const RULES: Array<{ tipo: SignalType; patterns: RegExp[] }> = [
  {
    tipo: "fechou",
    patterns: [
      /\b(vamos fechar|bora fechar|quero (come[çc]ar|fechar|me matricular)|fechado|pode fazer|t[ôo] dentro|to dentro|me matricula)\b/i,
      /\b(sim,? (vamos|quero|pode))\b/i,
    ],
  },
  {
    tipo: "intencao_compra",
    patterns: [
      /como (eu )?(fa[çc]o|posso) (para|pra) (come[çc]ar|contratar|assinar|me matricular)/i,
      /\b(manda o link|onde (eu )?assino|como funciona o pagamento|qual o pr[óo]ximo passo)\b/i,
      /quando (eu )?(consigo|posso) (come[çc]ar|entrar)/i,
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
    tipo: "financeiro",
    patterns: [
      // "valores" no plural costuma aparecer como CRITÉRIO ("horário, método e valores"),
      // não como objeção financeira — por isso só "valor" no singular dispara.
      /\b(caro|pre[çc]o|valor(?!es)|invest|or[çc]ament|dinheiro|grana|condi[çc]|desconto|parcel|boleto|financiament)\w*/i,
      /n[ãa]o tenho (esse|como|dinheiro|verba)/i,
      /fora do meu (or[çc]amento|budget)/i,
      /cabe no bolso/i,
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
    tipo: "tempo",
    patterns: [
      /n[ãa]o (tenho|teria|vou ter) tempo/i,
      /\b(corrid[oa]|atarefad|agenda cheia|sem tempo|mais pra frente|ano que vem|pr[óo]ximo m[êe]s)\w*/i,
      /agora n[ãa]o [ée] (o|um bom) momento/i,
      /conciliar com (o|meu) trabalho/i,
    ],
  },
  {
    tipo: "metodologia",
    patterns: [
      /como (funciona|que funciona|[ée] feito|seria)/i,
      /qual (a|[ée] a) (metodologia|m[ée]todo|din[âa]mica)/i,
      /\b(quantas aulas|quanto tempo dura|formato|presencial|online|garantia|funciona mesmo|professor)\w*/i,
      /j[áa] (tentei|fiz) (outro|outra|isso|curso)/i,
    ],
  },
  {
    tipo: "interesse",
    patterns: [
      /\b(gostei|interessante|faz sentido|adorei|curti|bacana|legal isso)\b/i,
      /era (bem )?isso que eu (precisava|queria|procurava)/i,
    ],
  },
  {
    tipo: "aprofunde_objetivo",
    patterns: [
      /\b(ganhar|receber|faturar|salário|sal[áa]rio) em (d[óo]lar|euro|moeda)/i,
      /\b(trabalhar|morar|viajar) (fora|no exterior|nos eua|em outro pa[íi]s)/i,
      /\b(empresa|vaga|cliente|projeto)s? (de|do) (fora|exterior)/i,
      /\bquero (ganhar|conquistar|chegar|alcan[çc]ar)\b/i,
    ],
  },
  {
    tipo: "falta_problema",
    patterns: [
      /\b(progredir|crescer|evoluir|avan[çc]ar|subir) (na|de|no) (carreira|cargo|n[íi]vel|empresa)/i,
      /\b(quest[ãa]o|motivo|lado) profissional\b/i,
      /\b(melhorar|crescer|evoluir) profissionalmente\b/i,
      /\b(promo[çc][ãa]o|pr[óo]ximo n[íi]vel|nova oportunidade|mudar de [áa]rea)\b/i,
    ],
  },
  {
    tipo: "aprofunde",
    patterns: [
      /\b(pra|para) (minha|a minha) (carreira|profiss[ãa]o|vida)\b/i,
      /\b(quero|preciso) (aprender|falar|melhorar) (o )?ingl[êe]s\b/i,
      /\b(sempre quis|sempre tive vontade)\b/i,
    ],
  },
];

/**
 * Regras que SÓ valem quando o vendedor marcou a etapa D.I.
 * Na D.I. o objetivo é a Regra do Jogo, não o assunto citado pelo cliente.
 */
const DI_RULES: Array<{ tipo: SignalType; patterns: RegExp[] }> = [
  {
    tipo: "di_pede_apresentacao",
    patterns: [
      /\b(n[ãa]o sei|nem sei|n[ãa]o fa[çc]o ideia)\b.*\b(por isso|justamente|por causa disso)?/i,
      /(me )?(apresent|mostr|explic)\w*\s+(como funciona|a proposta|o curso|voc[êe]s)/i,
      /\bquero (conhecer|entender) (voc[êe]s|a proposta|o curso)\b/i,
      /\bj[áa] (te )?(falei|disse|respondi)\b/i,
      /\bcomo eu (te )?(disse|falei)\b/i,
    ],
  },
  {
    tipo: "di_resistencia",
    patterns: [
      /n[ãa]o vou (dar|te dar) (nenhum )?(posicionamento|resposta|retorno)/i,
      /n[ãa]o (vou|consigo) decidir (hoje|agora|na hora)/i,
      /n[ãa]o tomo decis[ãa]o (na hora|assim|hoje|agora)/i,
      /n[ãa]o (fecho|assino|decido) (nada )?(na primeira|hoje|agora|no impulso)/i,
      /prefiro pensar depois/i,
    ],
  },
  {
    tipo: "di_comparacao",
    patterns: [
      /\b(outras|outra) (escolas?|op[çc][õo]es|cursos?)\b/i,
      /\b(comparar|compara[çc][ãa]o|comparativo|pesquisar|or[çc]ar)\b/i,
      /colocar (tudo )?no papel/i,
    ],
  },
  {
    tipo: "di_criterios",
    patterns: [
      /\b(preciso|quero|gostaria de) (entender|saber|verificar|ver|analisar|conhecer)\b/i,
      /\b(depende|vai depender) (de|do|da)\b/i,
    ],
  },
  {
    tipo: "di_estabelecida",
    patterns: [
      /\b(pode ser|combinado|tudo bem|sem problema|claro)\b.*\b(final|fim|depois)\b/i,
      /\b(te dou|dou) (um|o) (retorno|posicionamento|sim ou n[ãa]o)\b/i,
    ],
  },
];


export const FALLBACKS: Record<Exclude<SignalType, "nenhum">, Omit<Signal, "tipo">> = {
  rapport_longo: {
    rotulo: "RAPPORT LONGO",
    orientacao: "A conexão já foi criada. Avance para a call.",
    frase: "",
    nivel: "atencao",
    etapa: "rapport",
  },
  di_ausente: {
    rotulo: "D.I. NÃO ESTABELECIDA",
    orientacao: "Alinhe o posicionamento ao final antes de aprofundar.",
    frase: "Ao final da nossa conversa, você me diz se faz sentido ou não, tudo bem?",
    nivel: "atencao",
    etapa: "di",
  },
  di_resistencia: {
    rotulo: "RESISTÊNCIA À D.I.",
    orientacao: "Descubra por que ele não se posiciona no final.",
    frase: "O que te impediria de me dar um sim ou não depois de conhecer tudo?",
    nivel: "alerta",
    etapa: "di",
  },
  di_criterios: {
    rotulo: "CRITÉRIOS DA DECISÃO",
    orientacao: "Amarre esses pontos ao posicionamento final.",
    frase: "Se a gente validar esses pontos aqui, você consegue me dar um posicionamento no final?",
    nivel: "aviso",
    etapa: "di",
  },
  di_comparacao: {
    rotulo: "QUER COMPARAR",
    orientacao: "Entenda o efeito disso na decisão, não fale de método.",
    frase: "O que você precisaria comparar depois que não daria pra validar comigo aqui?",
    nivel: "aviso",
    etapa: "di",
  },
  di_pede_apresentacao: {
    rotulo: "PARE DE INVESTIGAR",
    orientacao: "Ele não tem a resposta. Alinhe a D.I. e avance.",
    frase: "Perfeito. Conhece tudo primeiro e no final você me diz se fez sentido. Combinado?",
    nivel: "aviso",
    etapa: "di",
  },
  di_estabelecida: {
    rotulo: "D.I. ESTABELECIDA",
    orientacao: "Avance. Não prolongue a Regra do Jogo.",
    frase: "",
    nivel: "positivo",
    etapa: "di",
  },
  aprofunde_objetivo: {
    rotulo: "APROFUNDE O OBJETIVO",
    orientacao: "Transforme o objetivo em algo concreto.",
    frase: "O que precisaria acontecer profissionalmente para você chegar nisso?",
    nivel: "atencao",
    etapa: "spin",
  },
  falta_problema: {
    rotulo: "FALTA PROBLEMA",
    orientacao: "Descubra o que hoje impede esse avanço.",
    frase: "Hoje, onde exatamente o inglês está te limitando para chegar nesse próximo nível?",
    nivel: "atencao",
    etapa: "spin",
  },
  aprofunde: {
    rotulo: "APROFUNDE",
    orientacao: "A resposta ainda está superficial.",
    frase: "Em que exatamente o inglês está te limitando hoje?",
    nivel: "atencao",
    etapa: "spin",
  },
  falta_implicacao: {
    rotulo: "FALTA IMPLICAÇÃO",
    orientacao: "Explore o impacto desse problema antes de seguir.",
    frase: "O que você já deixou de conquistar por causa disso?",
    nivel: "atencao",
    etapa: "spin",
  },
  criterio_compra: {
    rotulo: "CRITÉRIO DE COMPRA",
    orientacao: "Descubra o que ele valoriza antes de apresentar.",
    frase: "O que um curso de inglês precisa ter para realmente fazer sentido para você?",
    nivel: "atencao",
    etapa: "spin",
  },
  personalize: {
    rotulo: "PERSONALIZE",
    orientacao: "Conecte esse diferencial a algo que ele falou.",
    frase: "",
    nivel: "atencao",
    etapa: "apresentacao",
  },
  quatro_fatores: {
    rotulo: "4 FATORES",
    orientacao: "Faça o cliente identificar o real impeditivo.",
    frase: "Entre interesse, tempo, metodologia e financeiro, algum fator impediria você de iniciar?",
    nivel: "atencao",
    etapa: "apresentacao",
  },
  validar_solucao: {
    rotulo: "VALIDE A SOLUÇÃO",
    orientacao: "Confirme aprovação antes de falar de valor.",
    frase: "O que mais fez sentido para você?",
    nivel: "atencao",
    etapa: "gatilho",
  },
  isolar_financeiro: {
    rotulo: "ISOLE O FINANCEIRO",
    orientacao: "Confirme que só falta o investimento.",
    frase: "Tirando a questão financeira, existe algum outro ponto que impediria você de começar?",
    nivel: "aviso",
    etapa: "gatilho",
  },
  financeiro: {
    rotulo: "FINANCEIRO",
    orientacao: "Isole antes de negociar. Não dê desconto.",
    frase: "É o valor total ou a forma como esse valor entra no seu orçamento?",
    nivel: "alerta",
    etapa: "fechamento",
  },
  tempo: {
    rotulo: "TEMPO",
    orientacao: "Entenda se é agenda real ou medo de não dar conta.",
    frase: "Como está sua rotina hoje numa semana normal?",
    nivel: "aviso",
  },
  pensar: {
    rotulo: "PRECISA PENSAR",
    orientacao: "Não responda a objeção ainda. Descubra a trava real.",
    frase: "Quando você fala que precisa pensar, o que exatamente precisa avaliar?",
    nivel: "alerta",
  },
  segunda_opiniao: {
    rotulo: "SEGUNDA OPINIÃO",
    orientacao: "Descubra a participação real dessa pessoa na decisão.",
    frase: "A decisão é de vocês dois ou ela te apoia no que você escolher?",
    nivel: "aviso",
  },
  metodologia: {
    rotulo: "METODOLOGIA",
    orientacao: "Entenda a expectativa antes de defender o método.",
    frase: "O que te frustrou nas experiências anteriores com inglês?",
    nivel: "atencao",
  },
  interesse: {
    rotulo: "INTERESSE",
    orientacao: "Aprofunde e amarre com as palavras dele.",
    frase: "O que exatamente nisso fez mais sentido pra sua situação?",
    nivel: "positivo",
  },
  intencao_compra: {
    rotulo: "SINAL DE COMPRA",
    orientacao: "Pare de apresentar. Peça a decisão.",
    frase: "Faz sentido a gente começar hoje?",
    nivel: "positivo",
  },
  nao_negocie: {
    rotulo: "NÃO NEGOCIE AINDA",
    orientacao: "Confirme se esse é realmente o único impeditivo.",
    frase: "Se essa questão fosse resolvida, você conseguiria avançar hoje?",
    nivel: "alerta",
    etapa: "fechamento",
  },
  pedido_decisao: {
    rotulo: "PEÇA A DECISÃO",
    orientacao: "Apresentou o valor: conduza o posicionamento.",
    frase: "Faz sentido para você começar agora?",
    nivel: "aviso",
    etapa: "fechamento",
  },
  fechou: {
    rotulo: "FECHOU",
    orientacao: "Pare de argumentar e avance para a matrícula.",
    frase: "Perfeito. Vou iniciar seu cadastro agora.",
    nivel: "positivo",
    etapa: "fechamento",
  },
};

/** Sinais críticos que interrompem qualquer etapa. */
const CRITICOS_SEMPRE = new Set<SignalType>(["fechou", "intencao_compra"]);

/**
 * Camada 1. Quando a etapa manual é "di", a Regra do Jogo tem prioridade:
 * assunto (metodologia, tempo, preço) não sequestra a etapa.
 */
export function detect(text: string, etapa?: string): Signal | null {
  if (!text || text.trim().length < 3) return null;
  const match = (rules: typeof RULES): Signal | null => {
    for (const rule of rules) {
      for (const p of rule.patterns) {
        if (p.test(text)) return { tipo: rule.tipo, ...FALLBACKS[rule.tipo as Exclude<SignalType, "nenhum">] };
      }
    }
    return null;
  };

  if (etapa === "di") {
    const critico = match(RULES);
    if (critico && CRITICOS_SEMPRE.has(critico.tipo)) return critico;
    return match(DI_RULES);
  }
  return match(RULES);
}

