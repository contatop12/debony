import type { Attribution } from './types';

/**
 * Atribuição de origem do lead (UTMs e IDs de clique).
 *
 * O visitante chega por um anúncio numa página qualquer — em geral a home — e só
 * depois navega até /contato/. Os parâmetros somem da URL nessa navegação, então
 * são guardados na chegada e anexados ao envio do formulário.
 *
 * Modelo de último toque: uma nova chegada com parâmetros substitui a anterior;
 * visitas sem parâmetros (direto, navegação interna) não apagam o que já existe.
 */

const PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
] as const;

const STORAGE_KEY = 'debony_attribution';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Stored {
  data: Attribution;
  expiresAt: number;
}

function fromQuery(search: string): Attribution | null {
  const query = new URLSearchParams(search);
  const found: Attribution = {};
  for (const key of PARAMS) {
    const value = query.get(key)?.trim();
    if (value) found[key] = value;
  }
  return Object.keys(found).length > 0 ? found : null;
}

function withContext(params: Attribution): Attribution {
  return {
    ...params,
    landing_page: location.href,
    referrer: document.referrer,
    captured_at: new Date().toISOString(),
  };
}

// Storage pode estar bloqueado (aba anônima, bloqueio de cookies): falha em silêncio.
function save(data: Attribution): void {
  try {
    const stored: Stored = { data, expiresAt: Date.now() + TTL_MS };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* sem storage, o envio ainda lê a URL atual */
  }
}

function load(): Attribution | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (!stored?.data || Date.now() > stored.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return stored.data;
  } catch {
    return null;
  }
}

/** Roda em toda página: guarda os parâmetros quando a URL de chegada os traz. */
export function captureAttribution(): void {
  const params = fromQuery(location.search);
  if (params) save(withContext(params));
}

/**
 * Atribuição para o envio. A URL atual tem prioridade sobre o que foi guardado:
 * cobre anúncio apontando direto para /contato/ e navegador sem storage.
 */
export function getAttribution(): Attribution {
  const current = fromQuery(location.search);
  if (current) return withContext(current);
  return load() ?? {};
}
