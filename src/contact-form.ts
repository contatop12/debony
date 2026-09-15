import { getAttribution } from './attribution';
import { $$, fieldValue } from './dom';
import type { ContactPayload, ContactResponse, FormStatus } from './types';

const ENDPOINT = '/api/contact';

/**
 * O mirror preserva o markup do formulário do Elementor, mas o backend PHP
 * (admin-ajax.php) não existe no deploy estático. Aqui interceptamos o submit
 * antes do JS do Elementor e enviamos para a Pages Function.
 */
export function initContactForms(): void {
  const forms = $$<HTMLFormElement>('form.elementor-form');
  if (forms.length === 0) return;

  for (const form of forms) {
    form.setAttribute('novalidate', '');
    addHoneypot(form);
    // Captura para rodar antes do handler jQuery do Elementor.
    form.addEventListener('submit', (event) => void handleSubmit(event, form), true);
  }
}

/** Campo isca, invisível e fora da ordem de tabulação: só bot preenche. */
function addHoneypot(form: HTMLFormElement): void {
  if (form.elements.namedItem('form_fields[website]')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'form_fields[website]';
  input.tabIndex = -1;
  input.autocomplete = 'off';
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
  form.appendChild(input);
}

async function handleSubmit(event: Event, form: HTMLFormElement): Promise<void> {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (form.dataset['sending'] === '1') return;

  const payload: ContactPayload = {
    name: fieldValue(form, 'form_fields[name]'),
    email: fieldValue(form, 'form_fields[email]'),
    message: fieldValue(form, 'form_fields[message]'),
    website: fieldValue(form, 'form_fields[website]'),
    attribution: { ...getAttribution(), page_url: location.href },
  };

  // Bot: encerra em silêncio, sem gastar chamada da Function.
  if (payload.website) {
    form.reset();
    setStatus(form, 'success');
    return;
  }

  const invalid = validate(payload);
  if (invalid) {
    setStatus(form, 'error', invalid);
    return;
  }

  form.dataset['sending'] = '1';
  setStatus(form, 'sending');

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({ ok: false }))) as ContactResponse;

    if (res.ok && data.ok) {
      form.reset();
      setStatus(form, 'success');
    } else {
      setStatus(form, 'error', data.error);
    }
  } catch {
    setStatus(form, 'error', 'Falha de conexão. Tente novamente.');
  } finally {
    delete form.dataset['sending'];
  }
}

function validate(p: ContactPayload): string | null {
  if (p.name.length < 2) return 'Informe seu nome.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) return 'Informe um e-mail válido.';
  if (p.message.length < 5) return 'Escreva sua mensagem.';
  return null;
}

const MESSAGES: Record<Exclude<FormStatus, 'idle'>, string> = {
  sending: 'Enviando...',
  success: 'Mensagem enviada. Entraremos em contato em breve.',
  error: 'Não foi possível enviar. Tente novamente.',
};

/** Reaproveita os contêineres de mensagem que o Elementor já renderiza. */
function setStatus(form: HTMLFormElement, status: Exclude<FormStatus, 'idle'>, detail?: string): void {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = status === 'sending';

  let box = form.querySelector<HTMLElement>('.debony-form-message');
  if (!box) {
    box = document.createElement('div');
    box.className = 'debony-form-message';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    form.appendChild(box);
  }

  box.dataset['status'] = status;
  box.textContent = detail ?? MESSAGES[status];
}
