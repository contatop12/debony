import { $$ } from './dom';

/**
 * Lightbox dos certificados.
 *
 * O mirror renomeia os links que o Elementor gera para ampliar imagem
 * (`data-elementor-open-lightbox` -> `data-debony-lightbox`), porque o lightbox
 * do Elementor Pro não roda no estático. Usamos esses mesmos links como âncora
 * — quando um certificado novo for publicado no site de origem, ele entra aqui
 * sozinho, sem tocar neste arquivo.
 */

const TRIGGER = 'a[data-debony-lightbox="yes"]';
const FOCUSABLE = 'button:not([disabled])';

interface Slide {
  src: string;
  title: string;
}

let overlay: HTMLDivElement | null = null;
let imageEl: HTMLImageElement;
let captionEl: HTMLElement;
let counterEl: HTMLElement;
let prevBtn: HTMLButtonElement;
let nextBtn: HTMLButtonElement;

let slides: Slide[] = [];
let index = 0;
let lastFocused: HTMLElement | null = null;

export function initLightbox(): void {
  const links = $$<HTMLAnchorElement>(TRIGGER);
  if (links.length === 0) return;

  slides = links.map((link) => ({
    src: link.getAttribute('href') ?? '',
    title: link.getAttribute('data-debony-lightbox-title') ?? imageAlt(link),
  }));

  links.forEach((link, i) => {
    link.setAttribute('aria-haspopup', 'dialog');
    // Captura: o handler do Elementor não chega a rodar.
    link.addEventListener(
      'click',
      (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        open(i, link);
      },
      true,
    );
  });
}

function imageAlt(link: HTMLAnchorElement): string {
  return link.querySelector('img')?.alt ?? '';
}

function open(at: number, trigger: HTMLElement): void {
  lastFocused = trigger;
  ensureOverlay();
  show(at);

  overlay!.hidden = false;
  document.body.classList.add('debony-lightbox-open');
  document.addEventListener('keydown', onKeydown, true);
  requestAnimationFrame(() => overlay!.classList.add('is-open'));

  overlay!.querySelector<HTMLButtonElement>('.debony-lightbox__close')?.focus();
}

function close(): void {
  if (!overlay || overlay.hidden) return;

  overlay.classList.remove('is-open');
  overlay.hidden = true;
  document.body.classList.remove('debony-lightbox-open');
  document.removeEventListener('keydown', onKeydown, true);

  // Devolve o foco para a miniatura que abriu o lightbox.
  lastFocused?.focus();
  lastFocused = null;
}

function show(at: number): void {
  index = (at + slides.length) % slides.length;
  const slide = slides[index];
  if (!slide) return;

  imageEl.src = slide.src;
  imageEl.alt = slide.title || 'Certificado ampliado';
  captionEl.textContent = slide.title;
  captionEl.hidden = slide.title === '';

  const many = slides.length > 1;
  prevBtn.hidden = !many;
  nextBtn.hidden = !many;
  counterEl.hidden = !many;
  counterEl.textContent = `${index + 1} / ${slides.length}`;
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      close();
      break;
    case 'ArrowLeft':
      if (slides.length > 1) show(index - 1);
      break;
    case 'ArrowRight':
      if (slides.length > 1) show(index + 1);
      break;
    case 'Tab':
      trapFocus(event);
      break;
  }
}

/** Mantém o Tab dentro do diálogo enquanto ele estiver aberto. */
function trapFocus(event: KeyboardEvent): void {
  if (!overlay) return;
  const targets = $$<HTMLElement>(FOCUSABLE, overlay).filter((el) => !el.hidden);
  if (targets.length === 0) return;

  const first = targets[0]!;
  const last = targets[targets.length - 1]!;
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function ensureOverlay(): void {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'debony-lightbox';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Certificado ampliado');

  overlay.innerHTML = `
    <button type="button" class="debony-lightbox__close" aria-label="Fechar imagem">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round"/>
      </svg>
    </button>
    <button type="button" class="debony-lightbox__nav debony-lightbox__nav--prev" aria-label="Certificado anterior">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M15 4L7 12l8 8" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button type="button" class="debony-lightbox__nav debony-lightbox__nav--next" aria-label="Próximo certificado">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 4l8 8-8 8" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <figure class="debony-lightbox__figure">
      <img class="debony-lightbox__image" alt="">
      <figcaption class="debony-lightbox__caption"></figcaption>
    </figure>
    <p class="debony-lightbox__counter" aria-hidden="true"></p>
  `;

  imageEl = overlay.querySelector<HTMLImageElement>('.debony-lightbox__image')!;
  captionEl = overlay.querySelector<HTMLElement>('.debony-lightbox__caption')!;
  counterEl = overlay.querySelector<HTMLElement>('.debony-lightbox__counter')!;
  prevBtn = overlay.querySelector<HTMLButtonElement>('.debony-lightbox__nav--prev')!;
  nextBtn = overlay.querySelector<HTMLButtonElement>('.debony-lightbox__nav--next')!;

  overlay.querySelector('.debony-lightbox__close')!.addEventListener('click', close);
  prevBtn.addEventListener('click', () => show(index - 1));
  nextBtn.addEventListener('click', () => show(index + 1));

  // Clique fora da figura fecha; clique na própria imagem, não.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.body.appendChild(overlay);
}
