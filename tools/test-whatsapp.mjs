/**
 * Teste do WhatsApp flutuante num Chrome real.
 *
 * Confere em todas as páginas que o botão existe uma vez e começa fechado, e
 * na home: números e links (tel: e wa.me), abertura pelo hover sem fechar no
 * caminho até o painel, fechamento ao sair, clique fixando e o "X", clique fora,
 * teclado (Enter, Tab, Esc devolvendo o foco), contraste do texto, colunas
 * alinhadas, cores do tema que não vazam (#C36 do Hello Elementor) e, no
 * celular, toque, painel dentro da tela e alvos de toque.
 *
 * Uso: node tools/test-whatsapp.mjs [baseUrl] [pastaDosPrints]
 */

import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8905').replace(/\/$/, '') + '/';
const PRINTS = process.argv[3];
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

const PAGINAS = [
  '',
  'sobre-nos/',
  'servicos/',
  'estrutura/',
  'qualidade/',
  'certificados/',
  'contato/',
  'politicas-de-privacidade/',
  'termos-de-uso/',
  'responsabilidade-social/',
  '2023/11/25/ola-mundo/',
  'author/debonyx/',
];

const NUMEROS = [
  { texto: '(11) 5687-7566', tel: 'tel:+551156877566', whatsapp: 'https://wa.me/551156877566' },
  { texto: '(11) 5687-7381', tel: 'tel:+551156877381', whatsapp: null },
  { texto: '(11) 5687-7382', tel: 'tel:+551156877382', whatsapp: null },
  { texto: '(19) 3881-3448', tel: 'tel:+551938813448', whatsapp: null },
];

const resultados = [];
const check = (nome, ok, detalhe = '') => {
  resultados.push(ok);
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const luminancia = ([r, g, b]) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const razao = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function abrir(pagina, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(BASE + pagina, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => document.querySelector('.cky-consent-container')?.remove());
  await esperar(800);
  return page;
}

const estado = (page) =>
  page.evaluate(() => {
    const raiz = document.querySelector('.debony-whatsapp');
    const painel = raiz.querySelector('.debony-whatsapp__painel');
    const cs = getComputedStyle(painel);
    return {
      aberto: raiz.hasAttribute('data-aberto'),
      fixo: raiz.hasAttribute('data-fixo'),
      expanded: raiz.querySelector('button').getAttribute('aria-expanded'),
      visivel: cs.visibility === 'visible' && Number(cs.opacity) === 1,
      escondido: cs.visibility === 'hidden',
    };
  });

const centro = (page, seletor) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, seletor);

const print = async (page, nome) => {
  if (PRINTS) await page.screenshot({ path: `${PRINTS}/${nome}.png`, captureBeyondViewport: false });
};

// --- todas as páginas ---------------------------------------------------------
let semBotao = [];
for (const pagina of PAGINAS) {
  const page = await abrir(pagina, { width: 1366, height: 768 });
  const r = await page.evaluate(() => ({
    total: document.querySelectorAll('.debony-whatsapp').length,
    escondido: getComputedStyle(document.querySelector('.debony-whatsapp__painel') ?? document.body).visibility === 'hidden',
  }));
  if (r.total !== 1 || !r.escondido) semBotao.push(`${pagina || '/'} (${r.total}, escondido=${r.escondido})`);
  await page.close();
}
check(`botão único e painel fechado nas ${PAGINAS.length} páginas`, semBotao.length === 0, semBotao.join(', '));

// --- computador ---------------------------------------------------------------
let page = await abrir('', { width: 1920, height: 1000 });

const dados = await page.evaluate(() =>
  [...document.querySelectorAll('.debony-whatsapp__item')].map((li) => ({
    texto: li.querySelector('.debony-whatsapp__numero').firstChild.textContent.trim(),
    tel: li.querySelector('.debony-whatsapp__acao--ligar')?.getAttribute('href') ?? null,
    whatsapp: li.querySelector('.debony-whatsapp__acao--whatsapp')?.getAttribute('href') ?? null,
    alvo: li.querySelector('.debony-whatsapp__acao--whatsapp')?.getAttribute('target') ?? null,
    rel: li.querySelector('.debony-whatsapp__acao--whatsapp')?.getAttribute('rel') ?? null,
  })),
);
const errados = NUMEROS.filter((n, i) => {
  const d = dados[i];
  if (!d || d.texto !== n.texto || d.tel !== n.tel) return true;
  if (n.whatsapp === null) return d.whatsapp !== null;
  return !d.whatsapp?.startsWith(`${n.whatsapp}?text=`) || d.alvo !== '_blank' || !d.rel?.includes('noopener');
});
check('4 números, todos com Ligar e só o (11) 5687-7566 com WhatsApp', dados.length === 4 && errados.length === 0,
  errados.map((n) => n.texto).join(', ') || dados.map((d) => d.texto).join(' | '));

const antes = await estado(page);
check('começa fechado, links fora do Tab', !antes.aberto && antes.escondido && antes.expanded === 'false');

// Hover abre.
const botao = await centro(page, '.debony-whatsapp__botao');
await page.mouse.move(botao.x - 400, botao.y);
await page.mouse.move(botao.x, botao.y, { steps: 8 });
await esperar(350);
let e = await estado(page);
check('hover no botão abre o painel', e.aberto && e.visivel && e.expanded === 'true' && !e.fixo, JSON.stringify(e));
await print(page, 'whatsapp-hover-1920');

const cores = await page.evaluate(() => {
  const b = getComputedStyle(document.querySelector('.debony-whatsapp__botao'));
  return { fundo: b.backgroundColor, borda: b.borderTopWidth };
});
check('botão no hover fica verde escuro, sem o #C36 do tema', cores.fundo === 'rgb(23, 138, 67)' && cores.borda === '0px', JSON.stringify(cores));

// Sem vão entre botão e painel.
const vao = await page.evaluate(() => {
  const p = document.querySelector('.debony-whatsapp__painel').getBoundingClientRect();
  const b = document.querySelector('.debony-whatsapp__botao').getBoundingClientRect();
  return b.top - p.bottom;
});
check('painel encosta no botão (ponte sem vão)', Math.abs(vao) < 1, `${vao.toFixed(2)}px`);

// Caminho do botão até o último "Ligar", subindo reto: não pode fechar no meio.
const ultimoLigar = '.debony-whatsapp__item:last-child .debony-whatsapp__acao--ligar';
const alvoLigar = await centro(page, ultimoLigar);
await page.mouse.move(alvoLigar.x, alvoLigar.y, { steps: 20 });
await esperar(400);
e = await estado(page);
check('mouse vai do botão ao painel sem fechar', e.aberto && e.visivel, JSON.stringify(e));

const hoverLigar = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, ultimoLigar);
check('"Ligar" no hover escurece o azul', hoverLigar === 'rgb(3, 16, 192)', hoverLigar);

// Primeiro "WhatsApp" em diagonal.
const alvoWhats = await centro(page, '.debony-whatsapp__acao--whatsapp');
await page.mouse.move(alvoWhats.x, alvoWhats.y, { steps: 15 });
await esperar(300);
e = await estado(page);
check('continua aberto sobre o botão WhatsApp', e.aberto && e.visivel);
await print(page, 'whatsapp-hover-acao-1920');

// Sair fecha.
await page.mouse.move(300, 300, { steps: 5 });
await esperar(600);
e = await estado(page);
check('sair com o mouse fecha', !e.aberto && e.escondido && e.expanded === 'false', JSON.stringify(e));

// Clique fixa, mostra o X e sobrevive à saída do mouse.
await page.mouse.move(botao.x, botao.y, { steps: 5 });
await page.mouse.click(botao.x, botao.y);
await page.mouse.move(300, 300, { steps: 5 });
await esperar(600);
e = await estado(page);
const x = await page.evaluate(() => ({
  abrir: getComputedStyle(document.querySelector('.debony-whatsapp__icone-abrir')).display,
  fechar: getComputedStyle(document.querySelector('.debony-whatsapp__icone-fechar')).display,
}));
check('clique fixa o painel aberto fora do hover', e.aberto && e.fixo && e.visivel, JSON.stringify(e));
check('fixado, o ícone vira X', x.abrir === 'none' && x.fechar === 'flex', JSON.stringify(x));
await print(page, 'whatsapp-fixo-1920');

// Clique fora fecha.
await page.mouse.click(300, 300);
await esperar(400);
e = await estado(page);
check('clique fora fecha', !e.aberto && e.escondido);

// Segundo clique no botão fecha, mesmo com o mouse em cima.
await page.mouse.click(botao.x, botao.y);
await esperar(300);
await page.mouse.click(botao.x, botao.y);
await esperar(400);
e = await estado(page);
check('segundo clique no botão fecha', !e.aberto && e.escondido && e.expanded === 'false', JSON.stringify(e));
await page.mouse.move(300, 300, { steps: 5 });
await esperar(400);

// Colunas: "Ligar" alinhado à direita em todas as linhas, e nada quebrou de linha no computador.
const colunas = await page.evaluate(() => {
  document.querySelector('.debony-whatsapp').setAttribute('data-aberto', '');
  const itens = [...document.querySelectorAll('.debony-whatsapp__item')];
  const direitas = itens.map((li) => Math.round(li.querySelector('.debony-whatsapp__acao--ligar').getBoundingClientRect().right));
  const quebrou = itens.some((li) => {
    const n = li.querySelector('.debony-whatsapp__numero').getBoundingClientRect();
    const a = li.querySelector('.debony-whatsapp__acoes').getBoundingClientRect();
    return a.top >= n.bottom - 1;
  });
  return { direitas, quebrou };
});
check('"Ligar" na mesma coluna e sem quebra de linha no computador',
  new Set(colunas.direitas).size === 1 && !colunas.quebrou, JSON.stringify(colunas));

// Contraste de todo texto do painel sobre o fundo real.
const contrastes = await page.evaluate(() => {
  const fundoDe = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return 'rgb(255, 255, 255)';
  };
  return [
    '.debony-whatsapp__titulo',
    '.debony-whatsapp__unidade-nome',
    '.debony-whatsapp__numero',
    '.debony-whatsapp__nota',
    '.debony-whatsapp__acao--ligar span',
    '.debony-whatsapp__acao--whatsapp span',
  ].map((s) => {
    const el = document.querySelector(s);
    return { s, cor: getComputedStyle(el).color, fundo: fundoDe(el) };
  });
});
await page.evaluate(() => document.querySelector('.debony-whatsapp').removeAttribute('data-aberto'));
const baixos = contrastes
  .map((c) => ({ ...c, r: razao(luminancia(rgb(c.cor)), luminancia(rgb(c.fundo))) }))
  .filter((c) => c.r < 4.5);
check('todo texto do painel com contraste ≥ 4,5:1', baixos.length === 0,
  baixos.map((c) => `${c.s} ${c.r.toFixed(2)}`).join(', ') || contrastes.map((c) => razao(luminancia(rgb(c.cor)), luminancia(rgb(c.fundo))).toFixed(1)).join(' / '));

// Teclado.
await page.focus('.debony-whatsapp__botao');
await page.keyboard.press('Enter');
await esperar(300);
e = await estado(page);
check('Enter no botão abre', e.aberto && e.visivel && e.expanded === 'true');
await page.keyboard.press('Tab');
const focado = await page.evaluate(() => document.activeElement?.className ?? '');
check('Tab entra no painel pelo primeiro WhatsApp', focado.includes('debony-whatsapp__acao--whatsapp'), focado);
const anel = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
check('foco do teclado visível nos botões do painel', anel === 'solid', anel);
await page.keyboard.press('Escape');
await esperar(300);
e = await estado(page);
const focoVoltou = await page.evaluate(() => document.activeElement?.classList.contains('debony-whatsapp__botao'));
check('Esc fecha e devolve o foco ao botão', !e.aberto && e.escondido && focoVoltou, JSON.stringify({ ...e, focoVoltou }));

// Tab para fora fecha: Shift+Tab a partir do botão sai do componente.
await page.keyboard.press('Enter');
await esperar(200);
await page.keyboard.down('Shift');
await page.keyboard.press('Tab');
await page.keyboard.up('Shift');
await esperar(400);
e = await estado(page);
check('foco saindo do componente fecha', !e.aberto, JSON.stringify(e));
await page.close();

// --- lightbox por cima --------------------------------------------------------
page = await abrir('certificados/', { width: 1366, height: 768 });
await page.click('a[data-debony-lightbox="yes"]');
await esperar(500);
const coberto = await page.evaluate(() => {
  const r = document.querySelector('.debony-whatsapp__botao').getBoundingClientRect();
  const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !topo?.closest('.debony-whatsapp') && !!topo?.closest('.debony-lightbox');
});
check('lightbox aberto cobre o botão', coberto);
await page.close();

// --- celular ------------------------------------------------------------------
for (const largura of [390, 360]) {
  page = await abrir('', { width: largura, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const b = await centro(page, '.debony-whatsapp__botao');
  await page.touchscreen.tap(b.x, b.y);
  await esperar(400);
  e = await estado(page);
  check(`${largura}px: toque abre e fixa (com X)`, e.aberto && e.fixo && e.visivel, JSON.stringify(e));
  await print(page, `whatsapp-celular-${largura}`);

  const medidas = await page.evaluate(() => {
    const cartao = document.querySelector('.debony-whatsapp__cartao').getBoundingClientRect();
    const acoes = [...document.querySelectorAll('.debony-whatsapp__acao')].map((a) => a.getBoundingClientRect());
    return {
      dentro: cartao.left >= 0 && cartao.right <= innerWidth && cartao.top >= 0,
      menorAlvo: Math.min(...acoes.map((a) => Math.min(a.width, a.height))),
      acoesDentro: acoes.every((a) => a.left >= cartao.left && a.right <= cartao.right),
      rolagemLateral: document.documentElement.scrollWidth > innerWidth,
    };
  });
  check(`${largura}px: painel e botões dentro da tela, alvos ≥ 24px`,
    medidas.dentro && medidas.acoesDentro && medidas.menorAlvo >= 24 && !medidas.rolagemLateral, JSON.stringify(medidas));

  // O primeiro toque num link não pode fechar o painel antes de o link ser seguido.
  const toqueLink = await page.evaluate(() => {
    const a = document.querySelector('.debony-whatsapp__acao--ligar');
    let seguido = false;
    a.addEventListener('click', (ev) => { seguido = true; ev.preventDefault(); }, { once: true });
    return new Promise((resolve) => {
      const r = a.getBoundingClientRect();
      window.__alvo = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      window.__seguido = () => seguido;
      resolve(window.__alvo);
    });
  });
  await page.touchscreen.tap(toqueLink.x, toqueLink.y);
  await esperar(300);
  const seguido = await page.evaluate(() => window.__seguido());
  check(`${largura}px: toque em "Ligar" chega ao link`, seguido);

  await page.touchscreen.tap(20, 200);
  await esperar(400);
  e = await estado(page);
  check(`${largura}px: toque fora fecha`, !e.aberto && e.escondido, JSON.stringify(e));
  await page.close();
}

await browser.close();
const falhas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`);
process.exitCode = falhas === 0 ? 0 : 1;
