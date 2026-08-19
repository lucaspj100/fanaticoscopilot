import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { FALLBACKS, detect, type SignalType } from "@/lib/detector";
import { SYSTEM_PROMPT } from "@/lib/playbook";

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
});

const VALID: SignalType[] = [
  "financeiro",
  "tempo",
  "pensar",
  "segunda_opiniao",
  "metodologia",
  "interesse",
  "intencao_compra",
  "fechamento",
  "nenhum",
];

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

        if (!key) {
          return Response.json({ error: "AI não configurada." }, { status: 500, headers: CORS });
        }

        const transcript = parsed.turns.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`).join("\n");

        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3.7-flash",
              reasoning_effort: "none", // latência: sem raciocínio, resposta em ~1s
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                  role: "user",
                  content: `Últimos turnos da call:\n${transcript}\n\nDevolva o JSON da orientação para o vendedor agora.`,
                },
              ],
              response_format: { type: "json_object" },
              max_tokens: 600,
              temperature: 0.3,
            }),
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            if (quick) {
              return Response.json(
                { ...quick, fonte: "regra", ms: Date.now() - started, aviso: `IA indisponível (${res.status})` },
                { headers: CORS },
              );
            }
            return Response.json(
              { error: `IA indisponível (${res.status})`, detail: detail.slice(0, 300) },
              { status: res.status, headers: CORS },
            );
          }

          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const raw = data.choices?.[0]?.message?.content ?? "{}";
          const out = JSON.parse(raw.replace(/^```json\s*|```$/g, "")) as {
            tipo?: string;
            orientacao?: string;
            frase?: string;
          };

          const tipo = (VALID.includes(out.tipo as SignalType) ? out.tipo : quick?.tipo ?? "nenhum") as SignalType;
          if (tipo === "nenhum") {
            return Response.json({ tipo: "nenhum", fonte: "ia", ms: Date.now() - started }, { headers: CORS });
          }
          const base = FALLBACKS[tipo as Exclude<SignalType, "nenhum">];

          return Response.json(
            {
              tipo,
              rotulo: base.rotulo,
              nivel: base.nivel,
              orientacao: out.orientacao?.trim() || base.orientacao,
              frase: out.frase?.trim() || base.frase,
              fonte: "ia",
              ms: Date.now() - started,
            },
            { headers: CORS },
          );
        } catch (e) {
          if (quick) {
            return Response.json(
              { ...quick, fonte: "regra", ms: Date.now() - started, aviso: `Falha na IA: ${e instanceof Error ? e.message : String(e)}` },
              { headers: CORS },
            );
          }
          return Response.json(
            { error: e instanceof Error ? e.message : "Erro inesperado" },
            { status: 500, headers: CORS },
          );
        }
      },
    },
  },
});
