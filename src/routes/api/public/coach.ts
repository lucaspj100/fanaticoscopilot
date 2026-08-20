import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { FALLBACKS, detect, type SignalType } from "@/lib/detector";
import { SLOTS, fraseRepetida, type SlotKey } from "@/lib/mapa";
import {
  camposPreenchidos,
  derivarSpinStatus,
  lacunasDaMemoria,
  mapaDaMemoria,
  memoriaParaPrompt,
  normalizarMemoria,
  avaliacaoSpin,
} from "@/lib/memoria";
import {
  CLASSIFY_SYSTEM,
  COACH_SYSTEM,
  DECISION_EXTRA,
  NATURALIDADE_EXTRA,
  DI_CLASSIFY_SYSTEM,
  DI_COACH_EXTRA,
  RULE_SNIPPETS,
  SPIN_CLASSIFY_SYSTEM,
  SPIN_COACH_EXTRA,
} from "@/lib/playbook";


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  // Apenas os últimos turnos — nunca a call inteira (latência e custo).
  turns: z
    .array(z.object({ speaker: z.enum(["cliente", "vendedor"]), text: z.string().max(1200) }))
    .min(1)
    .max(6),
  // Situação já classificada pela camada 1 (opcional).
  tipo: z.string().optional(),
  etapa: z.string().optional(),
  /** Etapa informada MANUALMENTE pelo vendedor — fonte da verdade. */
  etapaManual: z.string().optional(),
  /** Memória viva da call (estado resumido, nunca a transcrição inteira). */
  memoria: z.unknown().optional(),
  /** Últimas frases já sugeridas ao vendedor — prevenção de loop. */
  sugestoesAnteriores: z.array(z.string().max(240)).max(5).optional(),
});

const ETAPAS = ["rapport", "di", "spin", "apresentacao", "gatilho", "fechamento"] as const;
const MODEL = "google/gemini-3.1-flash-lite";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Sinais que dependem da atuação do vendedor: bloqueados até haver speaker detection. */
const PROCESSO = new Set<string>([
  "rapport_longo",
  "di_ausente",
  "falta_implicacao",
  "criterio_compra",
  "personalize",
  "quatro_fatores",
  "validar_solucao",
  "isolar_financeiro",
  "nao_negocie",
  "pedido_decisao",
]);

/** Tipos próprios da etapa D.I. */
const DI_TIPOS = new Set<string>([
  "di_resistencia",
  "di_criterios",
  "di_comparacao",
  "di_pede_apresentacao",
  "di_estabelecida",
]);

/** Tipos próprios da etapa SPIN. */
const SPIN_TIPOS = new Set<string>([
  "spin_objetivo",
  "spin_problema",
  "spin_implicacao",
  "spin_confirmacao",
  "spin_suficiente",
]);

/** Objeções reais que podem interromper o SPIN. */
const OBJECOES_REAIS = new Set<string>(["financeiro", "pensar", "segunda_opiniao", "tempo"]);

/** Sinais críticos que interrompem qualquer etapa. */
const CRITICOS_SEMPRE = new Set<string>(["fechou", "intencao_compra"]);

/** Threshold alto para objeções/compra; moderado para aprofundamento de SPIN e D.I. */
const CRITICOS = new Set<string>([
  "fechou",
  "intencao_compra",
  "financeiro",
  "pensar",
  "segunda_opiniao",
  "tempo",
  "metodologia",
]);
const threshold = (tipo: string) =>
  CRITICOS.has(tipo) ? 0.75 : DI_TIPOS.has(tipo) || SPIN_TIPOS.has(tipo) ? 0.6 : 0.65;




/** Frase em uma linha, sem aspas, sem rótulo, curta. */
function clean(raw: string): string {
  let s = (raw || "").trim().split("\n")[0]?.trim() ?? "";
  s = s.replace(/^(FALE|PERGUNTE|Frase)\s*:\s*/i, "");
  s = s.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  const words = s.split(/\s+/);
  if (words.length > 24) s = `${words.slice(0, 24).join(" ")}…`;
  return s;
}

function extractJson(raw: string): unknown {
  const s = (raw || "").replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("sem JSON");
  return JSON.parse(s.slice(start, end + 1));
}

async function callAI(messages: Array<{ role: string; content: string }>, key: string, maxTokens = 800) {
  return fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "none", // latência: sem raciocínio
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });
}

export const Route = createFileRoute("/api/public/coach")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        const started = Date.now();

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Payload inválido." }, { status: 400, headers: CORS });
        }

        // Etapa manual do vendedor = fonte da verdade. A IA nunca a substitui.
        const etapaManual =
          parsed.etapaManual && (ETAPAS as readonly string[]).includes(parsed.etapaManual)
            ? parsed.etapaManual
            : undefined;
        const isDI = etapaManual === "di";
        const isSpin = etapaManual === "spin";


        const last = parsed.turns[parsed.turns.length - 1];
        const quick = last ? detect(last.text, etapaManual) : null;

        const transcript = parsed.turns
          .slice(-4)
          .map((t) => `${t.speaker === "cliente" ? "CLIENTE" : "VENDEDOR"}: ${t.text}`)
          .join("\n");

        const memoria = normalizarMemoria(parsed.memoria);
        const memoriaTexto = memoriaParaPrompt(memoria);
        const camposMemoria = camposPreenchidos(memoria);
        const avSpin = avaliacaoSpin(memoria);
        const spinPronto = avSpin.suficiente;
        const blocoContexto = memoriaTexto
          ? `\n\nMEMÓRIA DA CALL (contexto acumulado, use só se deixar a frase mais natural e relevante):\n${memoriaTexto}`
          : "";
        const blocoEtapa = etapaManual ? `\nETAPA ATUAL (definida pelo vendedor): ${etapaManual}` : "";
        const blocoSpin = isSpin
          ? `\nESTADO DO SPIN: ${derivarSpinStatus(memoria)}${
              spinPronto
                ? ` — SPIN SUFICIENTE (${avSpin.motivo}): não investigue mais, confirme e avance.`
                : `\nMATERIAL COMERCIAL AINDA INSUFICIENTE: ${avSpin.motivo}.\nAPROFUNDE PRIMEIRO: ${
                    avSpin.faltando.slice(0, 2).join(" e ") || "o impacto real"
                  }.${
                    avSpin.minimizou
                      ? "\nATENÇÃO: o cliente MINIMIZOU a dor. Não confronte; peça um exemplo concreto da última vez que o inglês atrapalhou."
                      : ""
                  }`
            }`
          : "";


        // ---- Mapa vivo do cliente: o que já sabemos e o que ainda falta.
        const mapaTexto = mapaDaMemoria(memoria);
        const faltando = lacunasDaMemoria(memoria) as SlotKey[];
        const blocoMapa = `\n\nMAPA VIVO DO CLIENTE (tudo que já foi descoberto nesta call — nunca pergunte de novo o que está como respondido):\n${
          mapaTexto || "(ainda vazio)"
        }\nPRÓXIMAS LACUNAS REAIS: ${faltando.slice(0, 4).map((k) => SLOTS[k].rotulo.toLowerCase()).join(", ") || "nenhuma"}`;

        const sugestoes = (parsed.sugestoesAnteriores ?? []).filter((s) => s.trim()).slice(-3);
        const blocoSugestoes = sugestoes.length
          ? `\n\nFRASES JÁ SUGERIDAS AO VENDEDOR (não repita nem reformule):\n${sugestoes
              .map((s) => `- ${s}`)
              .join("\n")}`
          : "";

        // Anti-interrogatório: perguntas seguidas viram pressão. Prefira validar/confirmar.
        const perguntasSeguidas = sugestoes.filter((s) => s.trim().endsWith("?")).length;
        const blocoRitmo =
          perguntasSeguidas >= 2
            ? "\n\nRITMO: o vendedor já fez várias perguntas seguidas. Prefira confirmar, resumir, validar ou conectar antes de perguntar de novo."
            : "";


        const ms = () => Date.now() - started;
        const nada = (decisao: string, debug?: Record<string, unknown>) =>
          Response.json(
            {
              tipo: "nenhum",
              fonte: "ia",
              decisao,
              ms: ms(),
              debug: { ...debug, etapa_manual: etapaManual ?? null, campos_memoria: camposMemoria },
            },
            { headers: CORS },
          );

        // A situação vem da camada 1 (cliente) ou é reclassificada aqui.
        // Sinais de processo dependem da fala do vendedor: bloqueados nesta versão.
        // Na D.I. o assunto citado pelo cliente NÃO sequestra a etapa: só valem tipos da D.I. e sinais críticos.
        const aceitaNaEtapa = (t?: string) =>
          !!t &&
          t in FALLBACKS &&
          !PROCESSO.has(t) &&
          (!isDI || DI_TIPOS.has(t) || CRITICOS_SEMPRE.has(t)) &&
          (!isSpin || SPIN_TIPOS.has(t) || OBJECOES_REAIS.has(t) || CRITICOS_SEMPRE.has(t));
        let tipoCliente = aceitaNaEtapa(parsed.tipo)
          ? (parsed.tipo as string)
          : aceitaNaEtapa(quick?.tipo)
            ? (quick as { tipo: string }).tipo
            : "nenhum";

        // SPIN já suficiente: não investigue de novo — oriente a avançar.
        if (isSpin && spinPronto && SPIN_TIPOS.has(tipoCliente) && tipoCliente !== "spin_suficiente") {
          tipoCliente = "spin_suficiente";
        }

        let tipo = tipoCliente as SignalType;
        let etapaIA: string | undefined;
        let orientacaoIA: string | undefined;
        let fraseIA = "";
        let diStatusIA: string | undefined;
        let eixoIA: string | undefined;
        let acaoIA: string | undefined;
        let porqueIA: string | undefined;


        let confianca = tipo === "nenhum" ? 0 : 0.9;
        let decisao = tipo === "nenhum" ? "NO_TRIGGER_DETECTED" : "REGRA_LOCAL";
        const debug: Record<string, unknown> = {
          regraLocal: quick?.tipo ?? null,
          etapa_manual: etapaManual ?? null,
          memoria_utilizada: !!memoriaTexto,
          campos_memoria: camposMemoria,
          sinal_baseado_em: tipo === "nenhum" ? undefined : "regra_local",
          motivo_intervencao: tipo === "nenhum" ? undefined : `regra local: ${tipo}`,
        };

        // ---- Camada 1.5: nenhuma regra bateu -> a IA procura a próxima melhor ação.
        if (tipo === "nenhum") {
          if (!key) return nada("AI_NAO_CONFIGURADA", { ...debug, motivo_silencio: "IA não configurada" });
          try {
            const res = await callAI(
              [
                {
                  role: "system",
                  content: `${
                    isDI ? DI_CLASSIFY_SYSTEM : isSpin ? SPIN_CLASSIFY_SYSTEM : CLASSIFY_SYSTEM
                  }\n\n${DECISION_EXTRA}\n\nInclua também no JSON: "acao" (uma das ações possíveis) e "porque" (1 frase curta).`,
                },
                {
                  role: "user",
                  content: `${blocoEtapa}${blocoSpin}${blocoContexto}${blocoMapa}${blocoSugestoes}${blocoRitmo}\n\nCONVERSA (a última fala do cliente é a prioridade):\n${transcript}\n\nResponda só o JSON.`,
                },
              ],
              key,
            );

            if (!res.ok) return nada(`AI_HTTP_${res.status}`, { ...debug, motivo_silencio: "falha na IA" });
            const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
            const raw = data.choices?.[0]?.message?.content ?? "";
            debug["classificadorRaw"] = raw.slice(0, 600);
            if (!raw.trim()) return nada("AI_EMPTY_RESPONSE", { ...debug, motivo_silencio: "resposta vazia" });

            let obj: Record<string, unknown>;
            try {
              obj = extractJson(raw) as Record<string, unknown>;
            } catch {
              return nada("INVALID_JSON", { ...debug, motivo_silencio: "JSON inválido" });
            }
            debug["classificadorJson"] = obj;
            const motivoIA = typeof obj["motivo"] === "string" ? (obj["motivo"] as string) : undefined;

            const t = String(obj["tipo"] ?? "nenhum");
            confianca = Number(obj["confianca"] ?? 0.6);
            if (!Number.isFinite(confianca)) confianca = 0.6;
            if (t === "nenhum")
              return nada("NO_ACTION_NEEDED", {
                ...debug,
                confianca,
                motivo_silencio: motivoIA ?? "sem próxima ação útil",
              });
            if (PROCESSO.has(t))
              return nada("PROCESSO_BLOQUEADO", {
                ...debug,
                confianca,
                tipoSugerido: t,
                sinal_baseado_em: "processo",
                motivo_silencio: "alerta de processo sem evidência da fala do vendedor",
              });
            if (isDI && !DI_TIPOS.has(t) && !CRITICOS_SEMPRE.has(t))
              return nada("FORA_DA_ETAPA_DI", {
                ...debug,
                confianca,
                tipoSugerido: t,
                motivo_silencio: "assunto não estabelece a Regra do Jogo",
              });
            if (isSpin && !SPIN_TIPOS.has(t) && !OBJECOES_REAIS.has(t) && !CRITICOS_SEMPRE.has(t))
              return nada("FORA_DA_ETAPA_SPIN", {
                ...debug,
                confianca,
                tipoSugerido: t,
                motivo_silencio: "assunto não aprofunda o SPIN",
              });
            if (!(t in FALLBACKS))
              return nada("PARSE_ERROR", { ...debug, tipoInvalido: t, motivo_silencio: "tipo inválido" });

            if (confianca < threshold(t))
              return nada("LOW_CONFIDENCE", {
                ...debug,
                tipoSugerido: t,
                confianca,
                minimo: threshold(t),
                motivo_silencio: "confiança insuficiente",
              });

            tipo = t as SignalType;
            etapaIA = typeof obj["etapa"] === "string" ? (obj["etapa"] as string) : undefined;
            orientacaoIA = typeof obj["orientacao"] === "string" ? (obj["orientacao"] as string) : undefined;
            fraseIA = clean(String(obj["frase"] ?? ""));
            decisao = `${tipo.toUpperCase()}_IA`;
            debug["sinal_baseado_em"] = "fala_cliente";
            debug["motivo_intervencao"] = motivoIA ?? `sinal do cliente: ${tipo}`;
            debug["confianca"] = confianca;
            if (typeof obj["diStatus"] === "string") diStatusIA = obj["diStatus"] as string;
            if (typeof obj["eixo"] === "string") eixoIA = (obj["eixo"] as string).slice(0, 40);
            if (typeof obj["acao"] === "string") acaoIA = (obj["acao"] as string).slice(0, 30);
            if (typeof obj["porque"] === "string") porqueIA = (obj["porque"] as string).trim().slice(0, 180);

            // Trava semântica: a frase tenta descobrir algo que o cliente já respondeu.
            const repetiu = fraseRepetida(memoria.mapa, fraseIA);
            if (repetiu)
              return nada("PERGUNTA_JA_RESPONDIDA", {
                ...debug,
                confianca,
                tipoSugerido: t,
                slotRepetido: repetiu,
                fraseDescartada: fraseIA,
                motivo_silencio: `${SLOTS[repetiu].rotulo.toLowerCase()} já foi respondido nesta call`,
              });

          } catch (e) {
            return nada("PARSE_ERROR", {
              ...debug,
              erro: e instanceof Error ? e.message : String(e),
              motivo_silencio: "erro no classificador",
            });
          }
        }


        const base = FALLBACKS[tipo as Exclude<SignalType, "nenhum">];
        const etapaBruta = parsed.etapa ?? etapaIA;
        // A etapa manual do vendedor prevalece sobre qualquer inferência.
        const etapa =
          etapaManual ??
          (etapaBruta && (ETAPAS as readonly string[]).includes(etapaBruta) ? etapaBruta : base.etapa);


        const DI_STATUS_POR_TIPO: Record<string, string> = {
          di_resistencia: "resistencia",
          di_criterios: "criterios_identificados",
          di_comparacao: "resistencia_persistente",
          di_pede_apresentacao: "apresentada",
          di_estabelecida: "estabelecida",
        };
        const spinStatus = isSpin ? derivarSpinStatus(memoria) : null;
        if (isSpin) {
          debug["spin_status"] = spinStatus;
          debug["spin_suficiente"] = spinPronto;
          debug["spin_eixos_explorados"] = memoria.spinPerguntasJaExploradas;
        }

        const diStatus = isDI ? (diStatusIA ?? DI_STATUS_POR_TIPO[tipo] ?? null) : null;
        if (isDI) debug["di_status"] = diStatus;

        const card = {
          tipo,
          etapa,
          rotulo: base.rotulo,
          nivel: base.nivel,
          orientacao: orientacaoIA?.trim() || base.orientacao,
          confianca,
          decisao,
          diStatus,
          spinStatus,
          eixo: eixoIA ?? null,
          acao: acaoIA ?? null,
          porque: porqueIA ?? null,
          lacunas: faltando.slice(0, 4),
          fonte: "ia" as const,
        };

        if (!key) {
          return Response.json(
            { ...card, frase: base.frase, ms: ms(), debug, aviso: "AI não configurada." },
            { headers: CORS },
          );
        }

        // A IA da classificação já escreveu uma frase boa: não gasta outra chamada.
        if (fraseIA.length >= 12) {
          return Response.json({ ...card, frase: fraseIA, ms: ms(), debug }, { headers: CORS });
        }

        // Contexto mínimo: só a regra da situação + últimos turnos.
        const upstreamStart = Date.now();
        try {
          const res = await callAI(
            [
              {
                role: "system",
                content: `${
                  isDI
                    ? `${COACH_SYSTEM}\n\n${DI_COACH_EXTRA}`
                    : isSpin
                      ? `${COACH_SYSTEM}\n\n${SPIN_COACH_EXTRA}`
                      : COACH_SYSTEM
                }\n\n${NATURALIDADE_EXTRA}`,
              },
              {
                role: "user",
                content: `SITUAÇÃO: ${base.rotulo}\nETAPA: ${etapa ?? "-"}\nREGRA: ${
                  RULE_SNIPPETS[tipo] ?? base.orientacao
                }${blocoSpin}${blocoContexto}${blocoMapa}${blocoSugestoes}${blocoRitmo}\n\nCONVERSA (a última fala do cliente é a prioridade):\n${transcript}\n\nResponda em exatamente duas linhas, sem markdown:\nFRASE: a frase que o vendedor fala agora\nPORQUE: até 20 palavras explicando ao vendedor por que essa é a melhor ação agora.`,
              },
            ],
            key,
          );


          if (!res.ok) {
            return Response.json(
              {
                ...card,
                fonte: "regra",
                frase: base.frase,
                ms: ms(),
                debug,
                aviso: `IA indisponível (${res.status})`,
              },
              { headers: CORS },
            );
          }

          const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const bruto = data.choices?.[0]?.message?.content ?? "";
          const linhas = bruto
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          const linhaFrase = linhas.find((l) => /^frase\s*:/i.test(l)) ?? linhas[0] ?? "";
          const linhaPorque = linhas.find((l) => /^porqu[eê]\s*:/i.test(l)) ?? "";
          const raw = clean(linhaFrase.replace(/^frase\s*:\s*/i, ""));
          const porqueFinal =
            porqueIA ?? (linhaPorque ? linhaPorque.replace(/^porqu[eê]\s*:\s*/i, "").slice(0, 180) : null);
          debug["fraseRaw"] = raw;
          // Saída truncada/vazia cai na frase do playbook.
          let frase = raw.length >= 12 ? raw : base.frase;
          const repetiuFinal = fraseRepetida(memoria.mapa, frase);
          if (repetiuFinal) {
            // Já respondido nesta call: não repetimos a pergunta — orientamos sem frase.
            debug["fraseDescartada"] = frase;
            debug["slotRepetido"] = repetiuFinal;
            frase = "";
          }

          return Response.json(
            { ...card, frase, porque: porqueFinal, ms: ms(), iaMs: Date.now() - upstreamStart, debug },
            { headers: CORS },
          );
        } catch (e) {
          return Response.json(
            {
              ...card,
              fonte: "regra",
              frase: base.frase,
              ms: ms(),
              debug,
              aviso: `Falha na IA: ${e instanceof Error ? e.message : String(e)}`,
            },
            { headers: CORS },
          );
        }
      },
    },
  },
});
