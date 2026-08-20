import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  MEMORY_SYSTEM,
  aplicarPatch,
  camposPreenchidos,
  memoriaParaPrompt,
  normalizarMemoria,
} from "@/lib/memoria";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  memoria: z.unknown().optional(),
  text: z.string().min(1).max(1200),
  etapa: z.string().optional(),
});

const MODEL = "google/gemini-3.1-flash-lite";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function extractJson(raw: string): unknown {
  const s = (raw || "").replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/public/memory")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const started = Date.now();
        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Payload inválido." }, { status: 400, headers: CORS });
        }

        const atual = normalizarMemoria(parsed.memoria);
        if (parsed.etapa) atual.etapaAtual = parsed.etapa;
        atual.ultimaInteracao = parsed.text.slice(0, 160);

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) {
          return Response.json(
            { memoria: atual, alterados: [], campos: camposPreenchidos(atual), ms: Date.now() - started },
            { headers: CORS },
          );
        }

        try {
          const res = await fetch(AI_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL,
              reasoning_effort: "none",
              temperature: 0.2,
              max_tokens: 400,
              messages: [
                { role: "system", content: MEMORY_SYSTEM },
                {
                  role: "user",
                  content: `MEMÓRIA ATUAL:\n${memoriaParaPrompt(atual) || "(vazia)"}\n\nFALA DO CLIENTE:\n${
                    parsed.text
                  }\n\nResponda só o JSON com os campos novos.`,
                },
              ],
            }),
          });
          if (!res.ok) {
            return Response.json(
              { memoria: atual, alterados: [], campos: camposPreenchidos(atual), ms: Date.now() - started },
              { headers: CORS },
            );
          }
          const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const patch = extractJson(data.choices?.[0]?.message?.content ?? "");
          const { memoria, alterados } = aplicarPatch(atual, patch);
          return Response.json(
            { memoria, alterados, campos: camposPreenchidos(memoria), ms: Date.now() - started },
            { headers: CORS },
          );
        } catch {
          return Response.json(
            { memoria: atual, alterados: [], campos: camposPreenchidos(atual), ms: Date.now() - started },
            { headers: CORS },
          );
        }
      },
    },
  },
});
