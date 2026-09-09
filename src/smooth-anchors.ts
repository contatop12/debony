import { $$ } from './dom';

/**
 * O mirror converte links internos em caminhos relativos; âncoras na mesma
 * página continuam como `#id` e ganham rolagem suave, respeitando quem pediu
 * menos movimento no sistema.
 */
export function initSmoothAnchors(): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  for (const link of $$<HTMLAnchorElement>('a[href^="#"]')) {
    const id = link.getAttribute('href')?.slice(1);
    if (!id) continue;

    link.addEventListener('click', (event) => {
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${id}`);
    });
  }
}
