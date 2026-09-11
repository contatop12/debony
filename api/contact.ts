/**
 * POST /api/contact — recebe o formulário de contato do site estático.
 *
 * O site de origem era WordPress e o Elementor postava em admin-ajax.php, que
 * não existe no estático. Esta função assume o envio.
 *
 * Projeto sem framework: o Vercel detecta `api/` na raiz e usa a assinatura
 * `export default { fetch }`, com Request/Response da Web API.
 *
 * Variáveis de ambiente (Project Settings > Environment Variables):
 *   CONTACT_TO        destino das mensagens   (ex.: contato@debonyusinagem.com.br)
 *   CONTACT_FROM      remetente verificado    (ex.: site@debonyusinagem.com.br)
 *   RESEND_API_KEY    chave da API Resend     (obrigatória para enviar e-mail)
 *   CONTACT_WEBHOOK   opcional: URL que também recebe uma cópia em JSON
 */

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  website?: unknown;
}

interface Submission {
  name: string;
  email: string;
  message: string;
}

const MAX_BODY_BYTES = 8 * 1024;
const LIMITS = { name: 120, email: 200, message: 4000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    const tasks: Promise<Response>[] = [];

    const webhook = process.env['CONTACT_WEBHOOK'];
    if (webhook) {
      tasks.push(
        fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...submission,
            receivedAt: new Date().toISOString(),
            // Cabeçalhos do Vercel; no Cloudflare eram CF-Connecting-IP/CF-IPCountry.
            ip: request.headers.get('x-forwarded-for'),
            country: request.headers.get('x-vercel-ip-country'),
          }),
        }),
      );
    }

    const apiKey = process.env['RESEND_API_KEY'];
    const to = process.env['CONTACT_TO'];
    const from = process.env['CONTACT_FROM'];

    if (apiKey && to && from) {
      tasks.push(sendViaResend({ apiKey, to, from }, submission));
    } else if (tasks.length === 0) {
      // Sem provedor configurado, falhar alto é melhor que perder a mensagem.
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

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sendViaResend(
  cfg: { apiKey: string; to: string; from: string },
  s: Submission,
): Promise<Response> {
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
      text: `Nome: ${s.name}\nE-mail: ${s.email}\n\n${s.message}`,
    }),
  });
}
