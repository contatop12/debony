# Debony — clone estático

Clone fiel de `debonyusinagem.com.br` (WordPress + Elementor) para deploy no
Cloudflare Pages. O HTML, o CSS e as imagens são os do site original, com todas
as URLs reescritas para caminhos relativos. O que era backend PHP foi
substituído por TypeScript: um bundle no cliente e uma Pages Function.

## Estrutura

| Caminho | O que é |
|---|---|
| `site/` | Output do deploy (gerado — não editar à mão) |
| `src/` | TypeScript do cliente, compilado para `site/assets/js/app.js` |
| `functions/api/contact.ts` | Pages Function que recebe o formulário de contato |
| `public/` | `_headers`, `_redirects` e CSS próprio, copiados para `site/` no build |
| `tools/` | Crawler do mirror, conversor de imagens, build e verificadores |

## Comandos

```bash
npm install

npm run mirror     # rebaixa o site de origem para site/ (resume o que já existe)
npm run optimize   # converte PNG/JPEG para WebP e reescreve as referências
npm run build      # compila o TS, copia public/ e injeta os assets nas páginas
npm run verify     # typecheck + confere se toda referência relativa existe
npm run release    # mirror + optimize + build + verify, na ordem
npm run dev        # wrangler pages dev site
npm run deploy     # wrangler pages deploy site --project-name debony
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

## Deploy no Cloudflare Pages

Pelo painel, conectando o repositório:

- **Build command:** `npm run build`
- **Build output directory:** `site`
- **Root directory:** raiz do repo
- **Deploy command:** `npx wrangler pages deploy site`

O `wrangler.toml` já declara `pages_build_output_dir = "site"`, e as Functions
em `functions/` são detectadas automaticamente.

> **Não use `npx wrangler deploy`.** Esse é o comando de Workers: ele ignora
> `pages_build_output_dir` e falha com *"Missing entry-point to Worker script
> or to assets directory"*. Pages usa `wrangler pages deploy`.

Dois pré-requisitos desse deploy command:

1. O campo `name` do `wrangler.toml` precisa bater **exatamente** com o nome do
   projeto no painel. É de lá que o wrangler descobre onde publicar.
2. `wrangler pages deploy` faz um *direct upload*, que é um modo diferente do
   git-integrated. Ele exige `CLOUDFLARE_API_TOKEN` (permissão *Cloudflare
   Pages: Edit*) e `CLOUDFLARE_ACCOUNT_ID` nas variáveis de ambiente do build.

Alternativa mais simples: deixar o **Deploy command vazio**. Com integração
git, o Pages publica o output directory sozinho, sem token e sem wrangler.

### Segredos do formulário

Sem eles, `/api/contact` responde 503 com uma mensagem clara ao visitante —
falha visível em vez de mensagem perdida em silêncio. Defina em
**Settings > Environment variables** (ou `wrangler pages secret put`):

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
Consequência prática: **certificado novo publicado no site de origem entra no
lightbox sozinho**, sem editar código.

`tools/test-lightbox.mjs` cobre esse comportamento num Chrome real.

## Notas do clone

- O crawler respeita a proteção anti-flood do host de origem: sob rajada ele
  responde `200` com corpo vazio em vez de `429`, então corpo vazio é tratado
  como erro recuperável e as requisições saem espaçadas (`--interval`).
- jQuery, Elementor e demais scripts do WordPress foram mantidos, por isso o
  visual é idêntico ao original.
- Rotas de backend (`/wp-admin`, `/wp-json`, `/xmlrpc.php`, feeds) são
  redirecionadas ou respondem 410 via `_redirects`.
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
