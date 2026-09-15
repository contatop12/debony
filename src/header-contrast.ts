import { onReady } from './dom';

/**
 * Contraste do cabeçalho fixo com a seção que está por trás dele.
 *
 * O cabeçalho ganhou fundo translúcido, e texto, logo e botão alternam entre
 * branco (sobre fundo escuro) e preto/azul (sobre fundo claro). A decisão sai do
 * que é pintado atrás do cabeçalho em vários pontos ao longo da largura: cor de
 * fundo, imagem de fundo, slideshow, vídeo ou mídia que ocupa a faixa.
 *
 * Cor sozinha não basta: há seções com foto, slideshow e vídeo. Para essas a
 * luminosidade é medida nos pixels da própria faixa atrás do cabeçalho — as
 * imagens são do mesmo domínio, então o canvas pode lê-las.
 */

const HEADER = '.elementor-element-2f0ffc7';
// Nada disso é "fundo da seção": o próprio cabeçalho, banner de cookies e lightbox.
const IGNORAR = '[data-elementor-type="header"], .cky-consent-container, .cky-modal, .debony-lightbox';
const PONTOS_X = [0.08, 0.24, 0.4, 0.56, 0.72, 0.88];

/**
 * Luminância em que texto branco e preto dão o mesmo contraste pela fórmula do
 * WCAG: 1,05 / (L + 0,05) = (L + 0,05) / 0,05  →  L ≈ 0,179.
 * A histerese evita piscar quando a média fica perto do limiar.
 */
const LIMIAR = 0.179;
const HISTERESE = 0.03;

/**
 * Vídeo cujo quadro não dá para ler — o de /qualidade/ é YouTube, em iframe de
 * outro domínio — é tratado como escuro, o caso típico de vídeo de fábrica. Sem
 * isso o detector atravessava o vídeo, achava o branco da página e deixava o
 * cabeçalho claro por cima dele.
 */
const LUMINANCIA_VIDEO = 0.1;
const INTERVALO_MIN_MS = 80;

type Modo = 'claro' | 'escuro';
type Rgba = [number, number, number, number];
interface Camada {
  luminancia: number;
  alfa: number;
}

// ---------------------------------------------------------------------------
// Cor e luminância

function canal(valor: number): number {
  const s = valor / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminancia(r: number, g: number, b: number): number {
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function lerCor(css: string): Rgba | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(css);
  if (!m) return null;
  const alfaBruto = m[4];
  const alfa = alfaBruto === undefined ? 1 : alfaBruto.endsWith('%') ? parseFloat(alfaBruto) / 100 : parseFloat(alfaBruto);
  return [Number(m[1]), Number(m[2]), Number(m[3]), alfa];
}

/** Aplica as camadas translúcidas (de cima para baixo) sobre a luminância da base. */
function compor(base: number, sobreposicoes: Camada[]): number {
  let l = base;
  for (let i = sobreposicoes.length - 1; i >= 0; i--) {
    const c = sobreposicoes[i]!;
    l = l * (1 - c.alfa) + c.luminancia * c.alfa;
  }
  return l;
}

// ---------------------------------------------------------------------------
// Amostragem de pixels

const canvas = document.createElement('canvas');
canvas.width = 8;
canvas.height = 4;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const imagens = new Map<string, HTMLImageElement>();

/** Imagem pronta para leitura, ou null enquanto carrega (reavalia ao terminar). */
function imagemPronta(url: string): HTMLImageElement | null {
  let img = imagens.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', agendar, { once: true });
    img.src = url;
    imagens.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

function porcentagemOuPx(valor: string | undefined, espacoLivre: number): number {
  if (!valor) return espacoLivre / 2;
  if (valor.endsWith('%')) return (espacoLivre * parseFloat(valor)) / 100;
  if (valor.endsWith('px')) return parseFloat(valor);
  return espacoLivre / 2;
}

/**
 * Onde a imagem é desenhada dentro da caixa do elemento (coordenadas locais),
 * para background-size/position ou object-fit/position.
 */
function retanguloDesenhado(
  caixaW: number,
  caixaH: number,
  imgW: number,
  imgH: number,
  ajuste: string,
  posicao: string,
): Retangulo {
  let w = imgW;
  let h = imgH;
  if (ajuste === 'cover' || ajuste === 'contain' || ajuste === 'scale-down') {
    const escala =
      ajuste === 'cover'
        ? Math.max(caixaW / imgW, caixaH / imgH)
        : Math.min(caixaW / imgW, caixaH / imgH, ajuste === 'scale-down' ? 1 : Infinity);
    w = imgW * escala;
    h = imgH * escala;
  } else if (ajuste === 'fill' || ajuste === '100% 100%') {
    w = caixaW;
    h = caixaH;
  }
  const [px, py] = posicao.split(/\s+/);
  return { x: porcentagemOuPx(px, caixaW - w), y: porcentagemOuPx(py, caixaH - h), w, h };
}

/**
 * Luminância média da parte da imagem que fica sob a faixa do cabeçalho, em torno
 * do ponto x. null se não der para ler (carregando, fora do desenho, canvas bloqueado).
 */
function luminanciaSobFaixa(
  fonte: CanvasImageSource,
  fonteW: number,
  fonteH: number,
  caixa: DOMRect,
  desenho: Retangulo,
  x: number,
  faixa: DOMRect,
): number | null {
  if (!ctx || fonteW === 0 || fonteH === 0 || desenho.w === 0 || desenho.h === 0) return null;
  const meiaLargura = faixa.width * 0.06;
  // Viewport → caixa local → coordenadas da imagem.
  const paraImgX = (vx: number) => ((vx - caixa.left - desenho.x) / desenho.w) * fonteW;
  const paraImgY = (vy: number) => ((vy - caixa.top - desenho.y) / desenho.h) * fonteH;
  const sx = Math.max(0, paraImgX(x - meiaLargura));
  const ex = Math.min(fonteW, paraImgX(x + meiaLargura));
  const sy = Math.max(0, paraImgY(faixa.top));
  const ey = Math.min(fonteH, paraImgY(faixa.bottom));
  if (ex - sx < 1 || ey - sy < 1) return null;

  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fonte, sx, sy, ex - sx, ey - sy, 0, 0, canvas.width, canvas.height);
    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let soma = 0;
    let n = 0;
    for (let i = 0; i < dados.length; i += 4) {
      const a = dados[i + 3]! / 255;
      // Pixel transparente mostra a página (branca) por trás.
      soma += luminancia(dados[i]!, dados[i + 1]!, dados[i + 2]!) * a + 1 * (1 - a);
      n++;
    }
    return n ? soma / n : null;
  } catch {
    return null; // canvas bloqueado por imagem de outra origem
  }
}

function urlDoFundo(backgroundImage: string): string | null {
  return /url\(["']?([^"')]+)["']?\)/.exec(backgroundImage)?.[1] ?? null;
}

function luminanciaDeFundo(el: Element, cs: CSSStyleDeclaration, x: number, faixa: DOMRect): number | null {
  const url = urlDoFundo(cs.backgroundImage);
  if (!url) return null;
  const img = imagemPronta(url);
  if (!img) return null;
  const caixa = el.getBoundingClientRect();
  const ajuste = cs.backgroundSize.split(',')[0]!.trim();
  const posicao = cs.backgroundPosition.split(',')[0]!.trim();
  const desenho = retanguloDesenhado(caixa.width, caixa.height, img.naturalWidth, img.naturalHeight, ajuste, posicao);
  return luminanciaSobFaixa(img, img.naturalWidth, img.naturalHeight, caixa, desenho, x, faixa);
}

function luminanciaDeMidia(el: HTMLImageElement | HTMLVideoElement, x: number, faixa: DOMRect): number | null {
  const cs = getComputedStyle(el);
  const caixa = el.getBoundingClientRect();
  const w = el instanceof HTMLImageElement ? el.naturalWidth : el.videoWidth;
  const h = el instanceof HTMLImageElement ? el.naturalHeight : el.videoHeight;
  if (el instanceof HTMLImageElement && !(el.complete && w > 0)) return null;
  const desenho = retanguloDesenhado(caixa.width, caixa.height, w, h, cs.objectFit, cs.objectPosition);
  return luminanciaSobFaixa(el, w, h, caixa, desenho, x, faixa);
}

// ---------------------------------------------------------------------------
// O que está pintado atrás de um ponto

function alfaEfetivo(cs: CSSStyleDeclaration, cor: Rgba): number {
  return cor[3] * parseFloat(cs.opacity || '1');
}

/**
 * Camada de fundo do Elementor pertencente a um container. Em containers "boxed"
 * ela pode estar dentro de .e-con-inner, que é a caixa de conteúdo centralizada,
 * mas cobrir a seção inteira. Em /qualidade/ o vídeo fica assim: procurando só
 * nos filhos diretos, os pontos das pontas (fora da caixa centralizada)
 * atravessavam o vídeo e liam o branco da página.
 */
function camadaDoContainer<T extends Element>(el: Element, classe: string): T | null {
  return el.querySelector<T>(`:scope > ${classe}, :scope > .e-con-inner > ${classe}`);
}

/**
 * Luminância vista atrás do cabeçalho no ponto (x, y). Percorre a pilha de
 * elementos de cima para baixo até achar uma camada opaca, acumulando as
 * translúcidas (overlays) para compor por cima.
 */
function amostrarPonto(x: number, y: number, faixa: DOMRect): number | null {
  const sobreposicoes: Camada[] = [];

  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest(IGNORAR)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      const l = luminanciaDeMidia(el, x, faixa);
      if (l !== null) return compor(l, sobreposicoes);
      if (el instanceof HTMLVideoElement) return compor(LUMINANCIA_VIDEO, sobreposicoes);
      continue;
    }

    // Camadas de fundo do Elementor com pointer-events: none não entram na
    // pilha: são lidas a partir do container que as contém.
    const antes = getComputedStyle(el, '::before');
    if (antes.content !== 'none') {
      const cor = lerCor(antes.backgroundColor);
      if (cor) {
        const a = alfaEfetivo(antes, cor);
        if (a > 0.05) sobreposicoes.push({ luminancia: luminancia(cor[0], cor[1], cor[2]), alfa: Math.min(a, 1) });
      }
    }
    const overlay = camadaDoContainer(el, '.elementor-background-overlay');
    if (overlay) {
      const ocs = getComputedStyle(overlay);
      const cor = lerCor(ocs.backgroundColor);
      if (cor) {
        const a = alfaEfetivo(ocs, cor);
        if (a > 0.05) sobreposicoes.push({ luminancia: luminancia(cor[0], cor[1], cor[2]), alfa: Math.min(a, 1) });
      }
    }

    const slideshow = camadaDoContainer(el, '.elementor-background-slideshow');
    const slideAtivo = [...(slideshow?.querySelectorAll('.elementor-background-slideshow__slide__image') ?? [])]
      .find((s) => {
        const r = s.getBoundingClientRect();
        return r.left <= x && x <= r.right && parseFloat(getComputedStyle(s.parentElement ?? s).opacity) > 0.5;
      });
    if (slideAtivo) {
      const l = luminanciaDeFundo(slideAtivo, getComputedStyle(slideAtivo), x, faixa);
      if (l !== null) return compor(l, sobreposicoes);
    }

    const videoFundo = camadaDoContainer(el, '.elementor-background-video-container');
    if (videoFundo) {
      const rv = videoFundo.getBoundingClientRect();
      if (rv.left <= x && x <= rv.right && rv.top <= y && y <= rv.bottom) {
        const video = videoFundo.querySelector('video');
        const l = video ? luminanciaDeMidia(video, x, faixa) : null;
        // YouTube e Vimeo vêm em iframe de outro domínio: pixels ilegíveis.
        return compor(l ?? LUMINANCIA_VIDEO, sobreposicoes);
      }
    }

    const lFundo = luminanciaDeFundo(el, cs, x, faixa);
    if (lFundo !== null) return compor(lFundo, sobreposicoes);

    const cor = lerCor(cs.backgroundColor);
    if (cor) {
      const a = alfaEfetivo(cs, cor);
      const l = luminancia(cor[0], cor[1], cor[2]);
      if (a >= 0.9) return compor(l, sobreposicoes);
      if (a > 0.05) sobreposicoes.push({ luminancia: l, alfa: a });
    }
  }

  // Nada opaco na pilha: aparece o fundo da página.
  const corPagina = lerCor(getComputedStyle(document.body).backgroundColor);
  const base = corPagina && corPagina[3] > 0.5 ? luminancia(corPagina[0], corPagina[1], corPagina[2]) : 1;
  return compor(base, sobreposicoes);
}

// ---------------------------------------------------------------------------
// Decisão e agendamento

function avaliar(): void {
  const header = document.querySelector<HTMLElement>(HEADER);
  if (!header) return;
  const faixa = header.getBoundingClientRect();
  if (faixa.height === 0) return;

  const y = faixa.top + faixa.height / 2;
  const valores = PONTOS_X.map((f) => amostrarPonto(faixa.left + faixa.width * f, y, faixa)).filter(
    (v): v is number => v !== null,
  );
  if (valores.length === 0) return;

  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  const atual = header.dataset['contraste'];
  let modo: Modo;
  if (atual === 'escuro') modo = media > LIMIAR + HISTERESE ? 'claro' : 'escuro';
  else if (atual === 'claro') modo = media < LIMIAR - HISTERESE ? 'escuro' : 'claro';
  else modo = media < LIMIAR ? 'escuro' : 'claro';

  // Diagnóstico: média e valor de cada ponto amostrado, legíveis no DevTools.
  header.dataset['luminancia'] = media.toFixed(3);
  header.dataset['pontos'] = valores.map((v) => v.toFixed(2)).join(' ');
  if (modo !== atual) header.dataset['contraste'] = modo;
}

let agendado = false;
let ultima = 0;

function agendar(): void {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    const espera = INTERVALO_MIN_MS - (performance.now() - ultima);
    const rodar = () => {
      agendado = false;
      ultima = performance.now();
      avaliar();
    };
    if (espera > 0) setTimeout(rodar, espera);
    else rodar();
  });
}

export function initHeaderContrast(): void {
  if (!document.querySelector(HEADER)) return;
  onReady(agendar);
  addEventListener('scroll', agendar, { passive: true });
  addEventListener('resize', agendar);
  addEventListener('load', agendar);
  // Slideshow, vídeo e o slider do topo mudam o que está atrás sem rolagem.
  setInterval(() => {
    if (!document.hidden) agendar();
  }, 1000);
}
