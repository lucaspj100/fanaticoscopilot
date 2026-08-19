import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { FALLBACKS, detect, type SignalType } from "@/lib/detector";
import { COACH_SYSTEM, RULE_SNIPPETS } from "@/lib/playbook";

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
});

const ETAPAS = ["rapport", "di", "spin", "apresentacao", "gatilho", "fechamento"] as const;

/** Frase em uma linha, sem aspas, sem rótulo, curta. */
function clean(raw: string): string {
  let s = (raw || "").trim().split("\n")[0]?.trim() ?? "";
  s = s.replace(/^(FALE|PERGUNTE|Frase)\s*:\s*/i, "");
  s = s.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  const words = s.split(/\s+/);
  if (words.length > 24) s = `${words.slice(0, 24).join(" ")}…`;
  return s;
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

        // A situação vem da camada 1 (cliente) ou é reclassificada aqui.
        const tipo = (
          parsed.tipo && parsed.tipo in FALLBACKS ? parsed.tipo : quick?.tipo ?? "nenhum"
        ) as SignalType;

        if (tipo === "nenhum") {
          return Response.json({ tipo: "nenhum", fonte: "ia", ms: Date.now() - started }, { headers: CORS });
        }

        const base = FALLBACKS[tipo as Exclude<SignalType, "nenhum">];
        const etapa =
          parsed.etapa && (ETAPAS as readonly string[]).includes(parsed.etapa) ? parsed.etapa : base.etapa;

        const card = {
          tipo,
          etapa,
          rotulo: base.rotulo,
          nivel: base.nivel,
          orientacao: base.orientacao,
          fonte: "ia" as const,
        };

        if (!key) {
          return Response.json(
            { ...card, frase: base.frase, ms: Date.now() - started, aviso: "AI não configurada." },
            { headers: CORS },
          );
        }

        // Contexto mínimo: só a regra da situação + últimos turnos.
        const transcript = parsed.turns
          .slice(-4)
          .map((t) => `${t.speaker === "cliente" ? "CLIENTE" : "VENDEDOR"}: ${t.text}`)
          .join("\n");

        const upstreamStart = Date.now();
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3.1-flash-lite",
              reasoning_effort: "none", // latência: sem raciocínio
              messages: [
                { role: "system", content: COACH_SYSTEM },
                {
                  role: "user",
                  content: `SITUAÇÃO: ${base.rotulo}\nETAPA: ${etapa ?? "-"}\nREGRA: ${
                    RULE_SNIPPETS[tipo] ?? base.orientacao
                  }\n\nCONVERSA:\n${transcript}\n\nEscreva só a frase que o vendedor fala agora.`,
                },
              ],
              max_tokens: 800,
              temperature: 0.7,
            }),
          });

          if (!res.ok) {
            return Response.json(
              { ...card, fonte: "regra", frase: base.frase, ms: Date.now() - started, aviso: `IA indisponível (${res.status})` },
              { headers: CORS },
            );
          }

          const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const raw = clean(data.choices?.[0]?.message?.content ?? "");
          // Saída truncada/vazia cai na frase do playbook.
          const frase = raw.length >= 12 ? raw : "";

          return Response.json(
            {
              ...card,
              frase: frase || base.frase,
              ms: Date.now() - started,
              iaMs: Date.now() - upstreamStart,
            },
            { headers: CORS },
          );
        } catch (e) {
          return Response.json(
            {
              ...card,
              fonte: "regra",
              frase: base.frase,
              ms: Date.now() - started,
              aviso: `Falha na IA: ${e instanceof Error ? e.message : String(e)}`,
            },
            { headers: CORS },
          );
        }
      },
    },
  },
});
