/**
 * Abre todas as páginas do mirror num Chrome real e lista o que dá 404.
 *
 * O crawler estático não enxerga o que o JS do Elementor pede em runtime;
 * só um browser revela. O resultado alimenta EXTRA_ASSETS em tools/mirror.mjs.
 *
 * Uso: node tools/scan-404.mjs [baseUrl]
 */

import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8904').replace(/\/$/, '');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const PAGES = [
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
  '/author/debonyx/',
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const quebradas = new Map();
const errosConsole = new Map();

for (const path of PAGES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('response', (r) => {
    if (r.status() < 400) return;
    const url = new URL(r.url());
    if (url.host !== new URL(BASE).host) return; // terceiros não são nosso problema
    if (!quebradas.has(url.pathname)) quebradas.set(url.pathname, new Set());
    quebradas.get(url.pathname).add(path);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const texto = m.text().slice(0, 120);
    if (/Failed to load resource/i.test(texto)) return; // já contado como 404
    if (!errosConsole.has(texto)) errosConsole.set(texto, new Set());
    errosConsole.get(texto).add(path);
  });

  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
    // Dá tempo para os chunks carregados sob demanda dispararem.
    await new Promise((r) => setTimeout(r, 1500));
  } catch (err) {
    console.log(`ERRO ao abrir ${path}: ${err.message}`);
  }
  await page.close();
  process.stdout.write(`.`);
}

await browser.close();
console.log(`\n\n${PAGES.length} páginas varridas\n`);

if (quebradas.size === 0) {
  console.log('OK: nenhuma requisição 404.');
} else {
  console.log(`${quebradas.size} recurso(s) com 404:`);
  for (const [url, paginas] of [...quebradas].sort()) {
    console.log(`  ${url}`);
    console.log(`      em: ${[...paginas].join(', ')}`);
  }
}

if (errosConsole.size) {
  console.log(`\n${errosConsole.size} erro(s) de console:`);
  for (const [texto, paginas] of errosConsole) {
    console.log(`  ${texto}\n      em: ${[...paginas].join(', ')}`);
  }
}

process.exit(quebradas.size === 0 && errosConsole.size === 0 ? 0 : 1);
