/**
 * Teste de fumaça do lightbox num Chrome real.
 * Uso: node tools/test-lightbox.mjs [url]
 */

import puppeteer from 'puppeteer-core';

const URL_ALVO = process.argv[2] ?? 'http://127.0.0.1:8902/certificados/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FALHOU'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});

await page.goto(URL_ALVO, { waitUntil: 'networkidle2', timeout: 60000 });

// O banner de consentimento (CookieYes) fica sobre a página e intercepta cliques.
await page.evaluate(() => {
  document.querySelector('.cky-btn-accept')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.querySelector('.cky-consent-container')?.remove();
  document.querySelector('.cky-overlay')?.remove();
});

/** O lightbox só é útil depois que o arquivo do certificado decodifica. */
const waitImageLoaded = () =>
  page.waitForFunction(
    () => {
      const img = document.querySelector('.debony-lightbox__image');
      return !!img && img.complete && img.naturalWidth > 0;
    },
    { timeout: 15000 },
  );

const triggers = await page.$$('a[data-debony-lightbox="yes"]');
const TOTAL = triggers.length;
check('há gatilhos de lightbox na página', TOTAL >= 6, `${TOTAL} encontrados`);

// --- abrir ---------------------------------------------------------------
await triggers[0].click();
await page.waitForSelector('.debony-lightbox.is-open', { visible: true, timeout: 5000 });
await waitImageLoaded();

const opened = await page.evaluate(() => {
  const box = document.querySelector('.debony-lightbox');
  const img = document.querySelector('.debony-lightbox__image');
  const close = document.querySelector('.debony-lightbox__close');
  const r = close.getBoundingClientRect();
  return {
    visivel: !box.hidden && getComputedStyle(box).opacity === '1',
    src: img.getAttribute('src'),
    carregou: img.complete && img.naturalWidth > 0,
    imgLargura: img.getBoundingClientRect().width,
    imgAltura: img.getBoundingClientRect().height,
    fecharTopo: r.top,
    fecharDireita: window.innerWidth - r.right,
    scrollTravado: getComputedStyle(document.body).overflow === 'hidden',
    focoNoFechar: document.activeElement === close,
    contador: document.querySelector('.debony-lightbox__counter').textContent,
  };
});

check('overlay abre e fica visível', opened.visivel);
check('imagem do certificado carregou', opened.carregou, opened.src?.split('/').pop());
check(
  'imagem renderiza e cabe na viewport',
  opened.imgLargura > 200 && opened.imgAltura > 200 && opened.imgAltura <= 900 && opened.imgLargura <= 1440,
  `${Math.round(opened.imgLargura)}x${Math.round(opened.imgAltura)} em 1440x900`,
);
check('"X" no canto superior direito', opened.fecharTopo < 40 && opened.fecharDireita < 40,
  `topo ${Math.round(opened.fecharTopo)}px, direita ${Math.round(opened.fecharDireita)}px`);
check('rolagem da página travada', opened.scrollTravado);
check('foco vai para o botão fechar', opened.focoNoFechar);
check(`contador mostra 1 / ${TOTAL}`, opened.contador.trim() === `1 / ${TOTAL}`, opened.contador);

// --- navegar -------------------------------------------------------------
await page.click('.debony-lightbox__nav--next');
const depoisProximo = await page.evaluate(() => ({
  contador: document.querySelector('.debony-lightbox__counter').textContent.trim(),
  src: document.querySelector('.debony-lightbox__image').getAttribute('src'),
}));
check(`seta avança para o 2 / ${TOTAL}`, depoisProximo.contador === `2 / ${TOTAL}`, depoisProximo.contador);
check('imagem muda ao navegar', depoisProximo.src !== opened.src);

await page.keyboard.press('ArrowLeft');
const depoisEsquerda = await page.evaluate(() =>
  document.querySelector('.debony-lightbox__counter').textContent.trim(),
);
check(`seta do teclado volta para 1 / ${TOTAL}`, depoisEsquerda === `1 / ${TOTAL}`, depoisEsquerda);

// --- fechar pelo X -------------------------------------------------------
await page.click('.debony-lightbox__close');
const depoisFechar = await page.evaluate(() => ({
  escondido: getComputedStyle(document.querySelector('.debony-lightbox')).display === 'none',
  scrollLivre: getComputedStyle(document.body).overflow !== 'hidden',
  focoVoltou: document.activeElement?.matches('a[data-debony-lightbox="yes"]') ?? false,
  // O overlay fechado não pode continuar capturando cliques da página.
  pontoLivre: !document
    .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    ?.closest('.debony-lightbox'),
}));
check('"X" fecha o lightbox', depoisFechar.escondido);
check('página volta a receber cliques', depoisFechar.pontoLivre);
check('rolagem liberada ao fechar', depoisFechar.scrollLivre);
check('foco volta para a miniatura', depoisFechar.focoVoltou);

// --- fechar por ESC e por clique fora ------------------------------------
await (await page.$$('a[data-debony-lightbox="yes"]'))[2].click();
await page.waitForSelector('.debony-lightbox.is-open', { visible: true, timeout: 5000 });
await page.keyboard.press('Escape');
check('ESC fecha', await page.evaluate(
  () => getComputedStyle(document.querySelector('.debony-lightbox')).display === 'none',
));

await (await page.$$('a[data-debony-lightbox="yes"]'))[3].click();
await page.waitForSelector('.debony-lightbox.is-open', { visible: true, timeout: 5000 });
await page.mouse.click(12, 450); // fundo, longe da figura
check('clique no fundo fecha', await page.evaluate(
  () => getComputedStyle(document.querySelector('.debony-lightbox')).display === 'none',
));

// --- ícone de lupa --------------------------------------------------------
// Cobertura própria: o href da lupa vinha do Elementor como base64 dentro de
// `#elementor-action`, e clicar não abria nada. Os cliques acima usam links de
// imagem e não pegariam essa regressão.
const lupas = await page.$$('a.elementor-icon[data-debony-lightbox="yes"]');
check('ícones de lupa viraram gatilho', lupas.length > 0, `${lupas.length} encontrados`);

if (lupas.length > 0) {
  await lupas[0].click();
  await page.waitForSelector('.debony-lightbox.is-open', { visible: true, timeout: 5000 });
  await waitImageLoaded();

  const pelaLupa = await page.evaluate(() => {
    const img = document.querySelector('.debony-lightbox__image');
    return {
      src: img.getAttribute('src'),
      carregou: img.complete && img.naturalWidth > 0,
      largura: Math.round(img.getBoundingClientRect().width),
    };
  });
  check('lupa abre e carrega a imagem', pelaLupa.carregou && pelaLupa.largura > 200,
    `${pelaLupa.src?.split('/').pop()} (${pelaLupa.largura}px)`);

  await page.keyboard.press('Escape');
}

// --- higiene da página ---------------------------------------------------
const relevantes = [
  ...new Set(
    failedRequests
      .filter((u) => !/google|gstatic|facebook|analytics|gtag/i.test(u))
      .map((u) => u.replace(/^\d+\s+/, '').replace(/\s+net::.*$/, '').split('?')[0]),
  ),
];
check('sem requisição quebrada', relevantes.length === 0, `${relevantes.length} URL(s)`);
if (relevantes.length) {
  console.log('\n  URLs com 404:');
  for (const u of relevantes) console.log(`    ${new URL(u).pathname}`);
  console.log('');
}
check('sem erro de console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const falhas = results.filter((r) => !r.pass);
console.log(`\n${results.length - falhas.length}/${results.length} verificações passaram`);
process.exit(falhas.length === 0 ? 0 : 1);
