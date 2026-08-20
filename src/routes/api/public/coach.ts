import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { FALLBACKS, detect, type SignalType } from "@/lib/detector";
import { camposPreenchidos, memoriaParaPrompt, normalizarMemoria } from "@/lib/memoria";
import { CLASSIFY_SYSTEM, COACH_SYSTEM, RULE_SNIPPETS } from "@/lib/playbook";

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

/** Threshold alto para objeções/compra; moderado para aprofundamento de SPIN. */
const CRITICOS = new Set<string>([
  "fechou",
  "intencao_compra",
  "financeiro",
  "pensar",
  "segunda_opiniao",
  "tempo",
  "metodologia",
]);
const threshold = (tipo: string) => (CRITICOS.has(tipo) ? 0.75 : 0.65);


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

        const last = parsed.turns[parsed.turns.length - 1];
        const quick = last ? detect(last.text) : null;

        const transcript = parsed.turns
          .slice(-4)
          .map((t) => `${t.speaker === "cliente" ? "CLIENTE" : "VENDEDOR"}: ${t.text}`)
          .join("\n");

        const ms = () => Date.now() - started;
        const nada = (decisao: string, debug?: Record<string, unknown>) =>
          Response.json({ tipo: "nenhum", fonte: "ia", decisao, ms: ms(), debug }, { headers: CORS });

        // A situação vem da camada 1 (cliente) ou é reclassificada aqui.
        // Sinais de processo dependem da fala do vendedor: bloqueados nesta versão.
        const tipoCliente =
          parsed.tipo && parsed.tipo in FALLBACKS && !PROCESSO.has(parsed.tipo)
            ? parsed.tipo
            : (quick && !PROCESSO.has(quick.tipo) ? quick.tipo : "nenhum");
        let tipo = tipoCliente as SignalType;
        let etapaIA: string | undefined;
        let orientacaoIA: string | undefined;
        let fraseIA = "";
        let confianca = tipo === "nenhum" ? 0 : 0.9;
        let decisao = tipo === "nenhum" ? "NO_TRIGGER_DETECTED" : "REGRA_LOCAL";
        const debug: Record<string, unknown> = {
          regraLocal: quick?.tipo ?? null,
          sinal_baseado_em: tipo === "nenhum" ? undefined : "regra_local",
          motivo_intervencao: tipo === "nenhum" ? undefined : `regra local: ${tipo}`,
        };

        // ---- Camada 1.5: nenhuma regra bateu -> a IA procura a próxima melhor ação.
        if (tipo === "nenhum") {
          if (!key) return nada("AI_NAO_CONFIGURADA", { ...debug, motivo_silencio: "IA não configurada" });
          try {
            const res = await callAI(
              [
                { role: "system", content: CLASSIFY_SYSTEM },
                { role: "user", content: `CONVERSA:\n${transcript}\n\nResponda só o JSON.` },
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
        const etapa =
          etapaBruta && (ETAPAS as readonly string[]).includes(etapaBruta) ? etapaBruta : base.etapa;

        const card = {
          tipo,
          etapa,
          rotulo: base.rotulo,
          nivel: base.nivel,
          orientacao: orientacaoIA?.trim() || base.orientacao,
          confianca,
          decisao,
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
              { role: "system", content: COACH_SYSTEM },
              {
                role: "user",
                content: `SITUAÇÃO: ${base.rotulo}\nETAPA: ${etapa ?? "-"}\nREGRA: ${
                  RULE_SNIPPETS[tipo] ?? base.orientacao
                }\n\nCONVERSA:\n${transcript}\n\nEscreva só a frase que o vendedor fala agora.`,
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
          const raw = clean(data.choices?.[0]?.message?.content ?? "");
          debug["fraseRaw"] = raw;
          // Saída truncada/vazia cai na frase do playbook.
          const frase = raw.length >= 12 ? raw : "";

          return Response.json(
            { ...card, frase: frase || base.frase, ms: ms(), iaMs: Date.now() - upstreamStart, debug },
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
