/**
 * Build do deploy: compila o TypeScript, copia os assets próprios e aplica as
 * customizações nas páginas do mirror. Rotas e cabeçalhos vivem no vercel.json.
 *
 * Uso: node tools/build.mjs [--out site]
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';

import { dirname, join, posix, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT_DIR = resolve(outIndex !== -1 && args[outIndex + 1] ? args[outIndex + 1] : 'site');

const MARKER = 'debony-app';

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Caminho relativo, em barras, de um arquivo HTML até um asset do mirror. */
function relFromPage(pageFile, assetFile) {
  let rel = relative(dirname(pageFile), assetFile).split(sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/**
 * Um vercel.json malformado só reprova no build da Vercel, depois do push.
 * Conferir aqui troca esse ciclo por um erro imediato.
 */
async function validateVercelConfig(file) {
  let texto;
  try {
    texto = await readFile(file, 'utf8');
  } catch {
    throw new Error('vercel.json não encontrado na raiz do projeto');
  }

  let cfg;
  try {
    cfg = JSON.parse(texto);
  } catch (err) {
    throw new Error(`vercel.json não é JSON válido: ${err.message}`);
  }

  const problemas = [];

  if (cfg.outputDirectory !== 'site') {
    problemas.push(`outputDirectory deveria ser "site", está "${cfg.outputDirectory}"`);
  }

  for (const [i, r] of (cfg.redirects ?? []).entries()) {
    if (!r?.source || !r?.destination) {
      problemas.push(`redirects[${i}]: precisa de "source" e "destination"`);
    }
    if (r?.permanent === undefined && r?.statusCode === undefined) {
      problemas.push(`redirects[${i}]: defina "permanent" ou "statusCode"`);
    }
  }

  for (const [i, h] of (cfg.headers ?? []).entries()) {
    if (!h?.source) problemas.push(`headers[${i}]: precisa de "source"`);
    if (!Array.isArray(h?.headers) || h.headers.length === 0) {
      problemas.push(`headers[${i}]: "headers" precisa ser uma lista não vazia`);
      continue;
    }
    for (const [j, kv] of h.headers.entries()) {
      if (!kv?.key || kv?.value === undefined) {
        problemas.push(`headers[${i}].headers[${j}]: precisa de "key" e "value"`);
      }
    }
  }

  if (problemas.length) {
    console.error('\nvercel.json inválido:');
    for (const p of problemas) console.error(`  ${p}`);
    throw new Error('vercel.json seria recusado no deploy');
  }
}

/** Versão curta pelo conteúdo, para furar o cache imutável de /assets quando o arquivo muda. */
function versao(caminhoEmPublic) {
  const conteudo = readFileSync(join('public', ...caminhoEmPublic.split('/')));
  return createHash('sha256').update(conteudo).digest('hex').slice(0, 8);
}

/** Troca só os atributos pedidos numa tag, preservando o resto (class, width, fetchpriority...). */
function comAtributos(tag, atributos) {
  let saida = tag;
  for (const [nome, valor] of Object.entries(atributos)) {
    // Barra dupla obrigatória: em qualquer string JS (aspas ou crase) "\s" vira só
    // "s". O regex deixaria de casar e o atributo novo seria acrescentado ao lado do
    // antigo, duplicando src/srcset na tag.
    const re = new RegExp('\\s' + nome + '="[^"]*"', 'i');
    const novo = valor === null ? '' : ` ${nome}="${valor}"`;
    saida = re.test(saida) ? saida.replace(re, novo) : saida.replace(/\s*\/?>$/, `${novo}$&`);
  }
  return saida;
}

/**
 * Customizações pedidas pelo cliente, aplicadas sobre o mirror.
 *
 * Editar `site/` à mão não adianta: o próximo `npm run mirror` rebaixa as páginas
 * e o conteúdo original volta. Por isso as regras moram aqui, no build.
 *
 * Cada entrada troca `padrao` por `substituto` (vazio = remoção) nas `paginas`
 * listadas, ou em todas com '*'. `substituto` pode ser uma função, chamada a cada
 * ocorrência com a tag encontrada e com `rel()` — que devolve o caminho relativo
 * até um arquivo de `site/` a partir da página atual, já que as páginas ficam em
 * profundidades diferentes.
 *
 * `ausente` é a trava: depois de aplicar o padrão, se a marca ainda estiver na
 * página o build falha. Assim, se o markup mudar na origem e o padrão deixar de
 * casar, aparece um erro — em vez de o conteúdo original reaparecer sem ninguém
 * notar.
 */
const CUSTOMIZACOES = [
  {
    paginas: ['qualidade/index.html'],
    motivo: 'Cliente pediu a remoção da foto do meio do carrossel (2026-09-10)',
    padrao: /\s*<div class="swiper-slide">\s*<img[^>]*ESTRUTURA_JOLUMA-24-1[^>]*>\s*<\/div>/i,
    ausente: 'ESTRUTURA_JOLUMA-24-1',
  },
  {
    paginas: ['index.html'],
    motivo: 'Mapa estático de "Nossos produtos percorrem o mundo" trocado pelo GIF animado (2026-09-15)',
    // Casa também o <picture> que este build gerou antes: assim um GIF novo
    // em public/ troca o ?v= mesmo quando a página já foi customizada.
    padrao:
      /<img\b[^>]*Group-41-1\.svg[^>]*>|<picture data-debony="mapa-envios">[\s\S]*?<\/picture>/i,
    ausente: 'Group-41-1.svg',
    substituto: (_tag, { rel }) => {
      const gif = 'assets/img/animacao-envios-brasil.gif';
      const estatico = 'assets/img/animacao-envios-brasil-estatico.webp';
      return (
        '<picture data-debony="mapa-envios">' +
        // Animação em loop contínuo: quem pede menos movimento recebe um quadro parado.
        `<source media="(prefers-reduced-motion: reduce)" srcset="${rel(estatico)}?v=${versao(estatico)}" type="image/webp">` +
        `<img loading="lazy" decoding="async" width="1045" height="636" ` +
        `src="${rel(gif)}?v=${versao(gif)}" class="attachment-large size-large" ` +
        `alt="Mapa com envios a partir do Brasil para as Américas, Europa, África e Ásia">` +
        '</picture>'
      );
    },
  },
  {
    paginas: '*',
    motivo: 'Logo Debony | Joluma trocada pela versão com fundo transparente (2026-09-16)',
    // Cabeçalho e rodapé. Casa também a tag já customizada, para atualizar o ?v=.
    padrao: /<img\b[^>]*(?:FAV-ICON-e1718635038380|data-debony="logo")[^>]*>/gi,
    ausente: 'FAV-ICON-e1718635038380',
    substituto: (tag, { rel }) => {
      const arquivo = (largura) => {
        const caminho = `assets/img/logo-debony-joluma-${largura}.webp`;
        return `${rel(caminho)}?v=${versao(caminho)}`;
      };
      // Só a imagem muda: width, height, class e fetchpriority da tag original
      // ficam, então o layout e a prioridade de carregamento do cabeçalho são mantidos.
      return comAtributos(tag, {
        src: arquivo(511),
        srcset: [200, 300, 511, 1079].map((w) => `${arquivo(w)} ${w}w`).join(', '),
        sizes: '(max-width: 511px) 100vw, 511px',
        alt: 'Debony e Joluma - Usinagem de precisão',
        'data-debony': 'logo',
      });
    },
  },
  {
    paginas: '*',
    motivo: 'Menu do cabeçalho horizontal no computador; hambúrguer só em telas menores (2026-09-16)',
    // Do widget do menu até o fim da <nav> vertical. Fica fora da regex o que vem
    // depois, então a <nav> horizontal gerada antes é recriada a cada build.
    padrao:
      /<div class="[^"]*elementor-element-265527d[^"]*"[^>]*>[\s\S]*?<nav class="elementor-nav-menu--dropdown[^"]*"[^>]*>[\s\S]*?<\/nav>/,
    presente: 'data-debony="menu-horizontal"',
    substituto: (bloco) => montarMenuHorizontal(bloco),
  },
];

/**
 * Até qual breakpoint do Elementor o menu fica no hambúrguer. Acima dele, horizontal.
 * 'tablet' = hambúrguer até 1024px. Ver a nota no README sobre a escolha.
 */
const MENU_HAMBURGUER_ATE = 'tablet';

/**
 * O widget de menu estava com layout "dropdown": o Elementor gera só a lista
 * vertical com o botão, em qualquer tela. O layout horizontal usa uma segunda
 * <nav class="elementor-nav-menu--main">, que o CSS e o JS do Elementor já
 * presentes no mirror sabem exibir, alternar por breakpoint e animar.
 *
 * A lista é copiada da <nav> vertical da própria página, e não escrita aqui: os
 * links são relativos e mudam com a profundidade de cada página, e um item novo
 * no menu da origem entra nas duas versões sozinho.
 */
function montarMenuHorizontal(bloco) {
  const semAnterior = bloco.replace(/<nav data-debony="menu-horizontal"[\s\S]*?<\/nav>/, '');

  // Tag do widget: classe de breakpoint e layout horizontal, lido pelo handler JS.
  const comWidget = semAnterior.replace(/^<div\b[^>]*>/, (abertura) =>
    abertura
      // Trabalha na lista de classes, e não no texto: depois do primeiro build a
      // classe fica logo após class=" (sem espaço antes), e um regex que exigisse
      // espaço não a removeria — cada build acrescentaria mais uma cópia.
      .replace(/class="([^"]*)"/, (_m, classes) => {
        const resto = classes.split(/\s+/).filter((c) => c && !c.startsWith('elementor-nav-menu--dropdown-'));
        return `class="${[`elementor-nav-menu--dropdown-${MENU_HAMBURGUER_ATE}`, ...resto].join(' ')}"`;
      })
      // data-settings é JSON escapado com entidades HTML.
      .replace('&quot;layout&quot;:&quot;dropdown&quot;', '&quot;layout&quot;:&quot;horizontal&quot;'),
  );

  const lista = /<nav class="elementor-nav-menu--dropdown[^"]*"[^>]*>\s*(<ul\b[\s\S]*<\/ul>)\s*<\/nav>/.exec(comWidget)?.[1];
  if (!lista) throw new Error('menu horizontal: lista de itens não encontrada na <nav> vertical');

  const listaHorizontal = lista
    // Ids não podem repetir entre as duas listas.
    .replace(/\sid="([^"]+)"/g, (_m, id) => ` id="${id}-horizontal"`)
    // A lista vertical fica escondida no computador e por isso tira os links do
    // Tab. A horizontal é a visível: precisa ser navegável pelo teclado.
    .replace(/\stabindex="-1"/g, '');

  const nav =
    '<nav data-debony="menu-horizontal" aria-label="Menu principal" ' +
    'class="elementor-nav-menu--main elementor-nav-menu__container elementor-nav-menu--layout-horizontal e--pointer-underline e--animation-fade">' +
    listaHorizontal +
    '</nav>';

  // Antes do botão, na mesma posição em que o Elementor põe a <nav> horizontal.
  return comWidget.replace('<div class="elementor-menu-toggle"', (botao) => nav + botao);
}

async function aplicarCustomizacoes() {
  const todas = (await walk(OUT_DIR))
    .filter((f) => f.endsWith('.html'))
    .map((f) => relative(OUT_DIR, f).split(sep).join('/'));

  for (const { paginas, motivo, padrao, ausente, presente, substituto } of CUSTOMIZACOES) {
    const alvo = paginas === '*' ? todas : paginas;
    let alteradas = 0;

    for (const pagina of alvo) {
      const file = join(OUT_DIR, ...pagina.split('/'));
      let html;
      try {
        html = await readFile(file, 'utf8');
      } catch {
        throw new Error(`customização aponta para página inexistente: ${pagina}`);
      }

      const pastaDaPagina = posix.dirname(pagina);
      const rel = (caminhoEmSite) => {
        const r = posix.relative(pastaDaPagina, caminhoEmSite);
        return r.startsWith('.') ? r : `./${r}`;
      };

      const depois = html.replace(padrao, (tag) =>
        typeof substituto === 'function' ? substituto(tag, { rel }) : (substituto ?? ''),
      );

      // Travas antes de gravar: uma regra que falha não pode deixar a página
      // pela metade em disco.
      if (ausente && depois.includes(ausente)) {
        throw new Error(
          `"${ausente}" ainda aparece em ${pagina}. ` +
            `O markup da origem provavelmente mudou e o padrão da customização não casa mais.`,
        );
      }
      if (presente && !depois.includes(presente)) {
        throw new Error(
          `"${presente}" não aparece em ${pagina}. ` +
            `O padrão da customização não casou — o markup da origem provavelmente mudou.`,
        );
      }

      if (depois !== html) {
        await writeFile(file, depois);
        alteradas++;
      }
    }

    if (alteradas) console.log(`${motivo} — ${alteradas} página(s)`);
  }
}

async function main() {
  // 1. TypeScript -> bundle único, sem dependências externas.
  const result = await build({
    entryPoints: ['src/main.ts'],
    outfile: join(OUT_DIR, 'assets', 'js', 'app.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2019'],
    sourcemap: true,
    logLevel: 'warning',
    metafile: true,
  });
  const bundleBytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);

  // 2. CSS próprio para a raiz do output; rotas e cabeçalhos vêm do vercel.json.
  await cp('public', OUT_DIR, { recursive: true });
  await validateVercelConfig('vercel.json');

  // 3. Customizações pedidas pelo cliente, antes de injetar os assets.
  await aplicarCustomizacoes();

  // 4. Injeta os assets próprios em cada página.
  const pages = (await walk(OUT_DIR)).filter((f) => f.endsWith('.html'));
  const jsFile = join(OUT_DIR, 'assets', 'js', 'app.js');
  const cssFile = join(OUT_DIR, 'assets', 'css', 'app.css');
  let injected = 0;

  for (const page of pages) {
    let html = await readFile(page, 'utf8');
    if (html.includes(MARKER)) continue; // idempotente: build repetido não duplica

    const css = `<link rel="stylesheet" id="${MARKER}-css" href="${relFromPage(page, cssFile)}">`;
    const js = `<script id="${MARKER}-js" src="${relFromPage(page, jsFile)}" defer></script>`;

    html = html.includes('</head>')
      ? html.replace('</head>', `${css}\n</head>`)
      : `${css}\n${html}`;
    html = html.includes('</body>')
      ? html.replace('</body>', `${js}\n</body>`)
      : `${html}\n${js}`;

    await writeFile(page, html);
    injected++;
  }

  console.log(`bundle: ${(bundleBytes / 1024).toFixed(1)} kB`);
  console.log(`páginas com assets injetados: ${injected}/${pages.length}`);
  console.log(`output: ${relative(process.cwd(), OUT_DIR) || '.'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
