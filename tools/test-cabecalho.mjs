/**
 * Teste do cabeçalho fixo num Chrome real: fundo e contraste com a seção de trás.
 *
 * Para cada tipo de fundo encontrado no site (cor clara, azul, quase preto, foto
 * de fundo, slideshow e vídeo do YouTube), rola até o cabeçalho ficar sobre a
 * seção e confere:
 * - o modo detectado (claro/escuro);
 * - as cores: texto do menu e sublinhado preto/branco, logo azul/branca, botão
 *   azul/branco — e só essas;
 * - o contraste real do texto contra o fundo final (cabeçalho translúcido sobre
 *   a luminância medida da seção), exigindo 4,5:1 (WCAG AA).
 * Também: botão no hover sobre fundo escuro, hambúrguer no celular e a ausência
 * do salto de 24px que o .sticky antigo causava.
 *
 * Uso: node tools/test-cabecalho.mjs [baseUrl] [pastaDosPrints]
 */

import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8905').replace(/\/$/, '') + '/';
const PRINTS = process.argv[3];
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const HEADER = '.elementor-element-2f0ffc7';

const resultados = [];
const check = (nome, ok, detalhe = '') => {
  resultados.push(ok);
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

const PRETO = 'rgb(28, 28, 28)';
const BRANCO = 'rgb(255, 255, 255)';
const AZUL = 'rgb(5, 23, 245)';

const luminancia = ([r, g, b]) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const razao = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const numeros = (s) => s.match(/[\d.]+/g).map(Number);

async function abrir(pagina, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(BASE + pagina, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => document.querySelector('.cky-consent-container')?.remove());
  // Conteúdo acima termina de carregar e desloca as seções: rolar antes disso
  // põe o cabeçalho sobre outra seção.
  await new Promise((r) => setTimeout(r, 2500));
  return page;
}

/**
 * Rola até o meio do cabeçalho ficar numa fração da altura da seção.
 *
 * Em duas passadas: imagens com carregamento tardio perto da nova posição só
 * entram depois da rolagem e deslocam as seções — no celular a seção azul da
 * home, com 126px, saía de baixo do cabeçalho. A segunda passada realinha.
 */
async function posicionar(page, seletor, fracao) {
  const alinhar = () => page.evaluate(({ HEADER, seletor, fracao }) => {
    if (seletor === 'topo') { window.scrollTo(0, 0); return true; }
    const el = document.querySelector(seletor);
    if (!el) return false;
    const h = document.querySelector(HEADER).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    window.scrollTo(0, r.top + scrollY + r.height * fracao - (h.top + h.height / 2));
    return true;
  }, { HEADER, seletor, fracao });
  if (!(await alinhar())) return false;
  await new Promise((r) => setTimeout(r, 1500));
  await alinhar();
  await new Promise((r) => setTimeout(r, 1500));
  return true;
}

// [página, seção, fração da altura, rótulo, modo esperado, altura da janela]
const CASOS = [
  ['', 'topo', 0, 'home: topo (slider branco com fotos em círculo)', 'claro'],
  ['', '[data-id="2c59f96"]', 0.5, 'home: seção branca', 'claro'],
  ['', '[data-id="18074a2"]', 0.75, 'home: slideshow de fotos (parte escura)', 'escuro'],
  ['', '[data-id="4445441"]', 0.5, 'home: seção azul', 'escuro'],
  // A seção fica no fim da página: com 900px de janela a rolagem não a alcança.
  ['sobre-nos/', '[data-id="0033047"]', 0.5, 'sobre-nos: seção #1C1C1C', 'escuro', 360],
  ['servicos/', '[data-id="c90bdb2"]', 0.4, 'serviços: foto de fundo escura', 'escuro'],
  ['servicos/', '[data-id="8538278"]', 0.5, 'serviços: seção #F9F9FA', 'claro'],
  ['estrutura/', '[data-id="645deff"]', 0.4, 'estrutura: foto de fundo clara', 'claro'],
  ['qualidade/', '[data-id="4eb8677"]', 0.3, 'qualidade: vídeo de fundo (YouTube)', 'escuro'],
];

for (const [pagina, secao, fracao, rotulo, esperado, altura = 900] of CASOS) {
  const page = await abrir(pagina, { width: 1920, height: altura });
  if (!(await posicionar(page, secao, fracao))) {
    check(rotulo, false, 'seção não encontrada');
    await page.close();
    continue;
  }

  const r = await page.evaluate((HEADER) => {
    const h = document.querySelector(HEADER);
    const item = document.querySelector('[data-debony="menu-horizontal"] a.elementor-item:not(.elementor-item-active)');
    const botao = document.querySelector('.elementor-element-2f8444d .elementor-button');
    const antes = getComputedStyle(item, '::after');
    return {
      modo: h.dataset.contraste,
      media: h.dataset.luminancia,
      pontos: h.dataset.pontos,
      fundoHeader: getComputedStyle(h).backgroundColor,
      texto: getComputedStyle(item).color,
      sublinhado: antes.backgroundColor,
      logo: getComputedStyle(document.querySelector('.elementor-element-9c44feb img')).filter,
      botao: getComputedStyle(botao).color,
      borda: getComputedStyle(botao).borderTopColor,
      scrollY: Math.round(scrollY),
    };
  }, HEADER);

  const [hr, hg, hb, ha = 1] = numeros(r.fundoHeader);
  const fundoFinal = parseFloat(r.media) * (1 - ha) + luminancia([hr, hg, hb]) * ha;
  const contraste = razao(luminancia(numeros(r.texto)), fundoFinal);

  const cores = r.modo === 'escuro'
    ? r.texto === BRANCO && r.sublinhado === BRANCO && r.logo.includes('invert') && r.botao === BRANCO && r.borda === BRANCO
    : r.texto === PRETO && r.sublinhado === PRETO && r.logo === 'none' && r.botao === AZUL && r.borda === AZUL;

  check(
    rotulo,
    r.modo === esperado && cores && contraste >= 4.5,
    `${r.modo} (esperado ${esperado}), luminância ${r.media} [${r.pontos}], contraste ${contraste.toFixed(1)}:1${cores ? '' : ' — CORES ERRADAS: texto ' + r.texto + ', sublinhado ' + r.sublinhado + ', botão ' + r.botao}`,
  );

  if (PRINTS) {
    const nome = secao === 'topo' ? 'topo' : `${pagina.replace(/\/$/, '') || 'home'}-${secao.match(/"(\w+)"/)[1]}`;
    await page.screenshot({ path: `${PRINTS}/cabecalho-${nome}.png`, clip: { x: 0, y: r.scrollY, width: 1920, height: 110 } });
  }
  await page.close();
}

// Botão no hover sobre fundo escuro: preto sobre branco (Elementor deixaria azul).
{
  const page = await abrir('', { width: 1920, height: 900 });
  await posicionar(page, '[data-id="4445441"]', 0.5);
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.elementor-element-2f8444d .elementor-button' });
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
  const h = await page.evaluate((HEADER) => {
    const cs = getComputedStyle(document.querySelector('.elementor-element-2f8444d .elementor-button'));
    return { modo: document.querySelector(HEADER).dataset.contraste, cor: cs.color, fundo: cs.backgroundColor };
  }, HEADER);
  check('botão no hover sobre fundo escuro', h.modo === 'escuro' && h.cor === PRETO && h.fundo === BRANCO, `texto ${h.cor}, fundo ${h.fundo}`);
  await page.close();
}

// Celular: ícone do hambúrguer nos dois modos, sem o quadrado branco.
for (const [secao, esperado] of [['topo', 'claro'], ['[data-id="4445441"]', 'escuro']]) {
  const page = await abrir('', { width: 390, height: 844, isMobile: true, hasTouch: true });
  await posicionar(page, secao, 0.5);
  const m = await page.evaluate((HEADER) => {
    const t = document.querySelector('.elementor-element-265527d div.elementor-menu-toggle');
    return { modo: document.querySelector(HEADER).dataset.contraste, icone: getComputedStyle(t.querySelector('svg')).fill, fundo: getComputedStyle(t).backgroundColor };
  }, HEADER);
  const cor = esperado === 'escuro' ? BRANCO : PRETO;
  check(`celular: hambúrguer sobre fundo ${esperado}`, m.modo === esperado && m.icone === cor && m.fundo === 'rgba(0, 0, 0, 0)', `${m.modo}, ícone ${m.icone}`);
  await page.close();
}

// O .sticky antigo dava 24px de altura ao <header> externo e empurrava a página.
{
  const page = await abrir('', { width: 1920, height: 900 });
  const topo = () => page.evaluate(() => Math.round(document.querySelector('[data-id="2c59f96"]').getBoundingClientRect().top + scrollY));
  const antes = await topo();
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise((r) => setTimeout(r, 400));
  const depois = await topo();
  check('rolar além de 110px não empurra a página', antes === depois, `seção em ${antes}px → ${depois}px`);
  await page.close();
}

await browser.close();
const falhas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`);
process.exitCode = falhas === 0 ? 0 : 1;
