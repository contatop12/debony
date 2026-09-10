/**
 * Mirror estático de https://debonyusinagem.com.br
 *
 * Baixa páginas HTML, CSS, JS, imagens e fontes, e reescreve todas as URLs
 * absolutas do domínio para caminhos relativos, de forma que o resultado
 * funcione abrindo os arquivos direto do disco ou em qualquer host estático.
 *
 * Uso: node tools/mirror.mjs [--out site] [--concurrency 8]
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';

const ORIGIN = 'https://debonyusinagem.com.br';
const HOSTS = new Set(['debonyusinagem.com.br', 'www.debonyusinagem.com.br']);

const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT_DIR = argVal('out', 'site');
const CONCURRENCY = Number(argVal('concurrency', 3));
const REQ_INTERVAL_MS = Number(argVal('interval', 250));

const SEEDS = [
  '/',
  '/sobre-nos/',
  '/servicos/',
  '/estrutura/',
  '/qualidade/',
  '/certificados/',
  '/responsabilidade-social/',
  '/contato/',
  '/politicas-de-privacidade/',
  '/termos-de-uso/',
  '/2023/11/25/ola-mundo/',
];

/**
 * Assets que o frontend do Elementor pede em runtime, por config própria. Não
 * aparecem em nenhum atributo do HTML, então o crawler nunca chegaria neles
 * pelos links — sem isso o console enche de 404.
 *
 * Os nomes com hash mudam quando o Elementor é atualizado na origem. Se voltar
 * 404 no console depois de um `npm run mirror`, pegue o nome novo no DevTools
 * (aba Network) e atualize esta lista.
 */
const EXTRA_ASSETS = [
  '/wp-content/plugins/elementor/assets/css/conditionals/dialog.min.css',
  '/wp-content/uploads/elementor/css/custom-lightbox.min.css',
  '/wp-content/plugins/elementor/assets/lib/dialog/dialog.min.js',
  '/wp-content/plugins/elementor/assets/lib/share-link/share-link.min.js',
  // Chunks que o manifesto não expõe no formato `nome.hash` (um é chunk sem
  // nome), então a descoberta automática abaixo não os alcança.
  '/wp-content/plugins/elementor/assets/js/lightbox.3f9b3a051b2336dd5372.bundle.min.js',
  '/wp-content/plugins/elementor/assets/js/397f2d183c19202777d6.bundle.min.js',
  '/wp-content/plugins/elementor/assets/js/shared-frontend-handlers.03caa53373b56d3bab67.bundle.min.js',
  '/wp-content/plugins/elementor/assets/js/text-editor.45609661e409413f1cef.bundle.min.js',
  '/wp-content/plugins/pro-elements/assets/js/nav-menu.dc8790fd04afa5b6c0a3.bundle.min.js',
  '/wp-content/plugins/elementor/assets/js/image-carousel.6167d20b95b33386757b.bundle.min.js',
  '/wp-content/plugins/elementor/assets/js/toggle.2a177a3ef4785d3dfbc5.bundle.min.js',
  '/wp-content/plugins/elementor/assets/js/video.86d44e46e43d0807e708.bundle.min.js',
  '/wp-content/plugins/pro-elements/assets/js/form.cfd61a9174be80f835c6.bundle.min.js',
  '/wp-content/plugins/pro-elements/assets/js/popup.61d4fcab8891b2e07802.bundle.min.js',
];

/**
 * O Elementor carrega um bundle por tipo de widget presente na página, com o
 * nome montado em runtime a partir do manifesto de chunks do webpack embutido
 * no próprio JS: `{"text-editor":"45609661e409413f1cef", ...}`. Nenhum desses
 * nomes aparece no HTML, então lemos o manifesto e derivamos as URLs.
 */
const CHUNK_MANIFEST_RE = /["']?([A-Za-z0-9_$-]+)["']?\s*:\s*["']([0-9a-f]{20})["']/g;

// Caminhos que não fazem parte do site público estático.
const SKIP_PATH =
  /^\/(wp-admin|wp-login|wp-json|xmlrpc\.php|wp-comments-post\.php|feed|comments\/feed)|\/feed\/?$/i;

const HTML_EXT = /\.(html?|php)$/i;
const ASSET_EXT =
  /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|txt|xml|map)$/i;

/** @type {Map<string, string>} url absoluta normalizada -> caminho local posix */
const localPath = new Map();
/** @type {Map<string, string>} url -> conteúdo texto (páginas e css, para reescrever) */
const textBodies = new Map();
/** @type {Set<string>} */
const pageUrls = new Set();
/** @type {Set<string>} */
const cssUrls = new Set();
/** @type {Set<string>} tentativas, para não repetir download */
const attemptedAssets = new Set();
/** @type {Set<string>} só o que gravou em disco: o resto não pode ser reescrito */
const downloadedAssets = new Set();
/** @type {Set<string>} URLs de diretório (assets_url do Elementor), não são arquivos */
const dirBases = new Set();
/** @type {string[]} */
const failures = [];

let downloadedBytes = 0;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * `content=` de <meta> carrega texto livre (descrição, generator, título).
 * Sem este filtro, esse texto vira "URL relativa" e o crawler cria páginas fantasma.
 */
function looksLikeUrl(value) {
  if (/[\s<>]/.test(value)) return false;
  if (/^(https?:)?\/\//i.test(value)) return true;
  if (/^\.{0,2}\//.test(value)) return true;
  return ASSET_EXT.test(value.split('?')[0]) || HTML_EXT.test(value.split('?')[0]);
}

function normalize(raw, base) {
  if (!raw) return null;
  const value = raw.trim().replace(/&amp;/g, '&');
  if (!value || value.startsWith('#')) return null;
  if (/^(data|mailto|tel|javascript|blob|whatsapp|sms):/i.test(value)) return null;
  if (!looksLikeUrl(value)) return null;

  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (!HOSTS.has(url.hostname)) return null;

  url.hash = '';
  url.hostname = 'debonyusinagem.com.br';
  url.protocol = 'https:';
  return url;
}

/**
 * O Elementor publica caminhos de diretório na config JS
 * (`"assets_url":".../elementor/assets/"`) e concatena o resto em runtime.
 * Tratar isso como página vira `assets/index.html` e o script passa a pedir
 * `assets/index.htmllib/swiper/...`. Não é arquivo: não se baixa, só se
 * reescreve como diretório.
 */
function isDirectoryBase(url) {
  const p = url.pathname;
  if (!/^\/wp-(content|includes)\//i.test(p)) return false;
  return p.endsWith('/') || !/\.[a-z0-9]{2,5}$/i.test(p);
}

function isHtmlUrl(url) {
  const p = url.pathname;
  // Nada em wp-content/wp-includes é página; evita virar diretório fantasma
  // quando a extensão não é reconhecida.
  if (/^\/wp-(content|includes)\//i.test(p)) return false;
  if (ASSET_EXT.test(p) && !HTML_EXT.test(p)) return false;
  return true;
}

/** Mapeia uma URL do site para o caminho local (posix, relativo à raiz do mirror). */
function toLocalPath(url) {
  const key = url.href;
  const cached = localPath.get(key);
  if (cached) return cached;

  let p = decodeURIComponent(url.pathname);
  p = p.replace(/\/{2,}/g, '/');

  let out;
  if (ASSET_EXT.test(p) && !HTML_EXT.test(p)) {
    // Assets mantêm o caminho original; a query (?ver=x) é descartada.
    out = p.replace(/^\//, '');
  } else if (HTML_EXT.test(p)) {
    out = p.replace(/^\//, '');
  } else {
    // Página "bonita": /sobre-nos/ -> sobre-nos/index.html
    out = posix.join(p.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
    if (out === 'index.html' || out === '/index.html') out = 'index.html';
  }

  out = out.split('/').map(sanitizeSegment).join('/');
  localPath.set(key, out);
  return out;
}

function sanitizeSegment(seg) {
  return seg.replace(/[<>:"|?*\\]/g, '_').replace(/\s+/g, '-');
}

/** Caminho relativo de `fromLocal` (arquivo) para `toLocal` (arquivo). */
function relativeFrom(fromLocal, toLocal) {
  const fromDir = posix.dirname(fromLocal);
  let rel = posix.relative(fromDir, toLocal);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O host aplica proteção anti-flood: sob rajada ele responde 200 com corpo
 * vazio em vez de 429. Por isso serializamos com intervalo mínimo entre
 * requisições e tratamos corpo vazio como erro recuperável.
 */
let nextSlot = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + REQ_INTERVAL_MS;
  if (wait) await sleep(wait);
}

async function fetchWithRetry(url, { binary = false, tries = 5 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await rateLimit();
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        redirect: 'follow',
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        // 4xx é definitivo: repetir só gasta a cota anti-flood.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) err.fatal = true;
        throw err;
      }

      const payload = binary
        ? Buffer.from(await res.arrayBuffer())
        : await res.text();
      const size = binary ? payload.length : Buffer.byteLength(payload);
      if (size === 0) throw new Error('corpo vazio (anti-flood)');

      downloadedBytes += size;
      return payload;
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      if (attempt < tries) {
        const backoff = /vazio|429|503/.test(err.message) ? 8000 * attempt : 500 * attempt;
        process.stdout.write(`  retry ${attempt}/${tries} (${err.message}) ${url}\n`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

async function alreadyOnDisk(localRelPath) {
  try {
    const s = await stat(join(OUT_DIR, localRelPath.split('/').join(sep)));
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function save(localRelPath, data) {
  const full = join(OUT_DIR, localRelPath.split('/').join(sep));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
}

// ---------------------------------------------------------------------------
// Extração de URLs
// ---------------------------------------------------------------------------

const ATTR_RE =
  /\b(?:href|src|data-src|data-lazy-src|data-large_image|data-bg|poster|action|content)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const SRCSET_RE = /\b(?:srcset|data-srcset|imagesrcset)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)')/gi;
// Elementor/WP embutem JSON com barras escapadas em atributos data-*.
/*
 * O `&` precisa estar fora da classe de caracteres.
 *
 * Num data-settings do Elementor o JSON vem com entidades HTML, e `&quot;` é
 * texto literal — não contém aspas. Sem excluir o `&`, o match atravessa o
 * `&quot;` que fecha a URL, engole `},{"id":...,"url":"https:` e só para no
 * `\` seguinte. Como matches de regex não se sobrepõem, a URL seguinte da
 * galeria já foi consumida e nunca é descoberta: a primeira imagem de cada
 * slideshow vinha, as demais sumiam.
 */
const ESCAPED_URL_RE =
  /https?:\\\/\\\/(?:www\.)?debonyusinagem\.com\.br[^"'\s\\&]*(?:\\\/[^"'\s\\&]*)*/gi;
const PLAIN_URL_RE = /https?:\/\/(?:www\.)?debonyusinagem\.com\.br[^\s"'()<>\\&]*/gi;

function unescapeSlashes(s) {
  return s.replace(/\\\//g, '/');
}

/**
 * O ícone de lupa do Elementor não é um link comum: o href é
 * `#elementor-action%3A...%26settings%3D<base64>`, e a URL da imagem vive
 * dentro desse base64. Nenhuma varredura por texto a encontra, então a imagem
 * nunca era baixada e o clique não abria nada.
 */
const ACTION_HASH_RE = /#elementor-action[^"'\s]*/gi;

function decodeActionHash(hash) {
  try {
    const found = /settings=([A-Za-z0-9+/=_-]+)/.exec(decodeURIComponent(hash));
    if (!found) return null;
    const b64 = found[1];
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    const settings = JSON.parse(json);
    return typeof settings?.url === 'string' ? settings : null;
  } catch {
    return null;
  }
}

/**
 * O Elementor guarda JSON com entidades HTML dentro de atributos data-*.
 * Um match cru de URL engoliria `...jpg&quot;},{&quot;id&quot;:597,...`,
 * então cortamos na primeira entidade de aspas/sinal.
 */
function trimEntityTail(value) {
  const at = value.search(/&(?:quot|apos|gt|lt|#0?3[49]|#x2[27]);/i);
  const cut = at === -1 ? value : value.slice(0, at);
  // Vírgula/ponto final vêm de listas (srcset, image-set) e não fazem parte da URL.
  return cut.replace(/[,;.)\]]+$/, '');
}

/** Devolve o conjunto de strings-URL cruas encontradas no documento. */
function extractRawUrls(text, isCss) {
  const found = new Set();
  const push = (v) => {
    const clean = trimEntityTail((v ?? '').trim());
    if (clean) found.add(clean);
  };

  if (!isCss) {
    for (const m of text.matchAll(ATTR_RE)) push(m[2] ?? m[3]);
    for (const m of text.matchAll(SRCSET_RE)) {
      const set = m[2] ?? m[3] ?? '';
      for (const part of set.split(',')) push(part.trim().split(/\s+/)[0]);
    }
    for (const m of text.matchAll(ESCAPED_URL_RE)) push(m[0]);
    for (const m of text.matchAll(ACTION_HASH_RE)) {
      const settings = decodeActionHash(m[0]);
      if (settings) push(settings.url);
    }
  }
  for (const m of text.matchAll(CSS_URL_RE)) push(m[1] ?? m[2] ?? m[3]);
  for (const m of text.matchAll(CSS_IMPORT_RE)) push(m[1] ?? m[2]);
  for (const m of text.matchAll(PLAIN_URL_RE)) push(m[0]);

  return found;
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

const assetQueue = new Set();

async function crawlPages() {
  const queue = SEEDS.map((s) => new URL(s, ORIGIN).href);
  const seen = new Set();

  while (queue.length) {
    const href = queue.shift();
    if (seen.has(href)) continue;
    seen.add(href);

    const url = new URL(href);
    if (SKIP_PATH.test(url.pathname)) continue;

    process.stdout.write(`page  ${url.pathname}\n`);
    let html;
    try {
      html = await fetchWithRetry(href);
    } catch (err) {
      failures.push(`${href} :: ${err.message}`);
      continue;
    }

    pageUrls.add(href);
    textBodies.set(href, html);

    for (const raw of extractRawUrls(html, false)) {
      const target = normalize(unescapeSlashes(raw), href);
      if (!target) continue;
      if (SKIP_PATH.test(target.pathname)) continue;

      if (isDirectoryBase(target)) {
        dirBases.add(stripQuery(target));
      } else if (isHtmlUrl(target)) {
        if (!sanePagePath(target.pathname)) continue;
        const canonical = canonicalPage(target);
        if (!seen.has(canonical)) queue.push(canonical);
      } else {
        assetQueue.add(stripQuery(target));
      }
    }
  }
}

/**
 * Rede de segurança contra vazamento do parser: slug gigante ou aninhamento
 * absurdo estouraria o limite de caminho do Windows.
 */
function sanePagePath(pathname) {
  const segs = decodeURIComponent(pathname).split('/').filter(Boolean);
  return segs.length <= 6 && segs.every((s) => s.length <= 80);
}

/** Páginas: descarta query e normaliza barra final. */
function canonicalPage(url) {
  const u = new URL(url.href);
  u.search = '';
  if (!HTML_EXT.test(u.pathname) && !u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

function stripQuery(url) {
  const u = new URL(url.href);
  u.search = '';
  return u.href;
}

async function downloadAssets() {
  // CSS primeiro, pois gera novas dependências (fontes, imagens de fundo).
  let pending = [...assetQueue];
  let round = 0;

  while (pending.length && round < 6) {
    round++;
    const css = pending.filter((u) => /\.css$/i.test(new URL(u).pathname));
    const rest = pending.filter((u) => !/\.css$/i.test(new URL(u).pathname));

    await runPool(css, async (href) => {
      if (cssUrls.has(href)) return;
      try {
        const text = await fetchWithRetry(href);
        cssUrls.add(href);
        textBodies.set(href, text);
        for (const raw of extractRawUrls(text, true)) {
          const target = normalize(unescapeSlashes(raw), href);
          if (target && !isHtmlUrl(target)) assetQueue.add(stripQuery(target));
        }
      } catch (err) {
        failures.push(`${href} :: ${err.message}`);
      }
    });

    await runPool(rest, async (href) => {
      if (attemptedAssets.has(href)) return;
      attemptedAssets.add(href);
      const local = toLocalPath(new URL(href));
      if (await alreadyOnDisk(local)) {
        downloadedAssets.add(href); // resume: já veio numa execução anterior
        return;
      }
      try {
        const buf = await fetchWithRetry(href, { binary: true });
        await save(local, buf);
        downloadedAssets.add(href);
      } catch (err) {
        if (!derivedAssets.has(href)) failures.push(`${href} :: ${err.message}`);
      }
    });

    await discoverJsChunks();
    pending = [...assetQueue].filter((u) => !cssUrls.has(u) && !attemptedAssets.has(u));
  }
}

/** @type {Set<string>} JS já vasculhado em busca de manifesto */
const scannedJs = new Set();
/**
 * @type {Set<string>} URLs derivadas do manifesto. Nem todo chunk existe no
 * diretório em que foi citado, então o 404 delas é esperado e não é relatado.
 */
const derivedAssets = new Set();

async function discoverJsChunks() {
  for (const href of [...downloadedAssets]) {
    if (!/\.js$/i.test(new URL(href).pathname)) continue;
    if (scannedJs.has(href)) continue;
    scannedJs.add(href);

    let code;
    try {
      const local = toLocalPath(new URL(href)).split('/').join(sep);
      code = await readFile(join(OUT_DIR, local), 'utf8');
    } catch {
      continue;
    }

    const base = href.slice(0, href.lastIndexOf('/'));
    for (const [, name, hash] of code.matchAll(CHUNK_MANIFEST_RE)) {
      const url = `${base}/${name}.${hash}.bundle.min.js`;
      if (attemptedAssets.has(url)) continue;
      derivedAssets.add(url);
      assetQueue.add(url);
    }
  }
}

async function runPool(items, worker) {
  const list = [...items];
  let done = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, list.length || 1) }, async () => {
    while (list.length) {
      const item = list.shift();
      await worker(item);
      done++;
      if (done % 25 === 0) process.stdout.write(`asset ${done} ok\n`);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Reescrita de URLs -> caminhos relativos
// ---------------------------------------------------------------------------

function rewrite(text, sourceUrl, isCss) {
  const fromLocal = toLocalPath(new URL(sourceUrl));
  const raws = [...extractRawUrls(text, isCss)]
    // Substitui as strings mais longas primeiro para não quebrar prefixos.
    .sort((a, b) => b.length - a.length);

  let out = text;
  for (const raw of raws) {
    const target = normalize(unescapeSlashes(raw), sourceUrl);
    if (!target) continue;
    if (SKIP_PATH.test(target.pathname)) continue;

    // Base de diretório: vira caminho de pasta, preservando a barra final.
    if (isDirectoryBase(target)) {
      const dir = decodeURIComponent(target.pathname).replace(/^\//, '');
      let relDir = posix.relative(posix.dirname(fromLocal), dir);
      if (!relDir.startsWith('.')) relDir = `./${relDir}`;
      if (target.pathname.endsWith('/')) relDir += '/';

      out = replaceUrl(out, raw, relDir);
      const escapedDir = raw.replace(/\//g, '\\/');
      if (escapedDir !== raw) out = replaceUrl(out, escapedDir, relDir.replace(/\//g, '\\/'));
      continue;
    }

    const canonical = isHtmlUrl(target) ? canonicalPage(target) : stripQuery(target);
    const targetUrl = new URL(canonical);

    // Só reescreve o que realmente existe no mirror; o resto continua absoluto.
    const known =
      pageUrls.has(canonical) || cssUrls.has(canonical) || downloadedAssets.has(canonical);
    if (!known) continue;

    let rel = relativeFrom(fromLocal, toLocalPath(targetUrl));
    // Âncora (#contato) não faz parte do arquivo, mas precisa sobreviver.
    const hash = raw.includes('#') ? raw.slice(raw.indexOf('#')) : '';
    if (hash) rel += hash;

    out = replaceUrl(out, raw, rel);

    // Variante com barras escapadas (data-settings do Elementor).
    if (raw.includes('/')) {
      const escaped = raw.replace(/\//g, '\\/');
      if (escaped !== raw) out = replaceUrl(out, escaped, rel.replace(/\//g, '\\/'));
    }
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Substitui só ocorrências completas. Sem o lookahead de fronteira, a URL da
 * home é prefixo de todas as outras e corrompe o que veio depois
 * (ex.: `.../wp-comments-post.php` virava `index.htmlwp-comments-post.php`).
 */
function replaceUrl(haystack, needle, replacement) {
  if (!needle) return haystack;
  // A barra invertida NÃO é fronteira: dentro do JSON escapado do Elementor a
  // URL continua em `\/`, então aceitá-la como fim de match fazia a base de
  // diretório `.../wp-content/uploads` casar no meio da URL e truncar o resto
  // (`...uploads\/2024\/03\/Group-16-1.png` perdia o caminho e o arquivo
  // nunca era baixado).
  const re = new RegExp(escapeRegExp(needle) + '(?=["\'\\s,)>&#]|$)', 'g');
  return haystack.replace(re, () => replacement);
}

async function writeRewritten() {
  for (const href of [...pageUrls, ...cssUrls]) {
    const isCss = cssUrls.has(href);
    const raw = textBodies.get(href);
    if (raw == null) continue;
    let out = rewrite(raw, href, isCss);
    if (!isCss) out = patchHtml(out, href);
    await save(toLocalPath(new URL(href)), out);
  }
}

/** Ajustes de HTML necessários para o site rodar solto, sem WordPress. */
const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Converte o ícone de lupa do Elementor num link comum apontando para o arquivo
 * local, no mesmo formato dos demais gatilhos do lightbox.
 *
 * Ganho além de fazer o clique funcionar: a URL sai do base64 e vira uma
 * referência de verdade, que o conversor de WebP e o check-links enxergam.
 */
function linkLightboxIcons(html, pageHref) {
  const fromLocal = toLocalPath(new URL(pageHref));

  return html.replace(
    /<a\b([^>]*?)href="(#elementor-action[^"]*)"([^>]*)>/gi,
    (all, pre, hash, post) => {
      const settings = decodeActionHash(hash);
      if (!settings) return all;

      const target = normalize(settings.url, pageHref);
      if (!target) return all;

      const canonical = stripQuery(target);
      // Se a imagem não veio, manter o href original é melhor que apontar para
      // um arquivo inexistente.
      if (!downloadedAssets.has(canonical)) return all;

      const rel = relativeFrom(fromLocal, toLocalPath(new URL(canonical)));
      const title = escapeAttr(settings.title ?? '');
      return `<a${pre}href="${rel}" data-debony-lightbox="yes" data-debony-lightbox-title="${title}"${post}>`;
    },
  );
}

function patchHtml(html, pageHref) {
  return (
    linkLightboxIcons(html, pageHref)
      // WP emite links de API/edição que não existem no mirror.
      .replace(/<link[^>]+rel=["'](?:https:\/\/api\.w\.org\/|EditURI|alternate|shortlink|pingback)["'][^>]*>\s*/gi, '')
      .replace(/<link[^>]+rel=["']alternate["'][^>]*type=["']application\/json["'][^>]*>\s*/gi, '')
      /*
       * O lightbox é nosso (src/lightbox.ts), então os atributos do Elementor
       * são renomeados. Deixá-los faz o frontend do Elementor baixar o módulo
       * de lightbox dele sob demanda — bundles e CSS que não existem no mirror,
       * gerando 404 em cadeia no console, para um recurso já substituído.
       */
      .replace(/\sdata-elementor-open-lightbox="([^"]*)"/gi, (_all, value) =>
        value.toLowerCase() === 'yes' ? ' data-debony-lightbox="yes"' : '',
      )
      .replace(/\sdata-elementor-lightbox-title=/gi, ' data-debony-lightbox-title=')
      .replace(/\sdata-e-action-hash="[^"]*"/gi, '')

      // Formulários do WP apontam para o backend PHP, que não existe no estático.
      // O handler em TypeScript assume o envio a partir de data-wp-form.
      .replace(
        /<form([^>]*?)\baction=["'][^"']*(wp-admin|wp-comments-post\.php)[^"']*["']/gi,
        '<form$1data-wp-form="$2"',
      )
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  await crawlPages();
  for (const path of EXTRA_ASSETS) assetQueue.add(new URL(path, ORIGIN).href);
  console.log(`\n${pageUrls.size} páginas, ${assetQueue.size} assets na fila\n`);
  await downloadAssets();
  await writeRewritten();

  const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
  console.log(
    `\nOK: ${pageUrls.size} páginas, ${cssUrls.size} CSS, ${downloadedAssets.size} assets, ` +
      `${dirBases.size} bases de diretório`,
  );
  console.log(`${mb} MB em ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT_DIR}/`);
  if (failures.length) {
    console.log(`\n${failures.length} falha(s):`);
    for (const f of failures.slice(0, 40)) console.log('  ' + f);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
