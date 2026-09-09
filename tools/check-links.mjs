/**
 * Confere se todo caminho relativo referenciado pelo mirror existe em disco.
 * Uso: node tools/check-links.mjs [dir]
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'site');

const REF_RE =
  /(?:href|src|data-src|data-lazy-src|poster|action)\s*=\s*"([^"]+)"|url\(\s*"?'?([^)"']+)"?'?\s*\)|srcset\s*=\s*"([^"]+)"/gi;

/**
 * Nem toda referência vive num atributo conhecido: o Elementor guarda a galeria
 * do background slideshow como JSON em `data-settings`, e og:image usa
 * `content=`. Olhar só os atributos da lista acima dava um "OK" falso enquanto
 * a home tinha uma seção inteira sem imagem.
 */
const LOOSE_REF_RE =
  /(?<![A-Za-z0-9_\-.~%:])(?:\.{0,2}\\?\/)[A-Za-z0-9_\-.~%\\/]*\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|woff2?|mp4)(?=["'\s,)>&?#]|$)/gi;

/**
 * A varredura solta casa por caminho, então um nome de arquivo citado dentro de
 * comentário vira alvo ausente. O CSS do WordPress traz anotações como
 * `/* ... classic-themes.min.css *\/` que não referenciam nada.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const exists = async (p) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

const files = (await walk(ROOT)).filter((f) => /\.(html|css)$/i.test(f));
const missing = new Map();
let checked = 0;

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const refs = new Set();

  for (const m of text.matchAll(REF_RE)) {
    if (m[3]) {
      for (const part of m[3].split(',')) refs.add(part.trim().split(/\s+/)[0]);
    } else {
      refs.add(m[1] ?? m[2]);
    }
  }
  for (const m of stripComments(text).matchAll(LOOSE_REF_RE)) refs.add(m[0]);

  for (const raw of refs) {
    if (!raw) continue;
    const ref = raw.trim().replace(/\\\//g, '/');
    if (!ref.startsWith('.') && !ref.startsWith('/')) continue; // externo/data:/mailto:
    if (ref.startsWith('//')) continue;

    const target = ref.startsWith('/')
      ? join(ROOT, ref.split('?')[0].split('#')[0])
      : resolve(dirname(file), ref.split('?')[0].split('#')[0]);

    checked++;
    if (!(await exists(target))) {
      const key = relative(ROOT, target).split(sep).join('/');
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(relative(ROOT, file).split(sep).join('/'));
    }
  }
}

console.log(`${files.length} arquivos, ${checked} refs relativas verificadas`);
if (!missing.size) {
  console.log('OK: nenhuma referência quebrada.');
} else {
  console.log(`\n${missing.size} alvo(s) ausente(s):`);
  for (const [target, sources] of [...missing].slice(0, 60)) {
    console.log(`  ${target}\n      <- ${[...sources].slice(0, 3).join(', ')}`);
  }
}
