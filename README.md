# Debony — clone estático

Clone fiel de `debonyusinagem.com.br` (WordPress + Elementor) para deploy na
Vercel. O HTML, o CSS e as imagens são os do site original, com todas as URLs
reescritas para caminhos relativos. O que era backend PHP foi substituído por
TypeScript: um bundle no cliente e uma Vercel Function.

## Estrutura

| Caminho | O que é |
|---|---|
| `site/` | Output do deploy (gerado — não editar à mão) |
| `src/` | TypeScript do cliente, compilado para `site/assets/js/app.js` |
| `api/contact.ts` | Vercel Function que recebe o formulário de contato |
| `public/` | CSS próprio, copiado para `site/` no build |
| `vercel.json` | Build, output, cabeçalhos e redirects |
| `tools/` | Crawler do mirror, conversor de imagens, build e verificadores |

## Comandos

```bash
npm install

npm run mirror     # rebaixa o site de origem para site/ (resume o que já existe)
npm run optimize   # converte PNG/JPEG para WebP e reescreve as referências
npm run build      # compila o TS, copia public/ e injeta os assets nas páginas
npm test           # exercita api/contact.ts sem depender da Vercel
npm run test:e2e   # formulário + UTMs num Chrome real, com webhook stub local
npm run logo       # regenera as versões WebP da logo a partir do PNG
npm run verify     # typecheck + referências + npm test
npm run release    # mirror + optimize + build + verify, na ordem
npm run dev        # vercel dev
npm run deploy     # vercel --prod
```

Ordem importa: `mirror` reescreve os HTML do zero, então `optimize` e `build`
vêm depois — use `npm run release` e não erra. O `build` é idempotente: rodar
duas vezes não duplica as tags injetadas.

Verificação em browser real (precisa do Chrome e de um servidor local
apontando para `site/`):

```bash
node tools/test-lightbox.mjs http://127.0.0.1:8905/certificados/
node tools/test-menu.mjs     http://127.0.0.1:8905
node tools/test-cabecalho.mjs http://127.0.0.1:8905
node tools/scan-404.mjs      http://127.0.0.1:8905
node tools/test-whatsapp.mjs http://127.0.0.1:8905
```

## Deploy na Vercel

Projeto **sem framework**: `site/` é servido como estático e `api/` vira função.
O `vercel.json` declara tudo o que o deploy precisa:

- `buildCommand`: `npm run build`
- `outputDirectory`: `site`
- `headers`: segurança em tudo, e cache imutável em `/wp-content`,
  `/wp-includes` e `/assets`
- `redirects`: as rotas do WordPress que não existem mais

No painel basta importar o repositório — **Framework Preset: Other**. Não é
preciso configurar build nem output à mão, porque o `vercel.json` já os define.

`npm run build` valida o `vercel.json` antes de qualquer coisa. Sem isso, um
erro de forma só apareceria no build da Vercel, depois do push.

### Detalhes de roteamento

`cleanUrls` e `trailingSlash` ficam **desligados de propósito**. Os links entre
páginas apontam para `index.html` explicitamente (`../sobre-nos/index.html`),
então ativar qualquer um dos dois criaria uma cadeia de 308 em cada navegação.
Com ambos desligados, `/sobre-nos`, `/sobre-nos/` e `/sobre-nos/index.html`
servem a mesma página sem redirecionar.

Os redirects usam `permanent: true`, que na Vercel é **308** — e não o 301 que
o `_redirects` do Cloudflare produzia. Para um GET o efeito é o mesmo, e o 308
preserva o método.

### Variáveis de ambiente

Defina em **Project Settings > Environment Variables**. É preciso **pelo menos
um destino** — webhook ou Resend. Sem nenhum, `/api/contact` responde 503 com
uma mensagem clara ao visitante: falha visível em vez de lead perdido em silêncio.

| Variável | Para quê |
|---|---|
| `CONTACT_WEBHOOK` | URL do n8n que recebe cada lead em JSON |
| `RESEND_API_KEY` | Opcional: também envia o lead por e-mail |
| `CONTACT_TO` | Destino do e-mail (obrigatório com Resend) |
| `CONTACT_FROM` | Remetente verificado (obrigatório com Resend) |

> **A URL do webhook fica só na variável de ambiente, nunca no código.** O
> repositório é público: quem tivesse a URL poderia injetar leads falsos no n8n.
> Ela também nunca chega ao navegador — quem chama o n8n é a função, no servidor.

Mudança de variável só vale a partir do **próximo deploy**.

Se o webhook responder erro ou passar de 10 s, o visitante vê "Não foi possível
enviar agora" (502) em vez de uma confirmação falsa.


## Formulário e atribuição (UTMs)

O formulário de `/contato/` envia para `/api/contact`, que repassa o lead ao
webhook. Junto com nome, e-mail, telefone e mensagem vão os dados de origem da
visita.

O campo de telefone não existe no site de origem: o build o insere entre o
e-mail e a mensagem (regra em `CUSTOMIZACOES`, `tools/build.mjs`). É
obrigatório, com DDD — 10 ou 11 dígitos, aceitando `+55` e qualquer pontuação —
e segue ao webhook como foi digitado, no campo `phone`. `src/phone-mask.ts`
formata enquanto digita, `(11) 5687-7566` ou `(11) 98765-4321`, corta no 11.º
dígito e descarta um `+55` colado; o cursor acompanha o dígito em que estava. Sem ele o aviso no
grupo do cliente saía com "WhatsApp: (nao informado)".

**Captura.** O visitante chega pelo anúncio numa página qualquer — em geral a
home — e só depois navega até o contato, momento em que os parâmetros já sumiram
da URL. Por isso `src/attribution.ts` roda em toda página e guarda os parâmetros
na chegada (`localStorage`, validade de 30 dias).

**Modelo: último toque.** Uma nova chegada com parâmetros substitui a anterior
por inteiro — campos da campanha antiga não vazam para o lead novo. Visitas sem
parâmetros (acesso direto, navegação interna) não apagam o que já existe.

**Payload do webhook** — campos planos, para mapear direto nos nós do n8n:

| Campo | Origem |
|---|---|
| `name`, `email`, `phone`, `message` | formulário |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | URL de chegada |
| `gclid`, `fbclid` | IDs de clique do Google Ads e da Meta |
| `landing_page` | URL em que o visitante chegou com os parâmetros |
| `referrer` | site de onde veio antes da chegada |
| `captured_at` | quando os parâmetros foram capturados |
| `page_url` | página em que o formulário foi enviado |
| `received_at` | quando o servidor recebeu o lead |
| `ip`, `country` | cabeçalhos da Vercel |

Campo de atribuição ausente simplesmente não aparece no JSON. O servidor só
aceita os campos da tabela, só strings, com até 500 caracteres cada — o corpo
vem do navegador e é controlado por quem envia.

## Imagens

`npm run optimize` converte PNG/JPEG para WebP e reescreve as referências no
HTML e no CSS. O original só é apagado quando o WebP fica menor, e os ícones de
aba continuam PNG porque WebP não é aceito de forma confiável nesse contexto.

No site atual: **115 MB → 18 MB**, 164 arquivos convertidos.

## Lightbox dos certificados

`src/lightbox.ts` abre o certificado em tela cheia, com "X" no canto superior
direito, setas, ESC, clique no fundo, foco preso no diálogo e foco devolvido à
miniatura ao fechar.

Ele se ancora nos links que o próprio Elementor gera para ampliar imagem — o
mirror renomeia `data-elementor-open-lightbox` para `data-debony-lightbox`.

Os ícones de lupa são um caso à parte: o Elementor os publica como
`href="#elementor-action...settings=<base64>"`, com a URL da imagem escondida
dentro do base64. O mirror decodifica esse href, baixa a imagem e reescreve a
âncora no mesmo formato dos demais gatilhos — assim o clique funciona e a URL
vira referência de verdade, visível para o conversor de WebP e o check-links.
Consequência prática: **certificado novo publicado no site de origem entra no
lightbox sozinho**, sem editar código.

`tools/test-lightbox.mjs` cobre esse comportamento num Chrome real.

## Cabeçalho: fundo e contraste com a seção

O cabeçalho fixo tem fundo translúcido, e texto do menu, logo, botão e ícone do
hambúrguer alternam conforme o que está atrás dele:

| | Fundo claro | Fundo escuro |
|---|---|---|
| Fundo do cabeçalho | branco 88% | escuro 60% |
| Texto e sublinhado do menu | preto | branco |
| Logo | azul | branca |
| Botão "Entre em contato" | azul (hover: fundo azul) | branco (hover: fundo branco, texto preto) |

**Como decide** (`src/header-contrast.ts`): amostra 6 pontos ao longo da largura
do cabeçalho e, em cada um, pega a camada visível de trás — cor de fundo, imagem
de fundo, slideshow, vídeo ou mídia — atravessando overlays translúcidos. Fotos
têm a luminosidade medida nos pixels da faixa que fica atrás do cabeçalho. A
média é comparada a 0,179, a luminância em que texto branco e preto dão o mesmo
contraste pela fórmula do WCAG, com uma pequena histerese para não piscar.

Vídeo cujo quadro não dá para ler — o de `/qualidade/` é YouTube, em iframe de
outro domínio — é tratado como escuro. Camadas de fundo do Elementor são
procuradas também dentro de `.e-con-inner`, onde ficam nos containers "boxed".

Para diagnosticar no DevTools, o cabeçalho expõe `data-contraste`,
`data-luminancia` (média) e `data-pontos` (cada ponto).

O fundo substitui o `.sticky` do script original, que ia para o `<header>`
externo e não para o fixo: o fundo nunca aparecia, e o padding empurrava a
página inteira 24px ao passar de 110px de rolagem. `tools/test-cabecalho.mjs`
cobre os tipos de fundo do site, as cores, o contraste real do texto (≥ 4,5:1) e
a ausência desse salto.

## WhatsApp flutuante

`src/whatsapp.ts` adiciona em todas as páginas um botão fixo no canto inferior
direito, com o ícone de WhatsApp do próprio site. Ao passar o mouse ele abre um
painel com todos os telefones, agrupados por unidade, cada um com **Ligar**
(`tel:+55…`) e, quando atende no WhatsApp, **WhatsApp** (`wa.me`, em nova aba,
com mensagem pré-preenchida):

| Unidade             | Número         | Ligar | WhatsApp |
| ------------------- | -------------- | :---: | :------: |
| Debony · São Paulo  | (11) 5687-7566 |   ✓   |    ✓     |
| Debony · São Paulo  | (11) 5687-7381 |   ✓   |          |
| Debony · São Paulo  | (11) 5687-7382 |   ✓   |          |
| Joluma · Valinhos   | (19) 3881-3448 |   ✓   |          |

Os números são os do rodapé e da página de contato. Lá, só o (11) 5687-7566
aparece como WhatsApp, e ele atende as duas unidades. Para mudar número,
unidade ou mensagem, ou liberar o WhatsApp em outro número (`whatsapp: true`),
edite a lista `UNIDADES` no topo do arquivo e rode o build.

- **Abre** com o mouse em cima e fecha 250ms depois de sair. O painel encosta no
  botão, sem vão, então o caminho entre os dois não o fecha. No celular, onde
  não há hover, abre com um toque.
- **Clique ou toque fixa** o painel aberto e troca o ícone por um "X"; fecha com
  outro clique, com clique fora, com `Esc` ou quando o foco sai do componente.
- **Teclado**: `Enter` abre, `Tab` percorre os botões e `Esc` fecha e devolve o
  foco ao botão. Fechado, o painel fica `visibility: hidden` e sai do `Tab` e do
  leitor de tela.
- **Cores**: botão verde `#1DA851` (o `#25D366` da marca dá 2,0:1 com o ícone
  branco, abaixo dos 3:1 da WCAG para gráficos). Nos botões com texto, o verde é
  `#107C3F` (5,3:1) e o azul é o do site (8,6:1). O CSS sobrepõe o `#C36` que o
  Hello Elementor aplica em todo `button` e o link branco do kit.
- **Canto direito** porque o esquerdo é da caixa de cookies no computador. No
  celular a caixa ocupa a largura toda e cobre o botão até o visitante decidir.
- Fica abaixo do lightbox (que o cobre quando aberto) e acima do cabeçalho.

`tools/test-whatsapp.mjs` cobre tudo isso no Chrome, inclusive o toque e a
largura de 360px.

## Customizações pedidas pelo cliente

Editar `site/` à mão não resolve: o próximo `npm run mirror` rebaixa a página da
origem e o conteúdo original volta. As customizações ficam na lista
`CUSTOMIZACOES`, em `tools/build.mjs`, que roda depois do mirror.

Cada entrada troca um `padrao` por um `substituto` (vazio = remoção) e declara
um `ausente` — a marca que não pode sobrar na página. Depois de aplicar o
padrão, o build confere a marca e **falha** se ela ainda estiver lá: se o markup
mudar na origem e o padrão deixar de casar, aparece um erro em vez de o conteúdo
original reaparecer sem ninguém notar.

Em vigor:

- **`/qualidade/`** — removida a foto do meio do carrossel
  (`ESTRUTURA_JOLUMA-24-1`). O arquivo continua no mirror de propósito: a mesma
  imagem é usada em `/estrutura/`.
  - Com 2 fotos num carrossel de 3 por vez, o Swiper as alinhava à esquerda.
    A config do carrossel dessa página ganha `centerInsufficientSlides: true`,
    opção do próprio Swiper que centraliza só quando há menos slides que o
    número por vez — no celular (1 por vez) nada muda. `/estrutura/` e
    `/sobre-nos/` usam o mesmo carrossel com 5 fotos e não são tocadas.
- **Home, "Nossos produtos percorrem o mundo"** — o mapa estático
  (`Group-41-1.svg`) foi trocado por `public/assets/img/animacao-envios-brasil.gif`.
  - O GIF já traz o selo "Brasil". O selo original do Elementor é um container
    sobreposto ao mapa, escondido por CSS em `public/assets/css/app.css` para não
    duplicar. Ele é selecionado por `data-id` exato: IDs do Elementor têm tamanho
    variável.
  - Quem ativa *reduzir movimento* no sistema recebe um quadro parado
    (`animacao-envios-brasil-estatico.webp`, 19 KB) em vez da animação em loop.
  - As URLs levam `?v=<hash do conteúdo>`, porque `/assets` tem cache imutável:
    trocar o GIF em `public/` e rodar o build já fura o cache.
- **Todas as páginas, cabeçalho e rodapé** — a logo Debony | Joluma foi trocada
  pela versão com fundo transparente, `public/assets/img/logo-debony-joluma.png`.
  - O PNG é a fonte. `npm run logo` gera dele os WebP de 200, 300, 511 e 1079 px
    (com transparência) usados no `srcset`. Os WebP são versionados, e não
    gerados no build da Vercel, para o deploy não depender do binário nativo do
    `sharp` no CI.
  - A regra usa `paginas: '*'` e só troca `src`, `srcset`, `sizes` e `alt` da tag
    original. `width`, `height`, `class` e `fetchpriority` ficam como estavam,
    então layout e prioridade de carregamento do cabeçalho não mudam.
  - Para trocar a logo no futuro: substitua o PNG, rode `npm run logo` e o build.
- **`/contato/`, formulário** — campo "Seu WhatsApp ou telefone" entre o e-mail
  e a mensagem, obrigatório (2026-09-23). Mesmo markup dos campos do Elementor,
  então herda o estilo; `type="tel"` abre o teclado numérico no celular. A
  validação está em `src/contact-form.ts` (antes do envio) e em `api/contact.ts`
  (quem decide). No n8n o campo `phone` vai para a coluna TELEFONE da planilha e
  para a Pulseboard como `telefone`.
- **Todas as páginas, menu do cabeçalho** — horizontal no computador, hambúrguer
  só em telas menores.
  - O widget do Elementor estava com layout "dropdown", que gera só a lista
    vertical com o botão, em qualquer tela. O build cria a `<nav>` horizontal no
    formato que o CSS e o JS do Elementor já presentes no mirror sabem exibir,
    copiando a lista da `<nav>` vertical de cada página — os links são relativos
    e mudam com a profundidade, e item novo no menu da origem entra nas duas.
  - **Breakpoint:** horizontal a partir de **1025px**, hambúrguer até 1024px
    (breakpoint "tablet" do próprio site, em `MENU_HAMBURGUER_ATE`). Abaixo disso
    não cabem logo, seis itens e o botão numa linha. Entre 1025 e 1279px a logo e
    os itens ficam mais compactos para caber.
  - **Especificidade:** os seletores do menu em `app.css` são (0,4,1) de propósito.
    O Elementor tem `a:hover { padding: 13px 20px }` com (0,3,1); com um seletor
    mais fraco o item crescia até 24px no hover, o menu inteiro pulava e o submenu
    saía de baixo do cursor. `tools/test-menu.mjs` mede isso.
  - O submenu "Sobre nós" abre por CSS no hover e no foco do teclado. O SmartMenus
    do Elementor inicializa na `<nav>`, mas não abria no hover nem pelo Tab.


## Notas do clone

- O crawler respeita a proteção anti-flood do host de origem: sob rajada ele
  responde `200` com corpo vazio em vez de `429`, então corpo vazio é tratado
  como erro recuperável e as requisições saem espaçadas (`--interval`).
- jQuery, Elementor e demais scripts do WordPress foram mantidos, por isso o
  visual é idêntico ao original.
- Rotas de backend (`/wp-admin`, `/wp-login.php`, feeds) são redirecionadas
  para a home pelos `redirects` do `vercel.json`. `/wp-json` e `/xmlrpc.php`
  ficam de fora de propósito: não mudaram de lugar, simplesmente não existem,
  e caem no 404 natural.
- O formulário de comentários do post `2023/11/25/ola-mundo/` está desativado:
  não há backend para recebê-lo.
- O frontend do Elementor carrega um bundle por tipo de widget da página, com o
  nome montado em runtime. O crawler lê o manifesto de chunks do webpack para
  descobri-los; o que escapa disso está em `EXTRA_ASSETS`. Verificado: as 12
  páginas carregam sem nenhum 404.

## Pendências conhecidas

- O `<link rel="canonical">` de cada página ficou relativo. Se o site for
  publicado em outro domínio, vale reapontá-lo para o domínio final.
- `EXTRA_ASSETS`, em `tools/mirror.mjs`, lista bundles do Elementor com hash no
  nome. Quando o Elementor for atualizado na origem, os hashes mudam e esses
  arquivos passam a dar 404. Rode `tools/scan-404.mjs` depois de um `mirror`
  para pegar os nomes novos.
