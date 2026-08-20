# Sales Ally

Quero criar um projeto chamado United Copilot.

A ideia é desenvolver inicialmente uma extensão para Chrome que funcione como um copiloto comercial durante reuniões de vendas ao vivo, principalmente realizadas pelo Zoom.

O problema que quero resolver é simples: durante uma call, o cliente traz objeções, dúvidas ou sinais de interesse e o vendedor nem sempre consegue pensar na melhor resposta imediatamente.

O copiloto deverá acompanhar a conversa em tempo real, entender o que o cliente está dizendo e mostrar ao vendedor sugestões curtas de como responder.

Exemplo:

Cliente: “Gostei, mas preciso pensar.”

O sistema poderia mostrar:

Objeção detectada: decisão

Orientação: descubra o que ainda impede a decisão.

Sugestão: “Claro. O que especificamente você sente que ainda precisa avaliar antes de decidir?”

O objetivo NÃO é a IA conversar com o cliente. O cliente não deve ouvir nem ver o copiloto. Apenas o vendedor verá as sugestões.

MVP inicial

Quero começar o mais simples possível para validar a ideia.

O MVP precisa:

Capturar o áudio da reunião.

Transcrever a conversa em tempo real.

Identificar quando o cliente traz algo relevante, como:

objeção financeira;

falta de tempo;

“preciso pensar”;

segunda opinião/cônjuge;

dúvida sobre metodologia;

interesse;

intenção de compra;

fechamento.

Enviar somente o contexto necessário para uma IA.

Mostrar uma orientação curta para o vendedor.

Mostrar, quando necessário, uma frase sugerida para ele falar.

Prioridade absoluta: velocidade

Esse é o principal requisito do projeto.

Quero testar se conseguimos fazer o cliente terminar uma fala relevante e o vendedor receber uma sugestão em aproximadamente 1 a 3 segundos.

Não quero respostas longas.

Exemplo de interface:

🔴 FINANCEIRO

Isole a objeção antes de negociar.

Pergunte:
“Tirando o investimento, faria sentido começar?”

É melhor mostrar rapidamente uma orientação curta do que esperar vários segundos por uma resposta elaborada.

Processamento

Não quero rodar modelos pesados de IA localmente no computador.

A extensão deve ser leve e o processamento de:

speech-to-text;

identificação do contexto;

IA;

deve acontecer preferencialmente na nuvem.

Zoom

Eu normalmente utilizo o aplicativo desktop do Zoom, e não necessariamente o Zoom dentro do navegador.

Portanto, um dos primeiros pontos técnicos que precisamos validar é a melhor maneira de a extensão Chrome capturar o áudio da reunião do Zoom Desktop, possivelmente utilizando recursos de captura de tela/áudio do Chrome ou outra abordagem compatível.

Essa validação é prioritária antes de desenvolvermos o restante do produto.

Interface

Quero algo discreto, simples e rápido de ler.

Pode ser um painel lateral ou pequena janela contendo algo como:

COPILOTO ATIVO 🎙️

Cliente falando...

🔴 Objeção financeira

Isole antes de oferecer condição.

Pergunte:
“Se o investimento não fosse uma questão, você começaria?”

O vendedor precisa conseguir bater o olho e entender a recomendação em menos de 1 segundo.

Inteligência comercial

Posteriormente quero alimentar esse copiloto com nosso próprio playbook comercial.

Ele deverá aprender:

nossa estrutura de entrevista;

SPIN;

regra do jogo;

DI;

tratamento de objeções;

isolamento de objeção;

financeiro;

tempo;

metodologia;

segunda opinião;

fechamento;

gatilhos;

perguntas recomendadas;

situações em que o vendedor deve ou não oferecer uma condição.

Não quero um ChatGPT genérico.

Quero um copiloto treinado para nossa forma de vender.

Futuro

Não implementar tudo agora, mas considerar na arquitetura futura:

integração com nosso CRM;

identificar automaticamente qual lead está na reunião;

conhecer histórico e proposta daquele lead;

identificar etapa da call;

analisar proporção de fala vendedor/cliente;

avisar quando vendedor está falando demais;

identificar sinais de compra;

detectar objeções automaticamente;

gerar resumo ao terminar;

registrar objeções;

sugerir follow-up;

avaliar a performance do vendedor.

Regra principal para o desenvolvimento

Não começar construindo uma plataforma enorme.

Primeiro quero provar apenas este fluxo:

Áudio do Zoom → transcrição → detectar uma objeção → gerar orientação → mostrar na tela em aproximadamente 2–3 segundos.

Se esse teste funcionar bem, evoluímos o produto.

Quero que todas as decisões técnicas iniciais sejam pensadas para validar esse MVP da maneira mais rápida, simples, leve e barata possível.

Antes de começar a construir, analise a viabilidade técnica desse MVP, principalmente a captura do áudio do Zoom Desktop por uma extensão Chrome, e me explique qual arquitetura você recomenda para fazermos o primeiro teste funcional.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fanaticoscopilot.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ca4edc97-ed9d-42d0-af3c-3c6e44cfad3b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
