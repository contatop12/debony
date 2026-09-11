/**
 * Testa a função de contato sem depender da Vercel.
 *
 * Compila api/contact.ts e chama o handler com Request/Response reais — a mesma
 * assinatura que a Vercel usa em runtime. O caminho de envio é exercido contra
 * um webhook stub local, então o "ok" não é presumido.
 *
 * Uso: node tools/test-contact.mjs
 */

import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const stub = createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    recebidos.push(corpo);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
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

// --- casos ------------------------------------------------------------------
limparEnv();

let r = await chamar(null, { method: 'GET' });
check('GET responde 405', r.status === 405, `${r.status}`);

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
check('sem provedor configurado responde 503', r.status === 503, `${r.status}`);

r = await chamar({ name: 'x'.repeat(20000), email: 'a@b.com', message: 'oi oi oi' });
check('corpo gigante responde 413', r.status === 413, `${r.status}`);

// Caminho feliz: webhook stub recebe a mensagem.
process.env['CONTACT_WEBHOOK'] = webhookUrl;
r = await chamar(validos, { origin: ORIGEM });
const corpoRecebido = recebidos.length === 1 ? JSON.parse(recebidos[0]) : null;
check(
  'envio válido responde 200 e entrega ao webhook',
  r.status === 200 && corpoRecebido?.email === validos.email && corpoRecebido?.name === validos.name,
  `${r.status}, webhook recebeu ${recebidos.length}`,
);
check('sem cabeçalho no-store a resposta não seria cacheável', r.headers.get('Cache-Control') === 'no-store');

limparEnv();
stub.close();
await rm(dir, { recursive: true, force: true });

const falhas = resultados.filter((x) => !x.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
process.exit(falhas.length === 0 ? 0 : 1);
