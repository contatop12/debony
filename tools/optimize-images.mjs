/**
 * Converte PNG/JPEG do mirror para WebP e reescreve as referências no HTML/CSS.
 *
 * O original só é apagado quando o WebP fica menor; se não compensar, o arquivo
 * fica como está e nenhuma referência muda.
 *
 * Uso: node tools/optimize-images.mjs [--out site] [--quality 82] [--dry]
 */

import sharp from 'sharp';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT_DIR = resolve(argVal('out', 'site'));
const QUALITY = Number(argVal('quality', 82));
const DRY_RUN = args.includes('--dry');

const CONVERTIBLE = /\.(png|jpe?g)$/i;
const TEXT_FILE = /\.(html|css)$/i;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const toPosix = (abs) => relative(OUT_DIR, abs).split(sep).join('/');

/**
 * Ícones de aba e apple-touch-icon precisam continuar PNG: o WebP não é aceito
 * de forma confiável nesses contextos.
 */
async function collectIconPaths(textFiles) {
  const icons = new Set();
  const linkRe = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
  const hrefRe = /href=["']([^"']+)["']/i;

  for (const file of textFiles) {
    if (!file.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    for (const tag of html.match(linkRe) ?? []) {
      const href = tag.match(hrefRe)?.[1];
      if (!href) continue;
      const name = href.split('?')[0].split('/').pop();
      if (name) icons.add(name.toLowerCase());
    }
  }
  return icons;
}

const REF_RE =
  /(?:href|src|data-src|data-lazy-src|poster)\s*=\s*"([^"]+)"|url\(\s*"?'?([^)"']+)"?'?\s*\)|srcset\s*=\s*"([^"]+)"/gi;

const fileExists = async (p) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Substitui só ocorrências completas, para uma URL não corromper o sufixo da outra. */
function replaceRef(haystack, needle, replacement) {
  const re = new RegExp(escapeRegExp(needle) + '(?=["\'\\s,)\\\\>&#?]|$)', 'g');
  return haystack.replace(re, () => replacement);
}

/**
 * Reescreve referência a imagem que sumiu mas tem irmã `.webp`.
 *
 * Casar o caminho por substring não funciona: dentro do CSS do Elementor as
 * referências são relativas ao próprio arquivo (`../../2024/04/foto.jpg`) e não
 * carregam o prefixo do diretório. Aqui cada referência é resolvida de verdade,
 * e só a extensão muda — o prefixo relativo é preservado.
 *
 * A regra "alvo ausente + .webp existe" também conserta execução interrompida.
 */
async function rewriteRefs(textFiles) {
  let touched = 0;

  for (const file of textFiles) {
    const source = await readFile(file, 'utf8');
    const refs = new Set();

    for (const m of source.matchAll(REF_RE)) {
      if (m[3]) {
        for (const part of m[3].split(',')) refs.add(part.trim().split(/\s+/)[0]);
      } else {
        refs.add(m[1] ?? m[2]);
      }
    }

    let text = source;
    for (const rawRef of refs) {
      if (!rawRef) continue;
      const ref = rawRef.trim();
      if (!CONVERTIBLE.test(ref.split('?')[0].split('#')[0])) continue;

      const clean = ref.replace(/\\\//g, '/').split('?')[0].split('#')[0];
      if (/^(https?:)?\/\//i.test(clean)) continue; // externo: não é nosso arquivo

      const abs = clean.startsWith('/')
        ? join(OUT_DIR, clean)
        : resolve(dirname(file), clean);

      if (await fileExists(abs)) continue; // original ainda existe: nada a fazer
      if (!(await fileExists(abs.replace(CONVERTIBLE, '.webp')))) continue;

      text = replaceRef(text, ref, ref.replace(CONVERTIBLE, '.webp'));
    }

    if (text !== source) {
      await writeFile(file, text);
      touched++;
    }
  }
  return touched;
}

async function main() {
  const all = await walk(OUT_DIR);
  const textFiles = all.filter((f) => TEXT_FILE.test(f));
  const images = all.filter((f) => CONVERTIBLE.test(f));
  const iconNames = await collectIconPaths(textFiles);

  /** @type {Map<string, string>} caminho posix original -> caminho posix webp */
  const renames = new Map();
  let before = 0;
  let after = 0;
  let skipped = 0;

  for (const file of images) {
    const name = file.split(sep).pop().toLowerCase();
    if (iconNames.has(name)) {
      skipped++;
      continue;
    }

    const original = (await stat(file)).size;
    const target = file.replace(CONVERTIBLE, '.webp');

    let buf;
    try {
      buf = await sharp(file).webp({ quality: QUALITY, effort: 5 }).toBuffer();
      if (buf.length >= original) {
        // Arte com pouca cor costuma ficar menor sem perdas.
        const lossless = await sharp(file).webp({ lossless: true, effort: 5 }).toBuffer();
        if (lossless.length < buf.length) buf = lossless;
      }
    } catch (err) {
      console.warn(`  falhou: ${toPosix(file)} (${err.message})`);
      skipped++;
      continue;
    }

    if (buf.length >= original) {
      skipped++;
      continue; // não compensa: mantém o original e a referência
    }

    before += original;
    after += buf.length;
    renames.set(toPosix(file), toPosix(target));

    if (!DRY_RUN) {
      await writeFile(target, buf);
      await rm(file);
    }
  }

  const touched = DRY_RUN ? 0 : await rewriteRefs(textFiles);

  const mb = (n) => (n / 1048576).toFixed(1);
  const saved = before - after;
  console.log(`convertidas: ${renames.size}   mantidas: ${skipped}`);
  console.log(`${mb(before)} MB -> ${mb(after)} MB  (economia ${mb(saved)} MB)`);
  console.log(`arquivos de texto atualizados: ${touched}`);
  if (DRY_RUN) console.log('(dry run: nada foi escrito)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
