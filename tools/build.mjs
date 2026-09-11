/**
 * Build do deploy: compila o TypeScript, copia os assets próprios e aplica as
 * customizações nas páginas do mirror. Rotas e cabeçalhos vivem no vercel.json.
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

  // 2. CSS próprio para a raiz do output; rotas e cabeçalhos vêm do vercel.json.
  await cp('public', OUT_DIR, { recursive: true });
  await validateVercelConfig('vercel.json');

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
