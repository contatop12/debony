/**
 * Teste ponta a ponta do formulário de contato num Chrome real.
 *
 * Sobe um servidor local que serve site/ e roteia /api/contact para o handler
 * compilado de api/contact.ts, com CONTACT_WEBHOOK apontando para um stub. Nunca
 * toca o webhook real.
 *
 * Cobre o que o teste da função sozinho não alcança: a captura das UTMs na
 * chegada e a persistência delas até o envio, depois de navegar entre páginas.
 *
 * Uso: node tools/test-form-e2e.mjs
 */

import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const ROOT = resolve('site');

const resultados = [];
const check = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
};

// --- função compilada -------------------------------------------------------
const tmp = await mkdtemp(join(tmpdir(), 'debony-e2e-'));
await build({
  entryPoints: ['api/contact.ts'],
  outfile: join(tmp, 'contact.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  logLevel: 'warning',
});
const { default: handler } = await import(pathToFileURL(join(tmp, 'contact.mjs')).href);

// --- webhook stub -----------------------------------------------------------
const leads = [];
const stub = createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    leads.push(JSON.parse(corpo));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
process.env['CONTACT_WEBHOOK'] = `http://127.0.0.1:${stub.address().port}/hook`;

// --- site + api -------------------------------------------------------------
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const site = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/contact') {
    const partes = [];
    for await (const c of req) partes.push(c);
    const resposta = await handler.fetch(
      new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'POST' ? Buffer.concat(partes) : undefined,
      }),
    );
    res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
    res.end(Buffer.from(await resposta.arrayBuffer()));
    return;
  }

  let alvo = resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!alvo.startsWith(ROOT + sep) && alvo !== ROOT) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(alvo)).isDirectory()) alvo = join(alvo, 'index.html');
    const corpo = await readFile(alvo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(alvo)] ?? 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${site.address().port}`;

// --- navegador --------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

async function enviarFormulario(nome, email) {
  await page.goto(`${BASE}/contato/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => document.querySelector('.cky-consent-container')?.remove());
  await page.type('[name="form_fields[name]"]', nome);
  await page.type('[name="form_fields[email]"]', email);
  await page.type('[name="form_fields[message]"]', 'Mensagem de teste automatizado.');
  await page.click('form.elementor-form button[type="submit"]');
  await page.waitForSelector(
    '.debony-form-message[data-status="success"], .debony-form-message[data-status="error"]',
    { timeout: 15000 },
  );
  return page.$eval('.debony-form-message', (el) => ({ status: el.dataset.status, texto: el.textContent }));
}

// Cenário 1: chega por anúncio do Google, passa por outra página sem UTM, envia.
await page.goto(
  `${BASE}/?utm_source=google&utm_medium=cpc&utm_campaign=usinagem-sp&utm_content=anuncio-a&gclid=GCLID-123`,
  { waitUntil: 'networkidle2', timeout: 60000 },
);
await page.goto(`${BASE}/sobre-nos/`, { waitUntil: 'networkidle2', timeout: 60000 });

let tela = await enviarFormulario('Visitante Google', 'google@exemplo.com');
let lead = leads.at(-1);
check('formulário mostra sucesso', tela.status === 'success', tela.texto);
check('lead chega ao webhook com nome e e-mail', lead?.name === 'Visitante Google' && lead?.email === 'google@exemplo.com');
check(
  'UTMs da chegada sobrevivem à navegação até /contato/',
  lead?.utm_source === 'google' && lead?.utm_medium === 'cpc' && lead?.utm_campaign === 'usinagem-sp' && lead?.utm_content === 'anuncio-a',
  `${lead?.utm_source}/${lead?.utm_medium}/${lead?.utm_campaign}`,
);
check('gclid é enviado', lead?.gclid === 'GCLID-123', `${lead?.gclid}`);
check('landing_page é a URL de chegada', lead?.landing_page?.includes('utm_source=google'), lead?.landing_page);
check('page_url é a página do formulário', lead?.page_url?.endsWith('/contato/'), lead?.page_url);
check('visita sem UTM no meio do caminho não apagou a atribuição', lead?.utm_source === 'google');

// Cenário 2: volta por um anúncio da Meta. Último toque substitui o anterior.
await page.goto(`${BASE}/?utm_source=meta&utm_medium=social&fbclid=FB-456`, {
  waitUntil: 'networkidle2',
  timeout: 60000,
});
tela = await enviarFormulario('Visitante Meta', 'meta@exemplo.com');
lead = leads.at(-1);
check(
  'nova chegada com UTM substitui a anterior (último toque)',
  tela.status === 'success' && lead?.utm_source === 'meta' && lead?.fbclid === 'FB-456',
  `${lead?.utm_source}, fbclid=${lead?.fbclid}`,
);
check('campos da campanha anterior não vazam para o novo lead', !lead?.gclid && !lead?.utm_campaign);

// Cenário 3: navegador novo, sem nenhuma UTM. Envia sem atribuição e sem quebrar.
const semOrigem = await browser.createBrowserContext();
const pageSemOrigem = await semOrigem.newPage();
await pageSemOrigem.setViewport({ width: 1440, height: 900 });
{
  await pageSemOrigem.goto(`${BASE}/contato/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await pageSemOrigem.evaluate(() => document.querySelector('.cky-consent-container')?.remove());
  await pageSemOrigem.type('[name="form_fields[name]"]', 'Visitante Direto');
  await pageSemOrigem.type('[name="form_fields[email]"]', 'direto@exemplo.com');
  await pageSemOrigem.type('[name="form_fields[message]"]', 'Acesso direto, sem campanha.');
  await pageSemOrigem.click('form.elementor-form button[type="submit"]');
  await pageSemOrigem.waitForSelector('.debony-form-message[data-status="success"]', { timeout: 15000 });
}
lead = leads.at(-1);
check(
  'acesso direto envia sem UTM e sem erro',
  lead?.email === 'direto@exemplo.com' && !Object.keys(lead).some((k) => k.startsWith('utm_')),
);
check('acesso direto ainda informa a página do formulário', lead?.page_url?.endsWith('/contato/'));

// --- encerramento -----------------------------------------------------------
await browser.close();
for (const srv of [site, stub]) {
  srv.closeAllConnections();
  await new Promise((r) => srv.close(r));
}
await rm(tmp, { recursive: true, force: true });

const falhas = resultados.filter((x) => !x.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
process.exitCode = falhas.length === 0 ? 0 : 1;
