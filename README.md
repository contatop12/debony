# Debony — clone estático

Clone fiel de `debonyusinagem.com.br` (WordPress + Elementor) para deploy no
Cloudflare Workers com static assets. O HTML, o CSS e as imagens são os do site original, com todas
as URLs reescritas para caminhos relativos. O que era backend PHP foi
substituído por TypeScript: um bundle no cliente e uma Pages Function.

## Estrutura

| Caminho | O que é |
|---|---|
| `site/` | Output do deploy (gerado — não editar à mão) |
| `src/` | TypeScript do cliente, compilado para `site/assets/js/app.js` |
| `worker/index.ts` | Worker: serve os assets e responde `/api/contact` |
| `public/` | `_headers`, `_redirects` e CSS próprio, copiados para `site/` no build |
| `wrangler.jsonc` | Config do Worker (nome, assets, roteamento) |
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

## Deploy no Cloudflare Workers

O projeto é um **Worker com static assets**, não um projeto Pages. O binding
`ASSETS` serve `site/`, e `run_worker_first: ["/api/*"]` faz só a API entrar no
código do Worker — o resto é servido direto pelo Asset Worker.

Configuração no painel (Workers Builds):

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** raiz do repo

O `wrangler.jsonc` carrega o resto. O Workers Builds injeta as credenciais
sozinho — não precisa de `CLOUDFLARE_API_TOKEN` nem de `CLOUDFLARE_ACCOUNT_ID`.

> O campo `name` do `wrangler.jsonc` precisa bater **exatamente** com o nome do
> Worker no painel; é por ele que o deploy encontra o destino.

Uma diferença em relação ao Pages: `_redirects` só aceita os status **200,
301, 302, 303, 307 e 308**. O `410 Gone` que o Pages aceitava é recusado na
validação do deploy — e ela roda no servidor, *depois* de subir todos os
assets. Por isso `npm run build` valida o arquivo antes, e falha localmente.

`_headers` e `_redirects` continuam valendo: Workers static assets lê os dois a
partir do diretório de assets, e o build já os copia de `public/` para `site/`.
Eles não se aplicam ao que o Worker responde, mas isso não afeta nada aqui —
só `/api/*` passa pelo Worker, e essa resposta já define `Cache-Control` própria.

Depois de mudar o `wrangler.jsonc`, rode `npm run types` para regenerar
`worker-configuration.d.ts`.

### Segredos do formulário

Sem eles, `/api/contact` responde 503 com uma mensagem clara ao visitante —
falha visível em vez de mensagem perdida em silêncio. Defina em
**Settings > Variables and Secrets** (ou `wrangler secret put`):

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
