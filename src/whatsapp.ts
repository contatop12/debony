/**
 * Botão flutuante de WhatsApp com os telefones das duas unidades, em todas as páginas.
 *
 * Ao passar o mouse (ou tocar, no celular, onde não há hover) abre um painel com
 * todos os números do site, cada um com "Ligar" e, quando atende no WhatsApp,
 * "WhatsApp". Os números são os do rodapé e da página de contato; lá, só o
 * (11) 5687-7566 aparece com o ícone de WhatsApp, e ele atende Debony e Joluma.
 * Para liberar o WhatsApp em outro número, basta marcar `whatsapp: true`.
 */

interface Numero {
  /** Como aparece para o visitante. */
  exibicao: string;
  /** Só dígitos, com DDI: vai para o `tel:` e para o `wa.me`. */
  digitos: string;
  whatsapp: boolean;
  nota?: string;
}

interface Unidade {
  nome: string;
  numeros: Numero[];
}

const UNIDADES: Unidade[] = [
  {
    nome: 'Debony · São Paulo',
    numeros: [
      { exibicao: '(11) 5687-7566', digitos: '551156877566', whatsapp: true, nota: 'WhatsApp das duas unidades' },
      { exibicao: '(11) 5687-7381', digitos: '551156877381', whatsapp: false },
      { exibicao: '(11) 5687-7382', digitos: '551156877382', whatsapp: false },
    ],
  },
  {
    nome: 'Joluma · Valinhos',
    numeros: [{ exibicao: '(19) 3881-3448', digitos: '551938813448', whatsapp: false }],
  },
];

const MENSAGEM = 'Olá! Vim pelo site da Debony & Joluma e gostaria de mais informações.';

/** Folga para o mouse sair do botão rumo ao painel em diagonal sem fechá-lo. */
const ATRASO_FECHAR_MS = 250;
const PAINEL_ID = 'debony-whatsapp-painel';

// Ícones do próprio site (página de contato), com a cor trocada por currentColor.
const ICONE_WHATSAPP = `<svg viewBox="0 0 20 21" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17 3.40982C16.0832 2.48374 14.9912 1.74948 13.7876 1.24987C12.5841 0.75025 11.2931 0.495276 9.99 0.499815C4.53 0.499815 0.0800002 4.94981 0.0800002 10.4098C0.0800002 12.1598 0.54 13.8598 1.4 15.3598L0 20.4998L5.25 19.1198C6.7 19.9098 8.33 20.3298 9.99 20.3298C15.45 20.3298 19.9 15.8798 19.9 10.4198C19.9 7.76981 18.87 5.27982 17 3.40982ZM9.99 18.6498C8.51 18.6498 7.06 18.2498 5.79 17.4998L5.49 17.3198L2.37 18.1398L3.2 15.0998L3 14.7898C2.17775 13.4768 1.74114 11.9591 1.74 10.4098C1.74 5.86981 5.44 2.16982 9.98 2.16982C12.18 2.16982 14.25 3.02982 15.8 4.58982C16.5675 5.35378 17.1757 6.26248 17.5894 7.26324C18.0031 8.264 18.214 9.33692 18.21 10.4198C18.23 14.9598 14.53 18.6498 9.99 18.6498ZM14.51 12.4898C14.26 12.3698 13.04 11.7698 12.82 11.6798C12.59 11.5998 12.43 11.5598 12.26 11.7998C12.09 12.0498 11.62 12.6098 11.48 12.7698C11.34 12.9398 11.19 12.9598 10.94 12.8298C10.69 12.7098 9.89 12.4398 8.95 11.5998C8.21 10.9398 7.72 10.1298 7.57 9.87982C7.43 9.62982 7.55 9.49981 7.68 9.36981C7.79 9.25982 7.93 9.07981 8.05 8.93981C8.17 8.79981 8.22 8.68981 8.3 8.52981C8.38 8.35981 8.34 8.21982 8.28 8.09982C8.22 7.97982 7.72 6.75982 7.52 6.25982C7.32 5.77982 7.11 5.83982 6.96 5.82982H6.48C6.31 5.82982 6.05 5.88982 5.82 6.13982C5.6 6.38982 4.96 6.98982 4.96 8.20982C4.96 9.42982 5.85 10.6098 5.97 10.7698C6.09 10.9398 7.72 13.4398 10.2 14.5098C10.79 14.7698 11.25 14.9198 11.61 15.0298C12.2 15.2198 12.74 15.1898 13.17 15.1298C13.65 15.0598 14.64 14.5298 14.84 13.9498C15.05 13.3698 15.05 12.8798 14.98 12.7698C14.91 12.6598 14.76 12.6098 14.51 12.4898Z"/></svg>`;

const ICONE_TELEFONE = `<svg viewBox="0 0 20 19" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M2.48303 0.792808C3.70003 -0.417192 5.70403 -0.202191 6.72303 1.15981L7.98503 2.84381C8.81503 3.95181 8.74103 5.49981 7.75603 6.47881L7.51803 6.71681C7.49115 6.81673 7.48841 6.92162 7.51003 7.02281C7.57303 7.43081 7.91403 8.29481 9.34203 9.71481C10.77 11.1348 11.64 11.4748 12.054 11.5388C12.1582 11.561 12.2662 11.5579 12.369 11.5298L12.777 11.1238C13.653 10.2538 14.997 10.0908 16.081 10.6798L17.991 11.7198C19.628 12.6078 20.041 14.8318 18.701 16.1648L17.28 17.5768C16.832 18.0218 16.23 18.3928 15.496 18.4618C13.686 18.6308 9.46903 18.4148 5.03603 14.0078C0.899027 9.89381 0.105027 6.30581 0.00402701 4.53781C-0.045973 3.64381 0.376027 2.88781 0.914027 2.35381L2.48303 0.792808ZM5.52303 2.05881C5.01603 1.38181 4.07203 1.32781 3.54003 1.85681L1.97003 3.41681C1.64003 3.74481 1.48203 4.10681 1.50203 4.45281C1.58203 5.85781 2.22203 9.09481 6.09403 12.9448C10.156 16.9828 13.907 17.1038 15.357 16.9678C15.653 16.9408 15.947 16.7868 16.222 16.5138L17.642 15.1008C18.22 14.5268 18.093 13.4808 17.275 13.0368L15.365 11.9978C14.837 11.7118 14.219 11.8058 13.835 12.1878L13.38 12.6408L12.85 12.1088C13.38 12.6408 13.379 12.6418 13.378 12.6418L13.377 12.6438L13.374 12.6468L13.367 12.6528L13.352 12.6668C13.3095 12.7056 13.264 12.7411 13.216 12.7728C13.136 12.8258 13.03 12.8848 12.897 12.9338C12.627 13.0348 12.269 13.0888 11.827 13.0208C10.96 12.8878 9.81103 12.2968 8.28403 10.7788C6.75803 9.26081 6.16203 8.11881 6.02803 7.25281C5.95903 6.81081 6.01403 6.45281 6.11603 6.18281C6.17259 6.03107 6.25293 5.8893 6.35403 5.76281L6.38603 5.72781L6.40003 5.71281L6.40603 5.70681L6.40903 5.70381L6.41103 5.70181L6.69903 5.41581C7.12703 4.98881 7.18703 4.28181 6.78403 3.74281L5.52303 2.05881Z"/></svg>`;

const ICONE_FECHAR = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

export function initWhatsApp(): void {
  if (document.querySelector('.debony-whatsapp')) return;

  const raiz = document.createElement('div');
  raiz.className = 'debony-whatsapp';
  raiz.innerHTML = `
    <button type="button" class="debony-whatsapp__botao" aria-expanded="false" aria-controls="${PAINEL_ID}"
            aria-label="Telefones e WhatsApp">
      <span class="debony-whatsapp__icone-abrir">${ICONE_WHATSAPP}</span>
      <span class="debony-whatsapp__icone-fechar">${ICONE_FECHAR}</span>
    </button>
    <div class="debony-whatsapp__painel" id="${PAINEL_ID}">
      <div class="debony-whatsapp__cartao">
        <p class="debony-whatsapp__titulo">Fale conosco</p>
        ${UNIDADES.map(unidadeHtml).join('')}
      </div>
    </div>`;
  document.body.appendChild(raiz);

  const botao = raiz.querySelector<HTMLButtonElement>('.debony-whatsapp__botao')!;

  /*
   * Aberto = mouse em cima OU fixado por clique/toque. Separados porque o clique
   * de quem já abriu pelo hover precisa manter o painel (fixa), e não fechá-lo
   * sob o cursor; o segundo clique fecha.
   */
  let porHover = false;
  let fixo = false;
  let timer: number | undefined;

  const atualizar = (): void => {
    const aberto = porHover || fixo;
    raiz.toggleAttribute('data-aberto', aberto);
    raiz.toggleAttribute('data-fixo', fixo);
    botao.setAttribute('aria-expanded', String(aberto));
  };

  const fechar = (): void => {
    window.clearTimeout(timer);
    porHover = false;
    fixo = false;
    atualizar();
  };

  // Só mouse: no toque o pointerenter viria junto do clique e abriria e fecharia de uma vez.
  raiz.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(timer);
    porHover = true;
    atualizar();
  });

  raiz.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      porHover = false;
      atualizar();
    }, ATRASO_FECHAR_MS);
  });

  botao.addEventListener('click', () => {
    fixo = !fixo;
    if (!fixo) porHover = false;
    atualizar();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !raiz.hasAttribute('data-aberto')) return;
    const focoDentro = raiz.contains(document.activeElement);
    fechar();
    if (focoDentro) botao.focus();
  });

  // Toque ou clique fora fecha.
  document.addEventListener('pointerdown', (event) => {
    if (raiz.hasAttribute('data-aberto') && !raiz.contains(event.target as Node)) fechar();
  });

  // Tab para fora do painel fecha, para ele não ficar cobrindo a página.
  raiz.addEventListener('focusout', (event) => {
    const destino = event.relatedTarget as Node | null;
    if (destino && !raiz.contains(destino)) fechar();
  });
}

function unidadeHtml(unidade: Unidade): string {
  return `
    <div class="debony-whatsapp__unidade">
      <p class="debony-whatsapp__unidade-nome">${unidade.nome}</p>
      <ul class="debony-whatsapp__lista">${unidade.numeros.map(numeroHtml).join('')}</ul>
    </div>`;
}

function numeroHtml(numero: Numero): string {
  const whatsapp = numero.whatsapp
    ? `<a class="debony-whatsapp__acao debony-whatsapp__acao--whatsapp"
          href="https://wa.me/${numero.digitos}?text=${encodeURIComponent(MENSAGEM)}" target="_blank" rel="noopener noreferrer"
          aria-label="Chamar ${numero.exibicao} no WhatsApp (abre em nova aba)">${ICONE_WHATSAPP}<span>WhatsApp</span></a>`
    : '';

  return `
    <li class="debony-whatsapp__item">
      <span class="debony-whatsapp__numero">${numero.exibicao}${
        numero.nota ? `<span class="debony-whatsapp__nota">${numero.nota}</span>` : ''
      }</span>
      <span class="debony-whatsapp__acoes">
        ${whatsapp}
        <a class="debony-whatsapp__acao debony-whatsapp__acao--ligar" href="tel:+${numero.digitos}"
           aria-label="Ligar para ${numero.exibicao}">${ICONE_TELEFONE}<span>Ligar</span></a>
      </span>
    </li>`;
}
