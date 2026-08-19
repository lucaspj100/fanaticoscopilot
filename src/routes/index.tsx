import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { detect, type Signal } from "@/lib/detector";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "United Copilot — copiloto de vendas ao vivo no Zoom" },
      {
        name: "description",
        content:
          "Extensão Chrome que ouve sua call de vendas, detecta objeções em tempo real e mostra a próxima frase em 1 a 3 segundos.",
      },
      { property: "og:title", content: "United Copilot — copiloto de vendas ao vivo" },
      {
        property: "og:description",
        content: "Detecte objeções durante a call e receba a orientação certa em segundos. Só o vendedor vê.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type Card = Signal & { fonte?: string; ms?: number };

const NIVEL_STYLE: Record<string, string> = {
  alerta: "border-l-alerta",
  aviso: "border-l-aviso",
  atencao: "border-l-atencao",
  positivo: "border-l-positivo",
};
const NIVEL_TEXT: Record<string, string> = {
  alerta: "text-alerta",
  aviso: "text-aviso",
  atencao: "text-atencao",
  positivo: "text-positivo",
};

const ETAPA_LABEL: Record<string, string> = {
  rapport: "Rapport",
  di: "Regra do jogo / D.I.",
  spin: "Pré-speech / SPIN",
  apresentacao: "Apresentação",
  gatilho: "Gatilho de fechamento",
  fechamento: "Fechamento",
};

const EXEMPLOS = [
  "Gostei bastante, mas preciso pensar melhor.",
  "Achei o valor um pouco acima do que eu esperava.",
  "Preciso conversar com minha esposa antes de decidir.",
  "Preciso do inglês para a minha carreira.",
  "Agora estou muito corrido, talvez mais pra frente.",
  "Já fiz outro curso e não deu certo.",
  "Quero começar. Como eu faço pra contratar?",
];

function CopilotCard({ card }: { card: Card }) {
  return (
    <article
      className={`rounded-xl border border-border border-l-4 bg-surface p-4 ${NIVEL_STYLE[card.nivel] ?? "border-l-border"}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className={`text-[11px] font-extrabold uppercase tracking-[0.14em] ${NIVEL_TEXT[card.nivel] ?? ""}`}>
          {card.rotulo}
        </div>
        {card.etapa && (
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {ETAPA_LABEL[card.etapa] ?? card.etapa}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-lg leading-tight font-bold">{card.orientacao}</p>
      {card.frase && (
        <div className="mt-2.5">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            Pergunte:
          </div>
          <p className="mt-1 rounded-lg border border-dashed border-border bg-background px-3 py-2 text-base">
            “{card.frase}”
          </p>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {card.fonte === "regra" ? "regra instantânea" : "IA + playbook"}
        {card.ms != null && ` · ${card.ms} ms`}
      </p>
    </article>
  );
}

function Simulador() {
  const [text, setText] = useState(EXEMPLOS[0] ?? "");
  const [instant, setInstant] = useState<Card | null>(null);
  const [ia, setIa] = useState<Card | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function run(input: string) {
    const frase = input.trim();
    if (!frase) return;
    setErro(null);
    setIa(null);
    const t0 = performance.now();
    const quick = detect(frase);
    setInstant(quick ? { ...quick, fonte: "regra", ms: Math.round(performance.now() - t0) } : null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: [{ speaker: "cliente", text: frase }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.tipo && data.tipo !== "nenhum") setIa({ ...data, ms: Math.round(performance.now() - t0) });
      else setErro("Nenhum sinal comercial relevante nessa fala.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <label htmlFor="fala" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Fala do cliente
        </label>
        <textarea
          id="fala"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mt-2 w-full resize-none rounded-xl border border-input bg-surface p-3 text-base outline-none focus:border-ring"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXEMPLOS.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setText(ex);
                void run(ex);
              }}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {ex.slice(0, 28)}…
            </button>
          ))}
        </div>
        <button
          onClick={() => void run(text)}
          disabled={loading}
          className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Processando…" : "Gerar orientação"}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
          <span className="live-dot inline-block size-2 rounded-full bg-alerta" />
          Painel do vendedor
        </div>
        {!instant && !ia && !erro && (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Escolha uma fala e veja o card que apareceria na call.
          </p>
        )}
        {instant && !ia && <CopilotCard card={instant} />}
        {ia && <CopilotCard card={ia} />}
        {loading && <p className="text-xs text-muted-foreground">Refinando com o playbook…</p>}
        {erro && <p className="text-xs text-alerta">{erro}</p>}
      </div>
    </div>
  );
}

function baixarExtensao() {
  fetch("/united-copilot.zip")
    .then((res) => {
      if (!res.ok) throw new Error(`Download falhou: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "united-copilot.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(err.message));
}

const PASSOS = [
  "Baixe e descompacte o arquivo united-copilot.zip.",
  "Abra chrome://extensions no Chrome.",
  "Ative o Modo do desenvolvedor (canto superior direito).",
  "Clique em Carregar sem compactação e selecione a pasta descompactada.",
  "Entre na call em app.zoom.us, clique no ícone da extensão e depois em Iniciar.",
];

function Home() {
  return (
    <div className="min-h-screen">
      <header className="grid-lines border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="live-dot inline-block size-2 rounded-full bg-alerta" />
            MVP · validação de latência
          </div>
          <h1 className="mt-6 text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            United Copilot
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            O cliente traz uma objeção. Em 1 a 3 segundos você vê o que fazer e a frase exata para falar. Só o
            vendedor vê — o cliente não ouve nem percebe nada.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={baixarExtensao}
              className="rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Baixar extensão (.zip)
            </button>
            <a
              href="#simulador"
              className="rounded-lg border border-border px-6 py-3 text-sm font-bold transition-colors hover:bg-accent"
            >
              Testar o pipeline
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section id="simulador" className="border-b border-border py-16">
          <h2 className="text-2xl font-bold tracking-tight">Simulador</h2>
          <p className="mt-2 mb-8 max-w-2xl text-sm text-muted-foreground">
            Mesma cadeia usada na call, sem o áudio: detecção instantânea por regra e, logo em seguida, o refino da
            IA com o playbook. O tempo em milissegundos é medido de ponta a ponta.
          </p>
          <Simulador />
        </section>

        <section className="border-b border-border py-16">
          <h2 className="text-2xl font-bold tracking-tight">Como o áudio chega até aqui</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              ["1 · Captura", "A extensão captura o áudio da aba do Zoom Web (tabCapture). Nada é gravado em disco."],
              ["2 · Turno de fala", "Um detector de silêncio fecha o turno assim que o cliente para de falar."],
              ["3 · Transcrição", "O trecho vira um WAV de 16 kHz e é transcrito na nuvem em ~700 ms."],
              ["4 · Orientação", "Regra local mostra o card na hora; a IA refina com o playbook logo depois."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-border bg-surface p-5">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary">{t}</div>
                <p className="mt-2 text-sm text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-xl border border-dashed border-atencao/40 bg-surface p-4 text-sm text-muted-foreground">
            <strong className="text-atencao">Importante:</strong> o Chrome não captura o áudio do app Zoom Desktop
            neste MVP. Use a call em <code>app.zoom.us</code>. No Windows dá para evoluir para captura de áudio do
            sistema; no macOS isso exige um app nativo.
          </p>
        </section>

        <section className="py-16">
          <h2 className="text-2xl font-bold tracking-tight">Instalação</h2>
          <ol className="mt-6 space-y-3">
            {PASSOS.map((p, i) => (
              <li key={p} className="flex gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-bold text-foreground">
                  {i + 1}
                </span>
                {p}
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        United Copilot · MVP interno
      </footer>
    </div>
  );
}
