/**
 * Build do deploy: compila o TypeScript, copia os arquivos de configuração do
 * Cloudflare Pages e injeta os assets próprios nas páginas do mirror.
 *
 * Uso: node tools/build.mjs [--out site]
 */

import { build } from 'esbuild';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';

import { dirname, join, relative, resolve, sep } from 'node:path';

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
 * Workers static assets recusa código fora desta lista, e a recusa só aparece
 * na validação server-side do deploy — depois de subir todos os assets. Melhor
 * quebrar o build aqui. (O Pages aceitava 410; o Workers não.)
 */
const STATUS_PERMITIDOS = new Set([200, 301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 2100;

async function validateRedirects(file) {
  let texto;
  try {
    texto = await readFile(file, 'utf8');
  } catch {
    return; // sem _redirects não há o que validar
  }

  const problemas = [];
  let regras = 0;

  texto.split(/\r?\n/).forEach((linha, i) => {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) return;
    regras++;

    const partes = limpa.split(/\s+/);
    if (partes.length < 2) {
      problemas.push(`linha ${i + 1}: faltam origem e destino -> "${limpa}"`);
      return;
    }
    if (partes.length < 3) return; // sem código: o padrão (302) é válido

    const status = Number(partes[2]);
    if (!STATUS_PERMITIDOS.has(status)) {
      problemas.push(
        `linha ${i + 1}: status ${partes[2]} não é aceito ` +
          `(use ${[...STATUS_PERMITIDOS].join(', ')}) -> "${limpa}"`,
      );
    }
  });

  if (regras > MAX_REDIRECTS) {
    problemas.push(`${regras} regras excedem o limite de ${MAX_REDIRECTS}`);
  }

  if (problemas.length) {
    console.error(`\n_redirects inválido:`);
    for (const p of problemas) console.error(`  ${p}`);
    throw new Error('_redirects seria recusado no deploy');
  }
}

/**
 * Remoções pedidas pelo cliente, aplicadas sobre o mirror.
 *
 * Editar `site/` à mão não adianta: o próximo `npm run mirror` rebaixa a página
 * e a imagem volta. Por isso a regra mora aqui, no build, que roda depois.
 *
 * `ausente` é a trava: depois de aplicar o padrão, se a marca ainda estiver na
 * página o build falha. Assim, se o markup mudar na origem e o padrão deixar de
 * casar, aparece um erro — em vez de a imagem reaparecer sem ninguém notar.
 */
const REMOCOES = [
  {
    pagina: 'qualidade/index.html',
    motivo: 'Cliente pediu a remoção da foto do meio do carrossel (2026-09-10)',
    padrao: /\s*<div class="swiper-slide">\s*<img[^>]*ESTRUTURA_JOLUMA-24-1[^>]*>\s*<\/div>/i,
    ausente: 'ESTRUTURA_JOLUMA-24-1',
  },
];

async function aplicarRemocoes() {
  for (const { pagina, motivo, padrao, ausente } of REMOCOES) {
    const file = join(OUT_DIR, ...pagina.split('/'));
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      throw new Error(`remoção aponta para página inexistente: ${pagina}`);
    }

    const depois = html.replace(padrao, '');
    if (depois !== html) {
      await writeFile(file, depois);
      console.log(`removido de ${pagina}: ${motivo}`);
    }

    if (depois.includes(ausente)) {
      throw new Error(
        `"${ausente}" ainda aparece em ${pagina}. ` +
          `O markup da origem provavelmente mudou e o padrão da remoção não casa mais.`,
      );
    }
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

  // 2. _headers, _redirects e CSS próprio para a raiz do output.
  await cp('public', OUT_DIR, { recursive: true });
  await validateRedirects(join(OUT_DIR, '_redirects'));

  // 3. Remoções pedidas pelo cliente, antes de injetar os assets.
  await aplicarRemocoes();

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
