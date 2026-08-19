import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BYTES = 8 * 1024 * 1024;

export const Route = createFileRoute("/api/public/transcribe")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) {
          return Response.json({ error: "AI não configurada." }, { status: 500, headers: CORS });
        }

        let file: File | null = null;
        try {
          const form = await request.formData();
          const f = form.get("file");
          if (f instanceof File) file = f;
        } catch {
          return Response.json({ error: "Envie multipart/form-data." }, { status: 400, headers: CORS });
        }

        if (!file || file.size < 2048) {
          return Response.json({ error: "Áudio vazio ou muito curto." }, { status: 400, headers: CORS });
        }
        if (file.size > MAX_BYTES) {
          return Response.json({ error: "Áudio grande demais." }, { status: 413, headers: CORS });
        }

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-transcribe");
        upstream.append("file", file, "recording.wav");
        upstream.append("language", "pt");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return Response.json(
            { error: `Falha na transcrição (${res.status})`, detail: detail.slice(0, 400) },
            { status: res.status, headers: CORS },
          );
        }

        const data = (await res.json()) as { text?: string };
        return Response.json({ text: data.text ?? "" }, { headers: CORS });
      },
    },
  },
});
