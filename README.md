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
node tools/scan-404.mjs      http://127.0.0.1:8905
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

Sem elas, `/api/contact` responde 503 com uma mensagem clara ao visitante —
falha visível em vez de mensagem perdida em silêncio. Defina em
**Project Settings > Environment Variables**:

| Variável | Obrigatória | Para quê |
|---|---|---|
| `CONTACT_TO` | sim | Destino das mensagens |
| `CONTACT_FROM` | sim | Remetente verificado no provedor |
| `RESEND_API_KEY` | sim | Chave da API Resend |
| `CONTACT_WEBHOOK` | não | URL que recebe uma cópia em JSON |


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
