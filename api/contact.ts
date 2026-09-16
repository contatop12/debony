/**
 * POST /api/contact — recebe o formulário de contato do site estático.
 *
 * O site de origem era WordPress e o Elementor postava em admin-ajax.php, que
 * não existe no estático. Esta função assume o envio.
 *
 * Projeto sem framework: a Vercel detecta `api/` na raiz e usa a assinatura
 * `export default { fetch }`, com Request/Response da Web API.
 *
 * Variáveis de ambiente (Project Settings > Environment Variables). É preciso
 * pelo menos um destino configurado — webhook ou Resend:
 *   CONTACT_WEBHOOK   URL que recebe o lead em JSON (n8n)
 *   RESEND_API_KEY    chave da API Resend, para também enviar por e-mail
 *   CONTACT_TO        destino do e-mail   (obrigatório com Resend)
 *   CONTACT_FROM      remetente verificado (obrigatório com Resend)
 *
 * A URL do webhook fica só na variável de ambiente, nunca no código: o
 * repositório é público, e quem a tivesse poderia injetar leads falsos no n8n.
 */

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  website?: unknown;
  attribution?: unknown;
}

interface Submission {
  name: string;
  email: string;
  message: string;
}

// Folga para a atribuição, que traz URLs longas (landing_page, referrer).
const MAX_BODY_BYTES = 16 * 1024;
const LIMITS = { name: 120, email: 200, message: 4000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Só estes campos de atribuição seguem para o webhook. O corpo vem do navegador
 * e é controlado por quem envia: lista fechada, só strings, tamanho limitado.
 */
const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'landing_page',
  'referrer',
  'captured_at',
  'page_url',
] as const;
const ATTRIBUTION_MAX = 500;

type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
type Attribution = Partial<Record<AttributionKey, string>>;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

export default {
  async fetch(request: Request): Promise<Response> {
    /*
     * Diagnóstico sem efeito colateral: abrir /api/contact no navegador mostra se
     * os destinos estão configurados neste deploy, sem enviar lead de teste. Só
     * booleanos — a URL do webhook nunca sai do servidor.
     */
    if (request.method === 'GET') {
      return json({ ok: true, destinos: destinosConfigurados() });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Método não permitido.' }, 405);
    }

    // Só aceita envio vindo do próprio site.
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return json({ ok: false, error: 'Origem não permitida.' }, 403);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Mensagem muito longa.' }, 413);
    }

    let body: ContactPayload;
    try {
      body = JSON.parse(raw) as ContactPayload;
    } catch {
      return json({ ok: false, error: 'Requisição inválida.' }, 400);
    }

    // Honeypot preenchido: responde sucesso sem processar nada.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return json({ ok: true });
    }

    const name = clean(body.name, LIMITS.name);
    const email = clean(body.email, LIMITS.email);
    const message = clean(body.message, LIMITS.message);

    if (name.length < 2) return json({ ok: false, error: 'Informe seu nome.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Informe um e-mail válido.' }, 400);
    if (message.length < 5) return json({ ok: false, error: 'Escreva sua mensagem.' }, 400);

    const submission: Submission = { name, email, message };
    const attribution = cleanAttribution(body.attribution);
    const tasks: Promise<Response>[] = [];

    const webhook = process.env['CONTACT_WEBHOOK'];
    if (webhook) {
      tasks.push(
        fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Campos planos: mapeiam direto nos nós do n8n, sem precisar abrir objeto.
          body: JSON.stringify({
            ...submission,
            ...attribution,
            received_at: new Date().toISOString(),
            ip: firstIp(request.headers.get('x-forwarded-for')),
            country: request.headers.get('x-vercel-ip-country'),
          }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        }),
      );
    }

    const apiKey = process.env['RESEND_API_KEY'];
    const to = process.env['CONTACT_TO'];
    const from = process.env['CONTACT_FROM'];

    if (apiKey && to && from) {
      tasks.push(sendViaResend({ apiKey, to, from }, submission, attribution));
    }

    if (tasks.length === 0) {
      // Sem destino configurado, falhar alto é melhor que perder a mensagem.
      // O log aparece em Vercel > Logs e aponta a causa direto.
      console.error(
        '[contato] Nenhum destino configurado neste deploy: defina CONTACT_WEBHOOK ' +
          '(ou RESEND_API_KEY + CONTACT_TO + CONTACT_FROM) para o ambiente Production e faça Redeploy.',
      );
      return json(
        { ok: false, error: 'Envio indisponível no momento. Fale conosco pelo telefone ou e-mail.' },
        503,
      );
    }

    const results = await Promise.allSettled(tasks);
    const delivered = results.some((r) => r.status === 'fulfilled' && r.value.ok);

    if (!delivered) {
      return json({ ok: false, error: 'Não foi possível enviar agora. Tente novamente.' }, 502);
    }
    return json({ ok: true });
  },
};

function destinosConfigurados(): { webhook: boolean; email: boolean } {
  return {
    webhook: Boolean(process.env['CONTACT_WEBHOOK']),
    email: Boolean(process.env['RESEND_API_KEY'] && process.env['CONTACT_TO'] && process.env['CONTACT_FROM']),
  };
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanAttribution(value: unknown): Attribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const v = source[key];
    if (typeof v === 'string' && v.trim() !== '') out[key] = v.trim().slice(0, ATTRIBUTION_MAX);
  }
  return out;
}

/** x-forwarded-for pode trazer a cadeia de proxies; o cliente é o primeiro. */
function firstIp(header: string | null): string | null {
  return header?.split(',')[0]?.trim() || null;
}

function sendViaResend(
  cfg: { apiKey: string; to: string; from: string },
  s: Submission,
  attribution: Attribution,
): Promise<Response> {
  const origem = Object.entries(attribution)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [cfg.to],
      reply_to: s.email,
      subject: `Contato pelo site — ${s.name}`,
      text:
        `Nome: ${s.name}\nE-mail: ${s.email}\n\n${s.message}` +
        (origem ? `\n\n--- Origem ---\n${origem}` : ''),
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}
