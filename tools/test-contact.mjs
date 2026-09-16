/**
 * Testa a função de contato sem depender da Vercel.
 *
 * Compila api/contact.ts e chama o handler com Request/Response reais — a mesma
 * assinatura que a Vercel usa em runtime. O caminho de envio é exercido contra
 * um webhook stub local, então o "ok" não é presumido. Nunca toca o webhook real.
 *
 * Uso: node tools/test-contact.mjs
 */

import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const resultados = [];
const check = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
};

// --- compila a função -------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'debony-contact-'));
const out = join(dir, 'contact.mjs');
await build({
  entryPoints: ['api/contact.ts'],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  logLevel: 'warning',
});
const { default: handler } = await import(pathToFileURL(out).href);

// --- webhook stub -----------------------------------------------------------
const recebidos = [];
let statusDoStub = 200;
const stub = createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    recebidos.push(corpo);
    res.writeHead(statusDoStub, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const webhookUrl = `http://127.0.0.1:${stub.address().port}/hook`;

// --- helpers ----------------------------------------------------------------
const ORIGEM = 'https://debony.example';
const chamar = (body, { method = 'POST', origin, headers = {} } = {}) =>
  handler.fetch(
    new Request(`${ORIGEM}/api/contact`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }),
  );

const validos = { name: 'Fulano', email: 'fulano@exemplo.com', message: 'Gostaria de um orçamento.' };

const limparEnv = () => {
  for (const k of ['CONTACT_TO', 'CONTACT_FROM', 'RESEND_API_KEY', 'CONTACT_WEBHOOK']) {
    delete process.env[k];
  }
};

const ultimoRecebido = () => (recebidos.length ? JSON.parse(recebidos.at(-1)) : null);

// --- validação --------------------------------------------------------------
limparEnv();

let r = await chamar(null, { method: 'GET' });
let diag = await r.json();
check(
  'GET mostra destinos não configurados',
  r.status === 200 && diag.destinos?.webhook === false && diag.destinos?.email === false,
  JSON.stringify(diag.destinos),
);

r = await chamar(null, { method: 'PUT' });
check('outros métodos respondem 405', r.status === 405, `${r.status}`);

r = await chamar('isso não é json');
check('corpo inválido responde 400', r.status === 400, `${r.status}`);

r = await chamar({});
check('sem nome responde 400', r.status === 400 && (await r.json()).error === 'Informe seu nome.');

r = await chamar({ ...validos, email: 'invalido' });
check('e-mail inválido responde 400', r.status === 400 && (await r.json()).error.includes('e-mail'));

r = await chamar({ ...validos, message: 'oi' });
check('mensagem curta responde 400', r.status === 400);

r = await chamar(validos, { origin: 'https://outro-site.com' });
check('origem estranha responde 403', r.status === 403, `${r.status}`);

r = await chamar({ ...validos, website: 'sou-um-bot' });
check('honeypot responde 200 sem enviar', r.status === 200 && recebidos.length === 0);

r = await chamar(validos);
check('sem destino configurado responde 503', r.status === 503, `${r.status}`);

r = await chamar({ name: 'x'.repeat(40000), email: 'a@b.com', message: 'oi oi oi' });
check('corpo gigante responde 413', r.status === 413, `${r.status}`);

// --- envio ao webhook -------------------------------------------------------
process.env['CONTACT_WEBHOOK'] = webhookUrl;

r = await chamar(null, { method: 'GET' });
const textoDiag = await r.text();
check(
  'GET mostra webhook configurado sem revelar a URL',
  r.status === 200 && JSON.parse(textoDiag).destinos?.webhook === true && !textoDiag.includes('127.0.0.1') && !textoDiag.includes('/hook'),
  textoDiag,
);

r = await chamar(validos, { origin: ORIGEM, headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
let lead = ultimoRecebido();
check(
  'envio válido responde 200 e entrega ao webhook',
  r.status === 200 && lead?.email === validos.email && lead?.name === validos.name,
  `${r.status}, webhook recebeu ${recebidos.length}`,
);
check('resposta não é cacheável', r.headers.get('Cache-Control') === 'no-store');
check('ip é o primeiro da cadeia x-forwarded-for', lead?.ip === '203.0.113.7', `${lead?.ip}`);
check('sem atribuição o lead não ganha campos utm', !Object.keys(lead ?? {}).some((k) => k.startsWith('utm_')));

// --- atribuição (UTMs) ------------------------------------------------------
const atribuicao = {
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'usinagem-sp',
  utm_term: 'torno cnc',
  utm_content: 'anuncio-a',
  gclid: 'Cj0KCQ-teste',
  fbclid: 'IwAR-teste',
  landing_page: 'https://debony.example/?utm_source=google',
  referrer: 'https://www.google.com/',
  captured_at: '2026-09-15T12:00:00.000Z',
  page_url: 'https://debony.example/contato/',
};

r = await chamar({ ...validos, attribution: atribuicao }, { origin: ORIGEM });
lead = ultimoRecebido();
const faltando = Object.entries(atribuicao).filter(([k, v]) => lead?.[k] !== v).map(([k]) => k);
check(
  'todos os campos de atribuição chegam planos ao webhook',
  r.status === 200 && faltando.length === 0,
  faltando.length ? `faltando: ${faltando.join(', ')}` : '11 campos',
);

r = await chamar(
  {
    ...validos,
    attribution: {
      utm_source: 'meta',
      campo_inventado: 'nao deveria passar',
      __proto__: { poluido: true },
      utm_medium: 12345,
      utm_campaign: '   ',
      utm_term: 'x'.repeat(2000),
    },
  },
  { origin: ORIGEM },
);
lead = ultimoRecebido();
check('campo fora da lista é descartado', lead && !('campo_inventado' in lead) && !('poluido' in lead));
check('valor não-string é descartado', lead && !('utm_medium' in lead), `${lead?.utm_medium}`);
check('valor só com espaços é descartado', lead && !('utm_campaign' in lead));
check('valor longo é truncado em 500', lead?.utm_term?.length === 500, `${lead?.utm_term?.length}`);
check('campo válido do mesmo envio passa', lead?.utm_source === 'meta');

r = await chamar({ ...validos, attribution: ['nao', 'e', 'objeto'] }, { origin: ORIGEM });
check('atribuição em formato inválido não derruba o envio', r.status === 200);

// --- falha do destino -------------------------------------------------------
statusDoStub = 500;
r = await chamar(validos, { origin: ORIGEM });
check('webhook fora do ar responde 502, não finge sucesso', r.status === 502, `${r.status}`);
statusDoStub = 200;

limparEnv();
// Fecha as conexões keep-alive e espera o servidor terminar. Encerrar o processo
// com o handle ainda fechando aborta o Node no Windows (assert em async.c), e o
// exit code 127 reprovaria o verify com todos os testes verdes.
stub.closeAllConnections();
await new Promise((r) => stub.close(r));
await rm(dir, { recursive: true, force: true });

const falhas = resultados.filter((x) => !x.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
// exitCode, e não process.exit(): deixa o event loop esvaziar sozinho.
process.exitCode = falhas.length === 0 ? 0 : 1;
