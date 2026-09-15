/**
 * Teste do menu do cabeçalho num Chrome real.
 *
 * Cobre os defeitos que só apareceram medindo, e que um print não mostraria:
 * - horizontal a partir de 1025px, numa linha, sem encostar na logo nem no botão;
 * - hambúrguer até 1024px, abrindo o menu vertical no toque;
 * - nenhum item mudando de largura no hover (o menu inteiro "pulava" 12–24px);
 * - submenu "Sobre nós" alcançável pelo mouse, inclusive em diagonal;
 * - submenu sem texto cortado e navegável pelo teclado.
 *
 * Uso: node tools/test-menu.mjs [baseUrl]   (servidor local apontando para site/)
 */

import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8905').replace(/\/$/, '');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const MENU = '[data-debony="menu-horizontal"]';

const resultados = [];
const check = (nome, ok, detalhe = '') => {
  resultados.push(ok);
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function abrir(largura, extra = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: largura, height: 900, ...extra });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => document.querySelector('.cky-consent-container')?.remove());
  await new Promise((r) => setTimeout(r, 500));
  return page;
}

// --- layout por largura -----------------------------------------------------
for (const largura of [1920, 1366, 1280, 1100, 1025, 1024, 768, 390]) {
  const page = await abrir(largura);
  const r = await page.evaluate((MENU) => {
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const nav = document.querySelector(MENU);
    const itens = [...nav.querySelectorAll(':scope > ul > li > a')].filter(vis);
    const logo = document.querySelector('.elementor-element-9c44feb').getBoundingClientRect();
    const botao = document.querySelector('.elementor-element-2f8444d').getBoundingClientRect();
    return {
      horizontal: vis(nav),
      hamburguer: vis(document.querySelector('.elementor-element-265527d .elementor-menu-toggle')),
      linhas: new Set(itens.map((a) => Math.round(a.getBoundingClientRect().top))).size,
      folgaLogo: itens[0] ? Math.round(itens[0].getBoundingClientRect().left - logo.right) : null,
      folgaBotao: itens.at(-1) ? Math.round(botao.left - itens.at(-1).getBoundingClientRect().right) : null,
      vaza: document.documentElement.scrollWidth > innerWidth,
    };
  }, MENU);

  if (largura >= 1025) {
    check(
      `${largura}px menu horizontal numa linha, sem encostar`,
      r.horizontal && !r.hamburguer && r.linhas === 1 && r.folgaLogo > 0 && r.folgaBotao >= 0 && !r.vaza,
      `folga logo ${r.folgaLogo}px, botão ${r.folgaBotao}px`,
    );
  } else {
    check(`${largura}px hambúrguer no lugar do menu horizontal`, !r.horizontal && r.hamburguer && !r.vaza);
  }
  await page.close();
}

// --- hover: nada muda de largura, submenu sem corte --------------------------
for (const largura of [1920, 1100, 1025]) {
  const page = await abrir(largura);
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const ids = async (sel) => (await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: sel })).nodeIds;

  const larguras = () =>
    page.evaluate((MENU) => [...document.querySelectorAll(`${MENU} > ul > li`)].map((li) => li.getBoundingClientRect().width), MENU);
  const antes = await larguras();
  let salto = 0;
  for (const id of await ids(`${MENU} > ul > li > a`)) {
    await cdp.send('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: ['hover'] });
    const agora = await larguras();
    salto = Math.max(salto, ...agora.map((v, i) => Math.abs(v - antes[i])));
    await cdp.send('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: [] });
  }
  check(`${largura}px nenhum item muda de largura no hover`, salto < 0.5, `maior variação ${salto.toFixed(1)}px`);

  const [pai] = await ids(`${MENU} .menu-item-has-children`);
  await cdp.send('CSS.forcePseudoState', { nodeId: pai, forcedPseudoClasses: ['hover'] });
  const cortados = await page.evaluate(
    (MENU) => [...document.querySelectorAll(`${MENU} .sub-menu a`)].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent.trim()),
    MENU,
  );
  check(`${largura}px submenu sem texto cortado`, cortados.length === 0, cortados.join(', '));
  await page.close();
}

// --- submenu pelo mouse, em diagonal ----------------------------------------
for (const largura of [1920, 1100, 1025]) {
  const page = await abrir(largura);
  let acertos = 0;
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(10, 600, { steps: 5 });
    await new Promise((r) => setTimeout(r, 200));
    const item = await (await page.$(`${MENU} .menu-item-has-children > a`)).boundingBox();
    // Movimento gradual: o hover de um mouse real, não um salto de ponto a ponto.
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 12 });
    await new Promise((r) => setTimeout(r, 200));
    const quemSomos = await (await page.$(`${MENU} .sub-menu a`)).boundingBox();
    const alvo = { x: quemSomos.x + 20, y: quemSomos.y + quemSomos.height / 2 };
    await page.mouse.move(alvo.x, alvo.y, { steps: 15 });
    await new Promise((r) => setTimeout(r, 200));
    const sob = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.textContent.trim(), alvo);
    if (sob === 'Quem somos') acertos++;
  }
  check(`${largura}px mouse chega em "Quem somos" em diagonal`, acertos === 3, `${acertos}/3`);
  await page.close();
}

// --- teclado -----------------------------------------------------------------
{
  const page = await abrir(1920);
  await page.focus(`${MENU} .menu-item-has-children > a`);
  const aberto = await page.evaluate((MENU) => getComputedStyle(document.querySelector(`${MENU} .sub-menu`)).display !== 'none', MENU);
  await page.keyboard.press('Tab');
  const foco = await page.evaluate(() => document.activeElement.textContent.trim());
  check('teclado abre o submenu e o Tab entra nele', aberto && foco === 'Quem somos', `foco em "${foco}"`);
  await page.close();
}

// --- celular -----------------------------------------------------------------
{
  const page = await abrir(390, { height: 844, isMobile: true, hasTouch: true });
  await page.tap('.elementor-element-265527d .elementor-menu-toggle');
  await new Promise((r) => setTimeout(r, 800));
  const links = await page.evaluate(
    () => [...document.querySelectorAll('.elementor-element-265527d nav.elementor-nav-menu--dropdown > ul > li > a')].filter((a) => a.getBoundingClientRect().height > 0).length,
  );
  check('celular: toque no hambúrguer abre o menu vertical', links === 6, `${links} links`);
  await page.close();
}

await browser.close();
const falhas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`);
process.exitCode = falhas === 0 ? 0 : 1;
